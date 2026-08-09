import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { PAS_AGENTS } from '../../src/cli/commands/agents/presenter';
import { getModelGuidance } from '../../src/cli/commands/agents/setup';

const leadPrompt = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');

describe('PAS roster and Lead contract', () => {
  it('exposes exactly the four executable PAS agents', () => {
    expect(PAS_AGENTS).toEqual([
      'Pulsar Agent Squad',
      'pas_researcher',
      'pas_developer',
      'pas_qa',
    ]);
  });

  it('does not retain NAS planner or mini roster entries', () => {
    const agentFiles = readdirSync('src/agents').filter((file) => file.endsWith('.md'));
    expect(agentFiles.sort()).toEqual([
      'Pulsar Agent Squad.md',
      'pas_developer.md',
      'pas_qa.md',
      'pas_researcher.md',
    ]);
    expect(leadPrompt).not.toContain('nas_planner');
    expect(leadPrompt).not.toContain('nas_developer_mini');
  });

  it('configures the Lead as primary and allows only the three PAS workers', () => {
    const frontmatter = leadPrompt.split('---')[1];
    expect(frontmatter).toContain('mode: primary');
    expect(frontmatter).toMatch(/"pas_researcher": allow/);
    expect(frontmatter).toMatch(/"pas_developer": allow/);
    expect(frontmatter).toMatch(/"pas_qa": allow/);
    expect(frontmatter).toContain('"specs/*.feature": allow');
    expect(frontmatter).toContain('"specs/**/*.feature": allow');
    expect(frontmatter).not.toContain('planner');
    expect(frontmatter).not.toContain('developer_mini');
  });

  it('keeps planning and source-edit boundaries on the Lead', () => {
    expect(leadPrompt).toContain('combine the orchestrator and planner responsibilities');
    expect(leadPrompt).toContain('Research Quality Gate');
    expect(leadPrompt).toContain('Planning Quality Gate');
    expect(leadPrompt).toContain('one atomic task at a time');
    expect(leadPrompt).toContain('Adjudicate QA');
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
    expect(getModelGuidance('pas_developer')).toBe('light');
    expect(getModelGuidance('pas_qa')).toBe('light');
    expect(getModelGuidance('Pulsar Agent Squad')).toBe('heavy');
  });

  it('keeps researcher and QA read-only while developer can implement', () => {
    const researcher = readFileSync('src/agents/pas_researcher.md', 'utf-8');
    const developer = readFileSync('src/agents/pas_developer.md', 'utf-8');
    const qa = readFileSync('src/agents/pas_qa.md', 'utf-8');

    expect(researcher).toMatch(/edit: deny/);
    expect(researcher).toMatch(/write: deny/);
    expect(qa).toMatch(/edit: deny/);
    expect(qa).toMatch(/write: deny/);
    expect(developer).toMatch(/edit:\n\s+"\*": allow/);
    expect(developer).toContain('".pas/**": deny');
    expect(developer).toContain('"specs/*.feature": deny');
    expect(developer).toContain('"specs/**/*.feature": deny');
    expect(developer).toContain('one approved atomic task');
    expect(developer).toContain('Red -> Green -> Refactor');
    expect(developer).toContain('Skill Assignment Contract');
    expect(developer).toContain('BLOCKED');
  });

  it('requires structured evidence and one QA verdict', () => {
    const researcher = readFileSync('src/agents/pas_researcher.md', 'utf-8');
    const qa = readFileSync('src/agents/pas_qa.md', 'utf-8');
    expect(researcher).toContain('<research_report>');
    expect(researcher).toContain('<source_exhaustion>');
    expect(researcher).toContain('<hypotheses>');
    expect(researcher).toContain('<research_mode>');
    expect(researcher).toContain('<repository_sources');
    expect(researcher).toContain('<skill_application>');
    expect(researcher).toContain('<memory_writes>');
    expect(qa).toContain('run the full test suite,');
    expect(qa).toContain('<authorization_check>');
    expect(qa).toContain('<scenario_results>');
    expect(qa).toContain('<test_sufficiency>');
    expect(qa).toContain('<skill_compliance>');
    expect(qa).toContain('<linter_check>');
    expect(qa.match(/<qa_verdict>/g)).toHaveLength(2);
    expect(qa).toContain('PASS | FAIL | BLOCKED');
  });
});
