import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('pas_engineer prompt contract', () => {
  it('is self-contained and has no shared-template markers', () => {
    const prompt = readFileSync('src/agents/pas_engineer.md', 'utf-8');
    expect(prompt).toContain('## Hard constraints');
    expect(prompt).toContain('## Tool guidance');
    expect(prompt).toContain('<implementation_report>');
    expect(prompt).toContain('<verdict>PASS | FAIL | BLOCKED</verdict>');
    expect(prompt).toContain('<skills_applied>');
    expect(prompt).toContain('<test_coverage_explanation>');
    expect(prompt).toContain('<memory_writes>');
    expect(prompt).not.toContain('INJECT:developer_shared');
    expect(prompt).not.toContain('developer_mini');
  });
});

describe('pyramid testing policy contract', () => {
  it('requires the engineer to choose the cheapest sufficient test level', () => {
    const prompt = readFileSync('src/agents/pas_engineer.md', 'utf-8');

    expect(prompt).toContain('cheapest sufficient level');
    expect(prompt).toContain('unit');
    expect(prompt).toContain('integration');
    expect(prompt).toContain('E2E');
    expect(prompt).toContain('Do not turn every Gherkin scenario into an E2E test');
    expect(prompt).toContain('<test_strategy_review>');
  });

  it('requires the copilot to review cost, duplication, and portfolio shape', () => {
    const prompt = readFileSync('src/agents/pas_copilot.md', 'utf-8');

    expect(prompt).toContain('cheapest sufficient level');
    expect(prompt).toContain('lower-level alternative');
    expect(prompt).toContain('duplicat');
    expect(prompt).toContain('HEALTHY_PYRAMID');
    expect(prompt).toContain('TOP_HEAVY');
    expect(prompt).toContain('INVERTED');
    expect(prompt).toContain('test_strategy');
    expect(prompt).toContain('<test_strategy_review>');
  });

  it('requires the Lead plan to assign a test level and rationale', () => {
    const prompt = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');

    expect(prompt).toContain('test level');
    expect(prompt).toContain('cheapest sufficient');
    expect(prompt).toContain('E2E justification');
  });

  it('defines pyramid shape as a qualitative invariant without fixed ratios', () => {
    // The Lead prompt is prose; normalize whitespace so the pinned phrases
    // match across line breaks (same convention as build.test.ts).
    const prompt = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8')
      .replace(/\s+/g, ' ');

    expect(prompt).toContain('clearly pyramidal');
    expect(prompt).toContain('fixed numerical ratio');
    expect(prompt).toContain('cheapest sufficient level');
  });
});
