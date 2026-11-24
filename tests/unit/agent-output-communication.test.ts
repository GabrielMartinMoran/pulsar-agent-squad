import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

const squad = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');
const turbo = readFileSync('src/agents/Pulsar Agent Turbo.md', 'utf-8');

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function section(text: string, heading: string): string {
  return flatten(text.split(heading)[1]?.split('\n## ')[0] ?? '');
}

const squadFlat = flatten(squad);
const turboFlat = flatten(turbo);
const squadSequencing = section(squad, '## Subagent sequencing');
const squadClosing = section(squad, '## Session termination');
const turboClosing = section(turbo, '## Compact handoff and final report');

describe('C1: Squad reports a verified milestone once', () => {
  it('does not template a user-visible verdict line per worker', () => {
    expect(squadSequencing).not.toContain('[role] VERDICT');
    expect(squadFlat).not.toContain('After every subagent, emit one progress line');
    expect(squadSequencing).toContain('not with a raw worker verdict prefix');
  });

  it('continues from an accepted developer result to independent QA without a success line', () => {
    expect(squadSequencing).toContain(
      'continue to independent QA without a separate success line',
    );
    expect(squadSequencing).toContain('independent QA');
    expect(squadSequencing).toContain('emit one verified milestone for that task');
    expect(squadSequencing).toContain('fold it into the final delivery');
  });

  it('keeps the research cadence and the Research Quality Gate', () => {
    expect(squadSequencing).toContain('after each completed researcher');
    expect(squadSequencing).toContain('one progress line per completed subagent');
    expect(squadSequencing).toContain('Research Quality Gate');
    expect(squadSequencing).toContain('standalone research result leads with its finding');
  });
});

describe('C2: a material issue is surfaced when it arises', () => {
  it('reports material failures, deviations, blockers, and decisions promptly in both modes', () => {
    for (const prompt of [squadFlat, turboFlat]) {
      expect(prompt).toContain('material failure, deviation, blocker, or decision');
      expect(prompt).toContain('success pair');
    }
    expect(squadFlat).toContain('without waiting for a success pair');
  });

  it('says whether other work can proceed and separates a pending check from a blocked delivery', () => {
    for (const prompt of [squadFlat, turboFlat]) {
      expect(prompt).toContain('whether other work can proceed');
      expect(prompt.toLowerCase()).toContain(
        'distinguish a pending check from a blocked delivery',
      );
    }
    expect(squadFlat).toContain(
      'not evidence that the task failed, passed, or must stop',
    );
  });
});

describe('C3: a substantive closing is recognizable and scannable', () => {
  it('starts with a truthful descriptive heading and leads with the outcome', () => {
    for (const closing of [squadClosing, turboClosing]) {
      expect(closing).toContain('descriptive Markdown heading');
      expect(closing).toContain('names the result and its real state');
      expect(closing).toContain('what changed or what was learned');
      expect(closing.toLowerCase()).toContain('verification');
      expect(closing.toLowerCase()).toContain('actionable gaps');
      expect(closing.toLowerCase()).toContain('next step');
    }
  });

  it('retains the required closing facts without repeating a progress notice', () => {
    for (const closing of [squadClosing, turboClosing]) {
      expect(closing.toLowerCase()).toContain('scope');
      expect(closing.toLowerCase()).toContain('limitations');
      expect(closing.toLowerCase()).toContain('qa');
      expect(closing.toLowerCase()).toContain('do not repeat an identical');
    }
    expect(squadClosing).toContain('Files changed');
    expect(squadClosing).toContain('Subagents');
    expect(squadClosing).toContain('QA verdict');
    expect(squadClosing).toContain('aborted (include the reason');
    expect(turboClosing).toContain('changed paths');
    expect(turboClosing).toContain('direct vs delegated');
    expect(turboClosing).toContain('worker count per role');
    expect(turboClosing).toContain('`SELF | INDEPENDENT | NONE`');
    expect(turboClosing).toContain('reason when work was interrupted');
  });
});

describe('C4: a quick answer does not require a delivery template', () => {
  it('answers quick questions directly in both modes', () => {
    expect(squadFlat).toContain('quick question is not a session closing');
    expect(turboFlat).toContain('quick question is not a workflow closing');
    for (const prompt of [squadFlat, turboFlat]) {
      expect(prompt).toContain('participant counts');
    }
  });

  it('keeps the approval gate and the internal report and QA semantics', () => {
    const approval =
      'Implementation plan is ready. Do you want me to apply it now?';
    expect(squadFlat).toContain(approval);
    expect(turboFlat).toContain(approval);
    expect(squadFlat).toContain('Internal worker reports keep their structured verdicts');
    expect(turboFlat).toContain('Keep internal worker reports structured');
    expect(turboFlat).toContain('independent QA is optional');
    expect(turboFlat).toContain('invoke `pas_qa` for high-risk work');
  });

  it('shows contrast examples as copy, not as a required template', () => {
    for (const prompt of [squadFlat, turboFlat]) {
      expect(prompt).toContain('Example shapes only, not required wording');
      expect(prompt).toContain('Verified success:');
      expect(prompt).toContain('Pending verification:');
      expect(prompt).toContain('Research finding:');
    }
  });
});
