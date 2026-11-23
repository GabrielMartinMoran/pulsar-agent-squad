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

  it('teaches the atomic pair, the close order, and the recovery cases', () => {
    for (const prompt of [lead, turbo]) {
      expect(prompt).toContain('`expect`');
      expect(prompt).toContain('PAIR_BROKEN');
      expect(prompt).toContain('final_approved');
      expect(prompt).toContain('Never resume the driver alone');
    }
    expect(lead).toContain('<example name="happy-path">');
    expect(lead).toContain('<example name="one-never-joined">');
    expect(lead).toContain('<example name="peer-died-mid-work">');
    expect(lead).toContain('<example name="driver-returns-before-close">');
    expect(lead).toContain('<example name="wrong-order">');
    expect(lead).toContain('comment such as "ready for final audit" is not `finish`');
  });

  it('documents researcher investigation, close discipline, and delivery state', () => {
    const researcher = readFileSync('src/agents/pas_researcher.md', 'utf-8');
    expect(researcher).toContain('non-mutating');
    expect(researcher).toContain('Read-only shell policy');
    expect(lead).toContain('read-only with a shell for non-mutating');
    expect(lead).toContain('Solo read-only work');
    expect(lead).toContain('interrupt both');
    expect(lead).toContain('execution.failed');
    expect(engineer.replace(/\s+/g, ' ')).toContain('Publish `ready_for_review` per topic');
    expect(engineer.replace(/\s+/g, ' ')).toContain('`finish` with a summary and `files`');
    expect(copilot).toContain('A quiet active pair');
    expect(copilot).toContain('retry; that is a recoverable gate error');
    expect(copilot).toContain('Do not post `final_approved` if your audit report will be BLOCKED');
    expect(copilot).toContain('Investigation belongs to `pas_researcher`');
    expect(copilot).toContain('refuse it');
    expect(lead).toContain('A peer');
    expect(lead).toContain('verdict BLOCKED');
    expect(lead).toContain('**Routing rule:**');
    expect(lead).toContain('one `pas_researcher` without a room');
    expect(turbo).toContain('read-only investigation');
    expect(turbo).toContain('routing error');
    expect(turbo).toContain('interrupt');
    expect(turbo).toContain('Delivery:');
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

  it('keeps recovery instructions aligned with the forum tools', () => {
    for (const prompt of [lead, turbo, engineer, copilot]) {
      const normalized = prompt.replace(/\s+/g, ' ');
      expect(normalized).toContain('{ok, workspace, data}');
      expect(normalized).toContain('next_actions');
      expect(normalized).toContain('changes_requested');
      expect(normalized).toContain('reply_to');
    }
    for (const prompt of [engineer, copilot]) {
      const forum = prompt.split('## Pairing forum protocol')[1]!.split('## ')[0]!;
      expect(forum).toContain('wait_seconds: 10');
      expect(forum).not.toContain('wait_s:');
      expect(forum).not.toContain('ready_for_final_audit');
      expect(forum).toContain('final-correction');
      expect(prompt).toContain('### Legacy rooms only');
    }
  });
});
