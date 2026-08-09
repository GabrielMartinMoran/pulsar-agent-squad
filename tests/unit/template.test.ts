import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('pas_developer prompt contract', () => {
  it('is self-contained and has no shared-template markers', () => {
    const prompt = readFileSync('src/agents/pas_developer.md', 'utf-8');
    expect(prompt).toContain('## Hard constraints');
    expect(prompt).toContain('## Tool guidance');
    expect(prompt).toContain('<implementation_report>');
    expect(prompt).toContain('<task_status>PASS | BLOCKED</task_status>');
    expect(prompt).toContain('<skill_application>');
    expect(prompt).toContain('<test_coverage_explanation>');
    expect(prompt).toContain('<memory_writes>');
    expect(prompt).not.toContain('INJECT:developer_shared');
    expect(prompt).not.toContain('developer_mini');
  });
});
