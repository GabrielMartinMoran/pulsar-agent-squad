import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const load = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ');
const researchers = [
  'src/agents/pas_researcher.md',
  'src/agents/pi/pas_researcher.md',
];

describe('independent exhaustive research contract', () => {
  for (const path of researchers) {
    describe(path, () => {
      const prompt = load(path);

      it('owns the answer and follows evidence beyond suggested entry points', () => {
        expect(prompt).toContain('Own the answer');
        expect(prompt).toContain('starting points, not a search allowlist');
        expect(prompt).toContain('without waiting for the Lead');
        expect(prompt).toContain('Explicit exclusions and access restrictions remain binding');
      });

      it('traces behavior and challenges the first plausible explanation', () => {
        expect(prompt).toContain('end to end');
        expect(prompt).toContain('semantic equivalents');
        expect(prompt).toContain('alternative explanations');
        expect(prompt).toContain('working and failing paths');
        expect(prompt).toContain('contradictory evidence');
      });

      it('bounds negative claims and distinguishes source evidence from execution', () => {
        expect(prompt).toContain('not found in inspected sources');
        expect(prompt).toContain('does not exist');
        expect(prompt).toContain('search scope');
        expect(prompt).toContain('source inspection');
        expect(prompt).toContain('runtime reproduction');
      });

      it('requires a self-owned closure check, not a Lead rescue', () => {
        expect(prompt).toContain('Continue while accessible material branches remain');
        expect(prompt).toContain('Do not hand accessible follow-ups back to the Lead');
        expect(prompt).toContain('budget exhaustion');
        expect(prompt).toContain('RESOLVED | PARTIAL | BLOCKED');
        expect(prompt).toContain('<answer>');
        expect(prompt).toContain('<closure>');
        expect(prompt).toMatch(/CONTINUE`? only for a resolved question/);
      });

      it('preserves read-only authority and the existing evidence report', () => {
        expect(prompt).toContain('never edit files');
        expect(prompt).toContain('Do not make final architecture, authorization, or QA decisions');
        for (const field of ['research_report', 'source_exhaustion', 'hypotheses', 'unknowns', 'recommendation', 'memory_writes']) {
          expect(prompt).toContain(`<${field}>`);
        }
      });
    });
  }

  it('keeps briefs concise and the Lead gate additional rather than essential', () => {
    for (const path of ['src/agents/Pulsar Agent Squad.md', 'src/agents/Pulsar Agent Turbo.md']) {
      const prompt = load(path);
      expect(prompt).toContain('question, context, read boundaries, and expected result');
      expect(prompt).toContain('researcher owns completeness');
      expect(prompt).toContain('not an exhaustive file-by-file script');
    }
  });
});
