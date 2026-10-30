import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { PAS_AGENTS } from '../../src/cli/commands/agents/presenter';
import { getModelGuidance } from '../../src/cli/commands/agents/setup';

const leadPrompt = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');

describe('PAS roster and Lead contract', () => {
  it('exposes both primary modes and the three PAS workers', () => {
    expect(PAS_AGENTS).toEqual([
      'Pulsar Agent Squad',
      'Pulsar Agent Turbo',
      'pas_researcher',
      'pas_engineer',
      'pas_copilot',
    ]);
  });

  it('does not retain NAS planner or mini roster entries', () => {
    const agentFiles = readdirSync('src/agents').filter((file) => file.endsWith('.md'));
    expect(agentFiles.sort()).toEqual([
      'Pulsar Agent Squad.md',
      'Pulsar Agent Turbo.md',
      'pas_copilot.md',
      'pas_engineer.md',
      'pas_researcher.md',
    ]);
    expect(leadPrompt).not.toContain('nas_planner');
    expect(leadPrompt).not.toContain('nas_developer_mini');
  });

  it('configures the Lead as primary and allows only the three PAS workers', () => {
    const frontmatter = leadPrompt.split('---')[1];
    expect(frontmatter).toContain('mode: primary');
    expect(frontmatter).toContain('pas_toolkit: allow');
    expect(frontmatter.match(/pas_toolkit: allow/g) ?? []).toHaveLength(1);
    expect(frontmatter).toMatch(/"pas_researcher": allow/);
    expect(frontmatter).toMatch(/"pas_engineer": allow/);
    expect(frontmatter).toMatch(/"pas_copilot": allow/);
    expect(frontmatter).not.toMatch(/"pas_developer": allow/);
    expect(frontmatter).not.toMatch(/"pas_qa": allow/);
    expect(frontmatter).toContain('"specs/*.feature": allow');
    expect(frontmatter).toContain('"specs/**/*.feature": allow');
    const readBlock = frontmatter.split('read:')[1].split('edit:')[0];
    expect(readBlock).toContain('"docs/**": allow');
    expect(frontmatter).not.toContain('planner');
    expect(frontmatter).not.toContain('developer_mini');
  });

  it('keeps planning and source-edit boundaries on the Lead', () => {
    expect(leadPrompt).toContain('combine the orchestrator and planner responsibilities');
    expect(leadPrompt).toContain('Research Quality Gate');
    expect(leadPrompt).toContain('Planning Quality Gate');
    expect(leadPrompt).toContain('the pair is one unit');
    expect(leadPrompt).toContain("pair's verdict");
    expect(leadPrompt).toContain('Adjudicate.');
    expect(leadPrompt).toContain('never edits source code');
    expect(leadPrompt).toContain('Implementation plan is ready. Do you');
    expect(leadPrompt).toContain('.pas/state/');
    expect(leadPrompt).toContain('specs/**/*.feature');
  });

  it('preserves skill assignment and bounded retry contracts', () => {
    expect(leadPrompt).toContain('Skill assignment contract');
    expect(leadPrompt).toContain('Pass the exact assigned skills to every worker');
    expect(leadPrompt).toContain('Retry and escalation');
    expect(leadPrompt).toContain('same_error');
  });
});

describe('PAS worker contracts', () => {
  it('uses light model guidance for every worker', () => {
    expect(getModelGuidance('pas_researcher')).toBe('light');
    expect(getModelGuidance('pas_engineer')).toBe('light');
    expect(getModelGuidance('pas_copilot')).toBe('light');
    expect(getModelGuidance('Pulsar Agent Squad')).toBe('heavy');
    expect(getModelGuidance('Pulsar Agent Turbo')).toBe('heavy');
  });

  it('keeps researcher and copilot read-only while engineer can implement', () => {
    const researcher = readFileSync('src/agents/pas_researcher.md', 'utf-8');
    const engineer = readFileSync('src/agents/pas_engineer.md', 'utf-8');
    const copilot = readFileSync('src/agents/pas_copilot.md', 'utf-8');

    expect(researcher).toMatch(/edit: deny/);
    expect(researcher).toMatch(/write: deny/);
    expect(copilot).toMatch(/edit: deny/);
    expect(copilot).toMatch(/write: deny/);
    expect(engineer).toMatch(/edit:\n\s+"\*": allow/);
    expect(engineer).toContain('".pas/**": deny');
    expect(engineer).toContain('"specs/*.feature": deny');
    expect(engineer).toContain('"specs/**/*.feature": deny');
    expect(engineer).toContain('one approved atomic task');
    expect(engineer).toContain('Red -> Green -> Refactor');
    expect(engineer).toContain('Skill Assignment Contract');
    expect(engineer).toContain('BLOCKED');
  });

  it('requires structured evidence and one copilot verdict', () => {
    const researcher = readFileSync('src/agents/pas_researcher.md', 'utf-8');
    const copilot = readFileSync('src/agents/pas_copilot.md', 'utf-8');
    expect(researcher).toContain('<research_report>');
    expect(researcher).toContain('<source_exhaustion>');
    expect(researcher).toContain('<hypotheses>');
    expect(researcher).toContain('<research_mode>');
    expect(researcher).toContain('<repository_sources');
    expect(researcher).toContain('<skill_application>');
    expect(researcher).toContain('<memory_writes>');
    expect(copilot.replace(/\s+/g, ' ')).toContain('run the full project test suite');
    expect(copilot).toContain('<authorization_check>');
    expect(copilot).toContain('<scenario_results>');
    expect(copilot).toContain('<test_sufficiency>');
    expect(copilot).toContain('<skill_compliance>');
    expect(copilot).toContain('<linter_check>');
    expect(copilot.match(/<audit_report>/g)).toHaveLength(3);
    expect(copilot).toContain('PASS | FAIL | BLOCKED');
  });
});
