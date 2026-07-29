import { describe, expect, it } from 'bun:test';
import { parseManifest } from '../../src/cli/lib/manifest';

describe('parseManifest', () => {
  it('should return all 8 entries from platforms.manifest', () => {
    const entries = parseManifest();
    expect(entries).toHaveLength(8);
  });

  it('should have correct fields for opencode entry', () => {
    const entries = parseManifest();
    const opencode = entries.find((e) => e.target === 'opencode');
    expect(opencode).toBeDefined();
    expect(opencode!.target).toBe('opencode');
    expect(opencode!.kind).toBe('dir');
    expect(opencode!.source).toBe('src/agents');
    expect(opencode!.distPath).toBe('platforms/opencode/agents');
    expect(opencode!.installPath).toBe('.config/opencode/agents');
  });

  it('should parse file-based entries correctly', () => {
    const entries = parseManifest();
    const cursor = entries.find((e) => e.target === 'cursor');
    expect(cursor).toBeDefined();
    expect(cursor!.kind).toBe('file');
    expect(cursor!.source).toBe('src/templates/platforms/cursor/AGENTS.md.tmpl');
    expect(cursor!.distPath).toBe('platforms/cursor/AGENTS.md');
    expect(cursor!.installPath).toBe('.cursor/agents');
  });

  it('should skip comment lines starting with #', () => {
    const entries = parseManifest();
    // verifies no entries have target starting with #
    entries.forEach((e) => expect(e.target).not.toMatch(/^#/));
  });

  it('should skip empty lines', () => {
    const entries = parseManifest();
    // All entries should have a non-empty target
    entries.forEach((e) => expect(e.target.length).toBeGreaterThan(0));
  });

  it('should only have valid kinds: dir or file', () => {
    const entries = parseManifest();
    entries.forEach((e) => {
      expect(['dir', 'file']).toContain(e.kind);
    });
  });
});
