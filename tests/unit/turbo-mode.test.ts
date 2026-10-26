import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

const turbo = readFileSync('src/agents/Pulsar Turbo.md', 'utf-8');
const lead = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');
const frontmatter = turbo.split('---')[1];

describe('Pulsar Turbo alternative primary mode', () => {
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
