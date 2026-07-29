/**
 * Visual presenter for the read-only `nas skills` / `nas skills list`
 * command surface.
 *
 * Renders one card per NAS agent (per-agent
 * `agent.<name>.permission.skill`). The top-level `permission.skill`
 * block is intentionally NOT shown — the CLI does not manage it
 * (writing to it would leak to every non-NAS agent via OpenCode's
 * inheritance), so the read-only view does not surface it as a
 * managed scope. Legacy/manual top-level rules are silently ignored
 * here; users can still see them in their raw `opencode.json`.
 *
 * The shape is grep-friendly: every rule row uses the `Pattern:` / `Action:`
 * labels, with no ANSI inside the value, so the same surface can be
 * piped/grepped.
 *
 * Color policy mirrors the `nas agents` presenter: `plain` wins, then
 * `NO_COLOR`, then non-TTY. No external color dependency.
 */

import {
  shouldColorize as agentsShouldColorize,
  colorize as agentsColorize,
  ANSI as AGENT_ANSI,
  getDefaultColorEnv as agentsGetDefaultColorEnv,
  NAS_AGENTS,
  type ColorEnv,
  type ColorOptions,
} from '../agents/presenter';
import type { SkillPolicyView, SkillRule } from '../../lib/skill-policies';

export type { ColorEnv, ColorOptions };

export const ANSI = AGENT_ANSI;

export interface SkillSummaryOptions extends ColorOptions {}

/** Single rule row, ready for rendering. */
export interface SkillSummaryCardInput {
  scopeLabel: string;
  rules: SkillRule[];
  colorize: boolean;
}

export type SkillSummaryCard = SkillSummaryCardInput;

export function getDefaultColorEnv(): ColorEnv {
  return agentsGetDefaultColorEnv();
}

export function shouldColorize(
  opts: SkillSummaryOptions = {},
  env: ColorEnv = getDefaultColorEnv(),
): boolean {
  return agentsShouldColorize(opts, env);
}

function colorize(text: string, code: string, enabled: boolean): string {
  return agentsColorize(text, code, enabled);
}

const LABEL_COL_WIDTH = 12;
const NAME_WIDTH = 24;

function labelValueLine(label: string, value: string): string {
  const padded = `${label}:`.padEnd(LABEL_COL_WIDTH);
  return `${padded} ${value}`;
}

/**
 * Format a single scope card. The shape is stable and grep-friendly:
 *
 *   <marker> <scope>       · <state>
 *   Pattern:    ...
 *   Action:     ...
 *   ...
 *   Pattern:    (no rules)
 *
 * The `(no rules)` placeholder is shown verbatim so callers can grep for
 * it.
 */
export function formatSkillScopeCard(input: SkillSummaryCardInput): string {
  const { scopeLabel, rules, colorize: useColor } = input;
  const isOverride = rules.length > 0;
  const stateMarker = isOverride ? '●' : '○';
  const stateLabel = isOverride ? 'override' : 'default';

  const markerColored = isOverride
    ? colorize(stateMarker, ANSI.GREEN, useColor)
    : colorize(stateMarker, ANSI.GRAY, useColor);
  const stateColored = colorize(stateLabel, ANSI.DIM, useColor);
  const nameColored = colorize(scopeLabel, ANSI.BOLD + ANSI.CYAN, useColor);

  const lines: string[] = [];
  // Header line
  const nameField = useColor
    ? padVisible(nameColored, NAME_WIDTH)
    : scopeLabel.padEnd(NAME_WIDTH);
  lines.push(`${markerColored} ${nameField} · ${stateColored}`);

  if (rules.length === 0) {
    const placeholder = '(no rules)';
    const dim = colorize(placeholder, ANSI.DIM, useColor);
    lines.push(labelValueLine('Pattern', dim));
    return lines.join('\n');
  }

  for (const r of rules) {
    lines.push(labelValueLine('Pattern', r.pattern));
    lines.push(labelValueLine('Action', r.action));
  }
  return lines.join('\n');
}

/** Visible width of `s`, ignoring ANSI SGR sequences. */
function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Pad `s` to `width` based on its visible (ANSI-stripped) length. */
function padVisible(s: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(s));
  return s + ' '.repeat(pad);
}

/**
 * Build the full read-only summary used by both bare `nas skills` and
 * `nas skills list`. The two surfaces produce byte-identical output.
 *
 * The summary includes one card per canonical NAS agent in
 * `NAS_AGENTS` order. Agents without a `permission.skill` block are
 * still listed (with `(no rules)`) so the view is exhaustive. The
 * top-level `permission.skill` view (`view.global`) is intentionally
 * ignored — the CLI does not manage it.
 */
export function buildSkillSummary(
  view: SkillPolicyView,
  options: SkillSummaryOptions = {},
  env: ColorEnv = getDefaultColorEnv(),
): string {
  const useColor = shouldColorize(options, env);
  const blocks: string[] = [];

  // Header line — stable so callers can grep the source of truth
  const header = colorize(
    'OpenCode `permission.skill` — NAS agents only (read-only)',
    ANSI.BOLD,
    useColor,
  );
  blocks.push(header);

  // One card per canonical NAS agent, in stable order. The top-level
  // `view.global` is intentionally not rendered here.
  for (const name of NAS_AGENTS) {
    blocks.push(
      formatSkillScopeCard({
        scopeLabel: name,
        rules: view.perAgent[name] ?? [],
        colorize: useColor,
      }),
    );
  }

  return blocks.join('\n\n');
}

// Re-export NAS_AGENTS for tests / callers that want the same canonical
// order as the agents presenter.
export { NAS_AGENTS };
