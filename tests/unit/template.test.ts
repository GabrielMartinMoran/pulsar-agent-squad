import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('pas_developer_shared.eta template', () => {
  it('renders the bounded TDD constraints and output contract', async () => {
    const template = readFileSync('src/cli/templates/pas_developer_shared.eta', 'utf-8');
    const { Eta } = await import('eta');
    const eta = new Eta({ autoTrim: false });
    const constraints = eta.renderString(template, { agent: 'developer', section: 'constraints' });
    const output = eta.renderString(template, { agent: 'developer', section: 'output_format' });
    expect(constraints).toContain('approved atomic task');
    expect(constraints).toContain('Red, Green, Refactor');
    expect(output).toContain('<implementation_report>');
    expect(output).toContain('<task_status>PASS | BLOCKED</task_status>');
    expect(output).toContain('<scenarios_implemented>');
    expect(output).toContain('<skill_application>');
    expect(output).toContain('<test_coverage_explanation>');
    expect(output).toContain('<memory_writes>');
  });

  it('does not include mini-developer branching', async () => {
    const template = readFileSync('src/cli/templates/pas_developer_shared.eta', 'utf-8');
    expect(template).not.toContain('developer_mini');
  });
});
