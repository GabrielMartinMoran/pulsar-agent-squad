import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

const lead = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');
const engineer = readFileSync('src/agents/pas_engineer.md', 'utf-8');
const copilot = readFileSync('src/agents/pas_copilot.md', 'utf-8');
const turbo = readFileSync('src/agents/Pulsar Agent Turbo.md', 'utf-8');
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

const sections = [
  'context', 'authorization', 'objective', 'acceptance', 'scope',
  'hard_constraints', 'implementation_hints', 'execution_policy',
  'verification', 'skill_assignment', 'response_contract', 'task_notes',
];

describe('delegation contract structure', () => {
  it('provides one balanced XML template with all agreed sections', () => {
    const template = lead.match(/```xml\n(<delegation_contract version="1\.0">[\s\S]*?<\/delegation_contract>)\n```/)?.[1];
    expect(template).toBeDefined();
    const stack: string[] = [];
    const topLevel: string[] = [];
    for (const match of template!.matchAll(/<(\/)?([a-z_]+)(?:\s[^<>]*)?>/g)) {
      const [, closing, name] = match;
      if (closing) {
        expect(stack.pop()).toBe(name);
      } else {
        if (stack.length === 1) topLevel.push(name!);
        stack.push(name!);
      }
    }
    expect(stack).toEqual([]);
    expect(topLevel).toEqual(sections);
    expect(template).not.toContain('role_assignment');
    for (const nested of ['plan_ref', 'contract_refs', 'approval_ref', 'included', 'excluded', 'scoped_checks', 'peer_checks', 'engineer', 'copilot']) {
      expect(template).toContain(`<${nested}>`);
    }
  });

  it('requires both workers to consume the contract and existing references', () => {
    for (const prompt of [engineer, copilot]) {
      const text = normalize(prompt);
      expect(text).toContain('Receive one <delegation_contract version="1.0">');
      expect(text).toContain('Load the referenced plan, relevant .pas/state/ artifacts, and assigned Gherkin scenarios');
      expect(text).toContain('Do not invent authorization.yaml');
      expect(text).toContain('A missing non-critical skill is a warning');
    }
  });

  it('makes the Lead pass skills and execution policy without creating an authorization file', () => {
    const text = normalize(lead);
    expect(text).toContain('Send the complete contract in each brief');
    expect(text).toContain('Load each assigned skill');
    expect(text).toContain('The contract is the delegation brief, not a new mandatory file');
    expect(text).toContain('An unavailable future test file is not a pre-flight blocker');
  });

  it('keeps Turbo compatible with the shared worker input contract', () => {
    expect(normalize(turbo)).toContain('Send the complete <delegation_contract>');
    const template = (prompt: string) => prompt.match(/```xml\n(<delegation_contract version="1\.0">[\s\S]*?<\/delegation_contract>)\n```/)?.[1];
    expect(template(turbo)).toBeDefined();
    expect(template(turbo)).toBe(template(lead));
  });
});

// These assertions protect the prompt contract, not model execution. The live
// evaluation cases in docs/delegation-evaluation.md require independent runs.
describe('bounded autonomy instructions', () => {
  it('treats file hints as advisory while preserving exclusions', () => {
    for (const prompt of [lead, engineer, copilot]) {
      const text = normalize(prompt);
      expect(text).toContain('Implementation hints are advisory, not an exhaustive file allowlist');
      expect(text).toContain('Peer agreement does not authorize crossing those boundaries');
    }
    expect(normalize(engineer)).toContain('Create or modify additional files directly necessary');
    expect(normalize(copilot)).toContain('An unlisted file is not scope creep by itself');
  });

  it('requires investigation and permits fixing own failures without a global stop', () => {
    const text = normalize(engineer);
    expect(text).toContain('Resolve verifiable uncertainty with permitted tools');
    expect(text).toContain('Correct defects caused by your work within the approved scope');
    expect(text).not.toContain('When in doubt, escalate instead of guessing');
    expect(text).not.toContain('Escalate immediately when the task is ambiguous');
    expect(text).not.toContain('Escalate uncertainty, scope pressure, tool denial, or failing required checks');
  });

  it('requires an actionable blocker without imposing a retry ritual', () => {
    for (const prompt of [engineer, copilot]) {
      const text = normalize(prompt);
      expect(text).toContain('Identify the necessary step, exact constraint or observed error');
      expect(text).toContain('minimum Lead decision needed');
      expect(text).toContain('Do not retry an explicit permission denial');
    }
  });

  it('uses authorized areas rather than forecast files for room setup', () => {
    expect(normalize(lead)).toContain('`authorized_paths` records editable areas, not implementation hints');
    expect(normalize(lead)).not.toContain('Every task lists all paths it will touch');
  });
});
