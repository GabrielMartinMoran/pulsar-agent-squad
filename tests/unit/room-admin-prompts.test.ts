import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const lead = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');
const turbo = readFileSync('src/agents/Pulsar Agent Turbo.md', 'utf-8');
const engineer = readFileSync('src/agents/pas_engineer.md', 'utf-8');
const copilot = readFileSync('src/agents/pas_copilot.md', 'utf-8');
const roomAdminTools = [
  'pas_room_resolve_escalation',
  'pas_room_abort',
  'pas_room_reset',
];

function permissionBlock(action: string, effect: string): RegExp {
  return new RegExp(`- action: ${action}\\s+resource: "\\*"\\s+effect: ${effect}`);
}

describe('room administration prompts', () => {
  it('grants host controls to both orchestrators and defines when to use them', () => {
    for (const prompt of [lead, turbo]) {
      const frontmatter = prompt.split('---')[1] ?? '';
      for (const tool of roomAdminTools) {
        expect(frontmatter).toMatch(permissionBlock(tool, 'allow'));
        expect(prompt).toContain(`\`${tool}\``);
      }
      expect(prompt).toMatch(/`git status` baseline/);
    }

    expect(lead).toContain('an aborted room is not a successful delivery');
    expect(lead).toContain('It does not revert code.');
    expect(lead).toContain('capture a fresh `git status` baseline');
    expect(turbo).toContain('it does not revert code');
    expect(turbo).toContain('Capture a new baseline before spawning replacements.');
  });

  it('keeps host-only controls unavailable to both workers', () => {
    for (const prompt of [engineer, copilot]) {
      const frontmatter = prompt.split('---')[1] ?? '';
      for (const tool of roomAdminTools) {
        expect(frontmatter).toMatch(permissionBlock(tool, 'deny'));
      }
      expect(prompt).toContain('Only the Lead may resolve escalations');
      expect(prompt).toContain('return `BLOCKED` with the exact error and stop');
    }
  });
});
