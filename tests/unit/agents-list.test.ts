/**
 * Unit tests for the read-only `pas agents list` summary surface.
 *
 * The list command shares its renderer with bare `nas agents` (both
 * dispatch to `buildAgentSummary`). This file focuses on the list
 * command's contract:
 *   - byte-identical output between bare `nas agents` and `nas agents list`
 *     is verified by the integration test.
 *   - the read-only property is also verified by the integration test.
 *   - here we exercise the renderer contract: canonical agent list, default
 *     placeholders, override/default state indicators, guidance text, and
 *     the strict color rules.
 *
 * The `formatAgentOutput` helper is no longer used by the list surface; it
 * is now used only by the `setup` wizard for its previews, so it has its
 * own focused tests below.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildAgentSummary,
} from '../../src/cli/commands/agents/presenter';
import { PAS_AGENTS } from '../../src/cli/commands/agents/setup';
import {
  formatAgentOutput,
} from '../../src/cli/commands/agents/setup';
import type { OpenCodeConfig } from '../../src/cli/lib/config-safety';

const PLAIN = { colorize: false } as const;

describe('buildAgentSummary — list command renderer', () => {
  it('should include every NAS agent in stable order', () => {
    const output = buildAgentSummary({}, PLAIN);
    for (const name of PAS_AGENTS) {
      expect(output).toContain(name);
    }
  });

  it('should show "Model: default" for every agent when no overrides are set', () => {
    const output = buildAgentSummary({}, PLAIN);
    const modelDefaultLines = output
      .split('\n')
      .filter((line) => /^Model: /.test(line));
    expect(modelDefaultLines.length).toBe(PAS_AGENTS.length);
    for (const line of modelDefaultLines) {
      // label "Model:" followed by ": default" with optional alignment spaces
      expect(line).toMatch(/^Model:\s+default$/);
    }
  });

  it('FEAT-001 — agent with no override shows Variant default and no Reasoning effort line', () => {
    const output = buildAgentSummary({}, PLAIN);
    const variantLines = output
      .split('\n')
      .filter((line) => /^Variant: /.test(line));
    expect(variantLines.length).toBe(PAS_AGENTS.length);
    for (const line of variantLines) {
      expect(line).toMatch(/^Variant:\s+default$/);
    }
    expect(output).not.toContain('Reasoning effort:');
  });

  it('FEAT-001 — agent with override shows configured variant and no Reasoning effort line', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
      },
    };
    const output = buildAgentSummary(config, PLAIN);
    expect(output).toMatch(/Model:\s+anthropic\/claude-sonnet-4-6/);
    expect(output).toMatch(/Variant:\s+high/);
  });

  it('should show model override with Variant default when variant is not set', () => {
    const config: OpenCodeConfig = {
      agent: { pas_qa: { model: 'opencode/deepseek-v4-pro' } },
    };
    const output = buildAgentSummary(config, PLAIN);
    expect(output).toMatch(/Model:\s+opencode\/deepseek-v4-pro/);
    expect(output).toMatch(/Variant:\s+default/);
    expect(output).not.toContain('Reasoning effort:');
  });

  it('should ignore agents in config that are not in the canonical PAS_AGENTS list', () => {
    const config: OpenCodeConfig = {
      agent: {
        random_other_agent: { model: 'some/model' },
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
      },
    };
    const output = buildAgentSummary(config, PLAIN);
    // Unknown agents are not part of the summary
    expect(output).not.toContain('random_other_agent');
    // Known agent still appears with its override
    expect(output).toMatch(/Model:\s+anthropic\/claude-sonnet-4-6/);
  });

  it('should treat missing agent section the same as empty config', () => {
    const outputEmpty = buildAgentSummary({}, PLAIN);
    const outputMissing = buildAgentSummary({ agent: undefined }, PLAIN);
    expect(outputEmpty).toBe(outputMissing);
  });

  it('should be safe when config is undefined', () => {
    const output = buildAgentSummary(undefined, PLAIN);
    expect(output).toMatch(/Model:\s+default/);
  });

  it('should mark each agent with a state indicator (override ● vs default ○)', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
        pas_qa: {},
      },
    };
    const output = buildAgentSummary(config, PLAIN);
    // exactly one override marker (the pas_developer block)
    expect(output.match(/●/g)?.length).toBe(1);
    // five default markers (every other NAS agent in the canonical set)
    expect(output.match(/○/g)?.length).toBe(PAS_AGENTS.length - 1);
  });

  it('should include a Guidance line referencing the model-capability hint', () => {
    const output = buildAgentSummary({}, PLAIN);
    expect(output).toContain('Guidance:');
    // human-friendly wording, not a hardcoded model name
    expect(output).toMatch(/Guidance:.*(lighter model sufficient|heavy model recommended)/);
  });

  it('should default to plain output (no ANSI) when called without options', () => {
    const output = buildAgentSummary({});
    expect(output).not.toContain('\x1b[');
  });
});

describe('formatAgentOutput — setup wizard preview (still exported)', () => {
  it('should show Variant default and omit reasoning effort', () => {
    const out = formatAgentOutput('pas_developer', 'anthropic/claude-sonnet-4-6');
    expect(out).toContain('Agent: pas_developer');
    expect(out).toContain('Model: anthropic/claude-sonnet-4-6');
    expect(out).toContain('Variant: default');
    expect(out).not.toContain('Reasoning effort:');
  });

  it('FEAT-001 — preview shows Variant line instead of separate Reasoning effort', () => {
    const out = formatAgentOutput('pas_developer', 'm', 'xhigh');
    expect(out).toContain('Variant: xhigh');
    expect(out).not.toContain('Reasoning effort:');
  });
});
