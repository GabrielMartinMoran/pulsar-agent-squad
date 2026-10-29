import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

for (const name of ['Pulsar Agent Squad', 'Pulsar Agent Turbo']) {
  const prompt = readFileSync(`src/agents/${name}.md`, 'utf-8');
  const flatPrompt = prompt.replace(/\s+/g, ' ');
  const clarification = prompt.split('## Clarification before planning')[1]?.split('\n## ')[0]?.replace(/\s+/g, ' ') ?? '';
  const presentation = prompt.split('## Human-readable plan')[1]?.split('\n## ')[0]?.replace(/\s+/g, ' ') ?? '';

  describe(`${name}: planning communication contract`, () => {
    it('separates verifiable facts from user choices and blocks premature planning', () => {
      expect(clarification).toContain('Investigate facts; ask the user to make choices');
      expect(clarification).toContain('Before drafting the implementation plan');
      expect(clarification).toContain('no unresolved user choices');
      expect(clarification).toContain('Recommendations are not decisions');
      expect(clarification).toContain('explicitly delegates that specific choice');
      expect(clarification).toContain('**Agent decisions**');
    });

    it('classifies decisions into ask, decide-and-disclose, and announce', () => {
      expect(clarification).toContain('**Ask the user**');
      expect(clarification).toContain('**Decide and disclose**');
      expect(clarification).toContain('**Announce, never ask**');
      expect(clarification).toContain('internal structure, test strategy, helper placement');
      expect(clarification).toContain('adjustments to existing tests that stay within approved behavior');
      expect(clarification).toContain('worker hygiene deviations with no repository or behavior impact');
      expect(clarification).toContain('announced, not escalated');
    });

    it('limits interruptions to blocking questions and collapses approvals', () => {
      expect(clarification).toContain('Ask only when the answer blocks the current step');
      expect(clarification).toContain('resolve them in one batch at the phase boundary');
      expect(clarification).toContain('never in the middle of an atomic task');
      expect(clarification).toContain('One decision, one round trip');
      expect(clarification).toContain('never request a second confirmation');
      expect(clarification).toContain('Check configuration and repository evidence before asking');
      expect(clarification).toContain('Do not ask the user to confirm an inference');
    });

    it('continues clarification across partial answers, new evidence, and implementation', () => {
      expect(clarification).toContain('no total limit on questions or rounds');
      expect(clarification).toContain('Silence, partial answers, and previous approvals are not consent');
      expect(clarification).toContain('After each answer or research result');
      expect(clarification).toContain('Workers report questions to you');
      expect(clarification).toContain('decide and disclose when it stays inside approved behavior');
      expect(clarification).toContain('not implementation approval');
    });

    it('requires a faithful chat presentation in addition to the technical artifact', () => {
      expect(presentation).toContain("user's language");
      expect(presentation).toContain('directly in chat');
      expect(presentation).toContain('A file link or raw artifact dump is not a presentation');
      for (const heading of ['Expected outcome', 'Scope', 'Your decisions', 'Agent decisions', 'Steps', 'Affected areas', 'Verification', 'Risks and limitations', 'Approval']) {
        expect(presentation).toContain(`**${heading}**`);
      }
      expect(presentation).toContain('the user can veto them at this approval point');
      expect(presentation).toContain('agree on scope, user decisions, agent decisions, steps, verification, and risks');
      expect(presentation).toContain('Do not hide consequential details to shorten the output');
    });

    it('defines useful visual hierarchy rather than decorative Markdown', () => {
      for (const instruction of ['descriptive headings', 'short paragraphs', 'whitespace', 'bullets', 'numbered lists', '**bold**', '*italics*', 'inline code', 'code blocks', 'tables only for comparisons', 'Explain necessary technical terms']) {
        expect(presentation).toContain(instruction);
      }
      expect(presentation).toContain('scanning headings, opening sentences, and emphasized text');
      expect(presentation).toContain('what will change, what is excluded, what they must decide');
      expect(presentation).toContain('which agent decisions they can veto');
    });

    it('requires complete task contracts to avoid amendment churn', () => {
      expect(flatPrompt).toContain('all paths it will touch');
      expect(flatPrompt).toContain('applies immediately or after restart');
      expect(flatPrompt).toContain('unwired');
    });
  });
}
