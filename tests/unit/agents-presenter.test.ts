/**
 * Unit tests for the agent-list visual presenter.
 *
 * The presenter is responsible for rendering the `nas agents` /
 * `nas agents list` output as a card-per-agent view, with:
 *   - visible agent name
 *   - visible model / variant / reasoning effort
 *   - explicit `default` placeholder for unset values
 *   - state indicator (override vs default, no success/failure semantics)
 *   - human-friendly model-capability guidance
 *   - optional ANSI color, with strict guards
 *
 * Color rules (must be honored for testability and CI safety):
 *   - colorize must be false when `--plain` is requested
 *   - colorize must be false when the NO_COLOR env var is set to any non-empty
 *     value
 *   - colorize must be false when the output is not a TTY
 */

import { describe, expect, it } from 'bun:test';
import {
  shouldColorize,
  colorize,
  formatAgentCard,
  buildAgentSummary,
  ANSI,
  type ColorOptions,
  type ColorEnv,
} from '../../src/cli/commands/agents/presenter';

const ttyEnv: ColorEnv = { isTTY: true, noColor: undefined };
const noTtyEnv: ColorEnv = { isTTY: false, noColor: undefined };
const noColorEnv: ColorEnv = { isTTY: true, noColor: '1' };

describe('shouldColorize — color policy for the agent-list presenter', () => {
  it('returns true when TTY, no NO_COLOR, no --plain', () => {
    expect(shouldColorize({}, ttyEnv)).toBe(true);
  });

  it('returns false when --plain is true, even on a TTY', () => {
    expect(shouldColorize({ plain: true }, ttyEnv)).toBe(false);
  });

  it('returns false when --plain is true and NO_COLOR is set', () => {
    expect(shouldColorize({ plain: true }, noColorEnv)).toBe(false);
  });

  it('returns false when NO_COLOR is set to a non-empty value, even on a TTY', () => {
    expect(shouldColorize({}, noColorEnv)).toBe(false);
  });

  it('returns false when stdout is not a TTY, even without NO_COLOR and without --plain', () => {
    expect(shouldColorize({}, noTtyEnv)).toBe(false);
  });

  it('honors an explicit color: true override only when --plain and NO_COLOR are absent', () => {
    expect(shouldColorize({ color: true }, noTtyEnv)).toBe(false); // TTY still wins
    expect(shouldColorize({ color: true }, noColorEnv)).toBe(false); // NO_COLOR still wins
    expect(shouldColorize({ color: true, plain: true }, ttyEnv)).toBe(false); // --plain still wins
  });

  it('honors an explicit color: false override', () => {
    expect(shouldColorize({ color: false }, ttyEnv)).toBe(false);
  });
});

describe('colorize — minimal ANSI helper', () => {
  it('wraps text in ANSI codes when enabled', () => {
    expect(colorize('hello', ANSI.BOLD, true)).toBe(`\x1b[1mhello\x1b[0m`);
  });

  it('returns the raw text when disabled', () => {
    expect(colorize('hello', ANSI.BOLD, false)).toBe('hello');
  });

  it('stacks multiple codes when both are enabled', () => {
    expect(colorize('x', ANSI.BOLD + ANSI.CYAN, true)).toBe(
      `\x1b[1m\x1b[36mx\x1b[0m`,
    );
  });
});

describe('formatAgentCard — card-per-agent output', () => {
  it('includes the agent name and an override indicator when a model is set', () => {
    const card = formatAgentCard({
      name: 'pas_developer',
      model: 'anthropic/claude-sonnet-4-6',
      variant: 'high',
      guidance: 'heavy model recommended',
      colorize: false,
    });
    expect(card).toContain('pas_developer');
    expect(card).toMatch(/●/); // override marker
    expect(card).toContain('override');
  });

  it('includes the agent name and a default indicator when no model is set', () => {
    const card = formatAgentCard({
      name: 'pas_qa',
      colorize: false,
    });
    expect(card).toContain('pas_qa');
    expect(card).toMatch(/○/); // default marker
    expect(card).toContain('default');
  });

  it('uses "default" placeholders and omits the retired reasoning-effort line', () => {
    const card = formatAgentCard({
      name: 'pas_qa',
      colorize: false,
    });
    expect(card).toMatch(/Model:\s+default/);
    expect(card).toMatch(/Variant:\s+default/);
    expect(card).not.toContain('Reasoning effort:');
  });

  it('shows Variant default when no variant is configured', () => {
    const card = formatAgentCard({
      name: 'pas_qa',
      model: 'opencode/deepseek-v4-pro',
      colorize: false,
    });
    expect(card).toMatch(/Model:\s+opencode\/deepseek-v4-pro/);
    expect(card).toMatch(/Variant:\s+default/);
  });

  it('includes a Variant line when a non-default variant is set', () => {
    const card = formatAgentCard({
      name: 'pas_developer',
      model: 'anthropic/claude-sonnet-4-6',
      variant: 'high',
      colorize: false,
    });
    expect(card).toMatch(/Variant:\s+high/);
  });

  it('includes a Guidance line with human-friendly wording', () => {
    const card = formatAgentCard({
      name: 'pas_developer',
      model: 'anthropic/claude-sonnet-4-6',
      guidance: 'heavy model recommended',
      colorize: false,
    });
    expect(card).toContain('Guidance:');
    expect(card).toContain('heavy model recommended');
  });

  it('omits the Guidance line when no guidance is available', () => {
    const card = formatAgentCard({
      name: 'unknown_agent',
      colorize: false,
    });
    expect(card).not.toMatch(/Guidance:/);
  });

  it('emits ANSI color codes when colorize is true', () => {
    const card = formatAgentCard({
      name: 'pas_developer',
      model: 'anthropic/claude-sonnet-4-6',
      variant: 'high',
      guidance: 'heavy model recommended',
      colorize: true,
    });
    // bold name + colored markers
    expect(card).toContain('\x1b[');
  });

  it('emits no ANSI color codes when colorize is false', () => {
    const card = formatAgentCard({
      name: 'pas_developer',
      model: 'anthropic/claude-sonnet-4-6',
      variant: 'high',
      guidance: 'heavy model recommended',
      colorize: false,
    });
    expect(card).not.toContain('\x1b[');
  });

  it('uses override/default state indicators, never success/failure semantics', () => {
    const overrideCard = formatAgentCard({
      name: 'a',
      model: 'm',
      colorize: false,
    });
    const defaultCard = formatAgentCard({
      name: 'b',
      colorize: false,
    });
    // The two states must be visually distinct but neither uses checkmark/cross
    expect(overrideCard).toMatch(/●/);
    expect(defaultCard).toMatch(/○/);
    expect(overrideCard).not.toMatch(/[✓✔]/);
    expect(defaultCard).not.toMatch(/[✗✘×]/);
  });
});

describe('buildAgentSummary — full card view over the canonical PAS agents', () => {
  it('renders every NAS agent in stable order', () => {
    const out = buildAgentSummary({}, { colorize: false });
    const names = [
      'Pulsar Agent Squad',
      'Pulsar Agent Turbo',
      'pas_researcher',
      'pas_developer',
      'pas_qa',
    ];
    let cursor = 0;
    for (const n of names) {
      const idx = out.indexOf(n, cursor);
      expect(idx).toBeGreaterThanOrEqual(0);
      cursor = idx + n.length;
    }
  });

  it('shows Model and Variant defaults for every agent without a reasoning-effort line', () => {
    const out = buildAgentSummary({}, { colorize: false });
    expect(out.match(/Model:\s+default/g)?.length).toBe(5);
    expect(out.match(/Variant:\s+default/g)?.length).toBe(5);
    expect(out).not.toContain('Reasoning effort:');
  });

  it('shows Model and configured-or-default Variant for overridden agents', () => {
    const out = buildAgentSummary(
      {
        agent: {
          pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
          pas_qa: { model: 'opencode/deepseek-v4-pro' },
        },
      },
      { colorize: false },
    );
    expect(out).toMatch(/Model:\s+anthropic\/claude-sonnet-4-6/);
    expect(out).toMatch(/Variant:\s+high/);
    expect(out).toMatch(/Model:\s+opencode\/deepseek-v4-pro/);
    expect(out.match(/Variant:\s+default/g)?.length).toBe(4);
    expect(out).not.toContain('Reasoning effort:');
  });

  it('ignores agents in config that are not in the canonical PAS_AGENTS list', () => {
    const out = buildAgentSummary(
      {
        agent: {
          random_other_agent: { model: 'some/model' },
          pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
        },
      },
      { colorize: false },
    );
    expect(out).not.toContain('random_other_agent');
    expect(out).toMatch(/Model:\s+anthropic\/claude-sonnet-4-6/);
  });

  it('is safe when config is undefined', () => {
    const out = buildAgentSummary(undefined, { colorize: false });
    expect(out).toMatch(/Model:\s+default/);
  });

  it('is safe when the agent section is missing', () => {
    const a = buildAgentSummary({ agent: undefined }, { colorize: false });
    const b = buildAgentSummary({}, { colorize: false });
    expect(a).toBe(b);
  });

  it('emits no ANSI codes when colorize is false (CI / no-TTY / --plain default for tests)', () => {
    const out = buildAgentSummary({}, { colorize: false });
    expect(out).not.toContain('\x1b[');
  });

  it('emits ANSI codes when colorize is true on a TTY', () => {
    const out = buildAgentSummary({}, { colorize: true }, ttyEnv);
    expect(out).toContain('\x1b[');
  });

  it('emits no ANSI codes when --plain overrides colorize', () => {
    const out = buildAgentSummary({}, { colorize: true, plain: true }, ttyEnv);
    expect(out).not.toContain('\x1b[');
  });
});

describe('buildAgentSummary — ColorOptions default behavior', () => {
  it('defaults to colorize: false (no opts) so tests and CI stay plain', () => {
    const out = buildAgentSummary({});
    expect(out).not.toContain('\x1b[');
  });
});
