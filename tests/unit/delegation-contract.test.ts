import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

const squad = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');
const turbo = readFileSync('src/agents/Pulsar Agent Turbo.md', 'utf-8');

function delegationBrief(prompt: string): string {
  const match = prompt.match(/<delegation_brief>([\s\S]*?)<\/delegation_brief>/);
  return match?.[1].replace(/\s+/g, ' ').trim() ?? '';
}

function frontmatter(prompt: string): string {
  return prompt.split('---')[1] ?? '';
}

function allowedWorkers(prompt: string): string[] {
  const taskBlock = frontmatter(prompt).split('task:')[1] ?? '';
  return [...taskBlock.matchAll(/"([^"]+)": allow/g)].map((match) => match[1]);
}

describe('A1: bounded delegation brief', () => {
  it('uses one matching XML brief in Squad and Turbo when delegating', () => {
    const brief = delegationBrief(squad);
    expect(brief).not.toBe('');
    expect(delegationBrief(turbo)).toBe(brief);
  });

  it('names objective, authorized scope, exclusions, sources, acceptance, checks, evidence and hints', () => {
    const brief = delegationBrief(squad);
    for (const tag of [
      'objective',
      'scope',
      'exclusions',
      'sources',
      'acceptance',
      'checks',
      'evidence',
      'hints',
    ]) {
      expect(brief).toContain(`<${tag}>`);
    }
    expect(brief).toContain('nonbinding implementation hints');
    expect(brief).toContain('never authorize scope');
  });

  it('keeps hints non-binding and dispatch unchanged', () => {
    expect(squad.replace(/\s+/g, ' ')).toContain('does not change that decision');
    expect(turbo.replace(/\s+/g, ' ')).toContain('does not change the delegation decision');
    expect(turbo.replace(/\s+/g, ' ')).toContain('Direct execution does not use this brief');
  });

  it('keeps the roster, permissions and direct paths intact', () => {
    for (const prompt of [squad, turbo]) {
      const metadata = frontmatter(prompt);
      expect(metadata).toContain('mode: primary');
      expect(allowedWorkers(prompt)).toEqual([
        'pas_researcher',
        'pas_developer',
        'pas_qa',
      ]);
      expect(metadata).not.toContain('pas_planner');
      expect(metadata).not.toContain('pair');
    }
    expect(squad).toContain('one atomic task at a time');
    expect(turbo).toContain('Default to completing work yourself');
    expect(`${squad}\n${turbo}`).not.toContain('pair-programming');
  });
});
