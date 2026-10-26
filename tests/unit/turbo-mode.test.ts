import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

const turbo = readFileSync('src/agents/Pulsar Agent Turbo.md', 'utf-8');
const lead = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');
const frontmatter = turbo.split('---')[1];
const directExecution = turbo.split('### Direct execution: full Developer + QA discipline')[1]?.split('### Background workers')[0] ?? '';

describe('Pulsar Agent Turbo alternative primary mode', () => {
  it('has source-edit and verification capabilities without modifying the PAS Lead', () => {
    expect(frontmatter).toContain('mode: primary');
    expect(frontmatter).toContain('edit: allow');
    expect(frontmatter).toContain('write: allow');
    expect(frontmatter).toContain('bash: allow');
    expect(frontmatter).toContain('pas_toolkit: allow');
    expect(lead).toContain('You never edit source code');
    expect(lead).toContain('    "pas_qa": allow');
  });

  it('can spawn exactly the existing three worker roles', () => {
    const taskBlock = frontmatter.split('  task:')[1];
    expect(taskBlock).toContain('"*": deny');
    for (const role of ['pas_researcher', 'pas_developer', 'pas_qa']) {
      expect(taskBlock).toContain(`"${role}": allow`);
    }
    expect(taskBlock).not.toContain('pas_planner');
    expect(turbo).toContain('background: true');
    expect(turbo).toContain('fallback');
    expect(turbo).toContain('logically sequential');
  });

  it('defaults to solo work but escalates on risk and context pressure', () => {
    expect(turbo).toContain('Default to completing work yourself');
    expect(turbo).toContain('remaining');
    expect(turbo).toContain('context');
    expect(turbo).toContain('Independent review');
    expect(turbo).toContain('High-risk changes');
    expect(turbo).toContain('security');
    expect(turbo).toContain('concurrency');
    expect(turbo).toContain('SELF');
    expect(turbo).toContain('INDEPENDENT');
  });

  it('retains safe intragent parallelism for independent inspection and validation', () => {
    expect(directExecution).toContain('Parallelize independent intragent work');
    for (const tool of ['read', 'grep', 'glob']) {
      expect(directExecution).toContain(tool);
    }
    expect(directExecution).toContain('shell checks');
    expect(directExecution).toContain('concurrently');
    expect(directExecution).toContain('Serialize edits');
    expect(directExecution).toContain('sharing output directories');
    expect(directExecution).toContain('test-runner concurrency');
    expect(directExecution).toContain('actively changing tree');
  });

  it('uses focused red-green-refactor feedback before the mandatory full-suite handoff', () => {
    expect(directExecution).toContain('Preflight and research');
    expect(directExecution).toContain('BLOCKED before editing');
    expect(directExecution).toContain('RED:');
    expect(directExecution).toContain('GREEN:');
    expect(directExecution).toContain('REFACTOR:');
    expect(directExecution).toContain('narrowest relevant test file');
    expect(directExecution).toContain('Do **not** run the entire');
    expect(directExecution).toMatch(/full\s+project test suite/);
    expect(directExecution).toContain('exit codes');
  });

  it('retains developer test pyramid and QA strategy reviews even for solo work', () => {
    expect(directExecution).toContain('cheapest sufficient test');
    expect(directExecution).toContain('healthy test pyramid');
    for (const tag of ['@unit', '@integration', '@contract', '@e2e', '@manual']) {
      expect(directExecution).toContain(tag);
    }
    expect(directExecution).toContain('happy/error paths');
    expect(directExecution).toContain('QA loop (mandatory even when SELF)');
    expect(directExecution).toContain('HEALTHY_PYRAMID');
    expect(directExecution).toContain('read-only formatter validation');
    expect(directExecution).toContain('unchanged stable tree');
    expect(directExecution).toContain('No tests run');
    expect(directExecution).toContain('never PASS');
    expect(directExecution).toContain('own');
  });

  it('preserves approval, artifacts, Gherkin, TDD, checks and state closure', () => {
    expect(turbo).toContain('single-use');
    expect(turbo).toContain('Implementation plan is ready. Do you want me to apply it now?');
    expect(turbo).toContain('pas_toolkit check/list/new/archive');
    expect(turbo).toContain('gherkin.storage_path');
    expect(turbo).toContain('@integration');
    expect(turbo).toContain('Red → Green → Refactor');
    expect(turbo).toContain('full configured test suite');
    expect(turbo).toContain('read-only formatter');
    expect(turbo).toContain('actual diff');
    expect(turbo).toContain('skill assignment');
    expect(turbo).toContain('memory.required');
    expect(turbo).toContain('pas_toolkit archive');
  });
});
