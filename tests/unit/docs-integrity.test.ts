import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const REQUIRED_DOCS = ['docs/architecture.md', 'docs/domain.md', 'docs/product.md'];
const ADR_DIR = 'docs/adr';

function readDoc(path: string): string {
  return readFileSync(path, 'utf-8');
}

function firstLine(path: string): string {
  return readDoc(path).split('\n')[0];
}

function listMarkdownDocs(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith('.md') ? [path] : [];
    });
  return walk('docs').sort();
}

function specPointers(markdown: string): string[] {
  return [...new Set(markdown.match(/specs\/[\w./-]+\.feature/g) ?? [])];
}

function adrPointers(markdown: string): string[] {
  return [...new Set(markdown.match(/docs\/adr\/[\w.-]+\.md/g) ?? [])];
}

describe('docs integrity — PAS repo', () => {
  it('keeps the core living docs and at least three ADRs', () => {
    for (const doc of REQUIRED_DOCS) {
      expect(existsSync(doc)).toBe(true);
    }
    expect(existsSync(ADR_DIR)).toBe(true);
    const adrs = readdirSync(ADR_DIR).filter((file) => file.endsWith('.md'));
    expect(adrs.length).toBeGreaterThanOrEqual(3);
  });

  it('owns every doc with an owner and updated date on its first line', () => {
    expect(existsSync('docs')).toBe(true);
    const docs = listMarkdownDocs();
    expect(docs.length).toBeGreaterThanOrEqual(REQUIRED_DOCS.length + 3);
    for (const doc of docs) {
      const line = firstLine(doc);
      expect(line).toContain('> Owner:');
      expect(line).toContain('Updated:');
    }
  });

  it('resolves every product map pointer to a Gherkin spec', () => {
    expect(existsSync('docs/product.md')).toBe(true);
    const pointers = specPointers(readDoc('docs/product.md'));
    expect(pointers.length).toBeGreaterThanOrEqual(6);
    for (const pointer of pointers) {
      expect(existsSync(pointer)).toBe(true);
    }
  });

  it('resolves every ADR index entry in the architecture doc', () => {
    expect(existsSync('docs/architecture.md')).toBe(true);
    const pointers = adrPointers(readDoc('docs/architecture.md'));
    expect(pointers.length).toBeGreaterThanOrEqual(3);
    for (const pointer of pointers) {
      expect(existsSync(pointer)).toBe(true);
    }
  });
});
