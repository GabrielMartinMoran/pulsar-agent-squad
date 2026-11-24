import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

const researcher = readFileSync('src/agents/pas_researcher.md', 'utf-8');
const flatResearcher = researcher.replace(/\s+/g, ' ');
const frontmatter = researcher.split('---')[1] ?? '';
const report =
  researcher.split('<research_report>')[1]?.split('</research_report>')[0] ?? '';

describe('A2: researcher answer, coverage, limits and closure', () => {
  it('leads with a direct grounded answer instead of only raw findings', () => {
    expect(report).toContain('<answer>');
    expect(flatResearcher).toContain('Lead with a direct, grounded answer');
    expect(flatResearcher).toContain('A report with abundant facts but no answer is incomplete');
  });

  it('reports coverage and cited evidence', () => {
    expect(report).toContain('<coverage>');
    expect(report).toContain('<facts>');
    expect(report).toContain('<sources_consulted>');
    expect(report).toContain('<source_exhaustion>');
  });

  it('states limits and an explicit closure status', () => {
    expect(report).toContain('<limits>');
    expect(report).toMatch(/<closure>COMPLETE \| PARTIAL \| BLOCKED/);
    expect(flatResearcher).toContain('`COMPLETE`');
    expect(flatResearcher).toContain('`PARTIAL`');
    expect(flatResearcher).toContain('`BLOCKED`');
  });

  it('distinguishes source inspection from live verification and gains no shell', () => {
    expect(flatResearcher).toContain('Source inspection is not a live run');
    expect(flatResearcher).toContain('You have no shell access');
    expect(flatResearcher).toContain('never claim to have run commands');
    expect(frontmatter).toContain('bash: deny');
    expect(frontmatter).not.toMatch(/bash:\s*allow/);
    expect(frontmatter).not.toContain('shell: allow');
  });
});
