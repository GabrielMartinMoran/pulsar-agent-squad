/**
 * Unit tests for buildAgentChoiceDescription — the pure helper that
 * renders the outer agent-selector choice description in the setup wizard.
 *
 * Rules (from FEAT-001 Gherkin):
 *   - model + explicit variant:       "(model [variant]) · guidance"
 *   - model + undefined/empty variant: "(model [default]) · guidance"
 *   - model + literal "default":      "(model [default])" (normalized)
 *   - model + literal "none":         "(model [none])"   (shown literally)
 *   - no model:                       omit model/variant group, keep guidance
 *   - value/name are never affected (tested separately in integration)
 */

import { describe, expect, it } from 'bun:test';
import { buildAgentChoiceDescription } from '../../src/cli/commands/agents/setup';

describe('buildAgentChoiceDescription', () => {
  // ---------------------------------------------------------------------------
  // Explicit variant
  // ---------------------------------------------------------------------------

  it('shows model and explicit variant with guidance', () => {
    expect(
      buildAgentChoiceDescription('openai/gpt-5.6-luna', 'xhigh', 'heavy model recommended'),
    ).toBe('(openai/gpt-5.6-luna [xhigh]) · heavy model recommended');
  });

  it('shows model and explicit variant without guidance', () => {
    expect(
      buildAgentChoiceDescription('openai/gpt-5.6-luna', 'xhigh', undefined),
    ).toBe('(openai/gpt-5.6-luna [xhigh])');
  });

  // ---------------------------------------------------------------------------
  // Default variant (undefined / empty / literal "default")
  // ---------------------------------------------------------------------------

  it('shows [default] when variant is undefined', () => {
    expect(
      buildAgentChoiceDescription('openai/gpt-5.6-luna', undefined, 'heavy model recommended'),
    ).toBe('(openai/gpt-5.6-luna [default]) · heavy model recommended');
  });

  it('shows [default] when variant is empty string', () => {
    expect(
      buildAgentChoiceDescription('openai/gpt-5.6-luna', '', 'heavy model recommended'),
    ).toBe('(openai/gpt-5.6-luna [default]) · heavy model recommended');
  });

  it('normalizes literal "default" variant to [default]', () => {
    expect(
      buildAgentChoiceDescription('openai/gpt-5.6-luna', 'default', 'heavy model recommended'),
    ).toBe('(openai/gpt-5.6-luna [default]) · heavy model recommended');
  });

  // ---------------------------------------------------------------------------
  // Literal "none" variant
  // ---------------------------------------------------------------------------

  it('shows literal "none" variant as [none]', () => {
    expect(
      buildAgentChoiceDescription('openai/gpt-5.6-luna', 'none', 'heavy model recommended'),
    ).toBe('(openai/gpt-5.6-luna [none]) · heavy model recommended');
  });

  // ---------------------------------------------------------------------------
  // No model at agent level
  // ---------------------------------------------------------------------------

  it('omits model/variant group when model is undefined', () => {
    expect(
      buildAgentChoiceDescription(undefined, undefined, 'lighter model sufficient'),
    ).toBe('lighter model sufficient');
  });

  it('omits model/variant group when model is undefined and variant is set', () => {
    // Edge case: variant shouldn't appear without a model
    expect(
      buildAgentChoiceDescription(undefined, 'xhigh', 'lighter model sufficient'),
    ).toBe('lighter model sufficient');
  });

  it('returns empty string when model and guidance are both absent', () => {
    expect(
      buildAgentChoiceDescription(undefined, undefined, undefined),
    ).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Guidance absent
  // ---------------------------------------------------------------------------

  it('shows only model/variant when guidance is absent', () => {
    expect(
      buildAgentChoiceDescription('openai/gpt-5.6-luna', 'xhigh', undefined),
    ).toBe('(openai/gpt-5.6-luna [xhigh])');
  });

  it('shows only model with [default] when variant and guidance are absent', () => {
    expect(
      buildAgentChoiceDescription('openai/gpt-5.6-luna', undefined, undefined),
    ).toBe('(openai/gpt-5.6-luna [default])');
  });

  // ---------------------------------------------------------------------------
  // Unknown / unexpected values (safe typing)
  // ---------------------------------------------------------------------------

  it('handles unknown agent config gracefully — no model, no variant', () => {
    // Simulates an agent name not in PAS_AGENTS with no config entry
    expect(
      buildAgentChoiceDescription(undefined, undefined, undefined),
    ).toBe('');
  });
});
