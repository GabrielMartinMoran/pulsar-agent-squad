/**
 * Visual presenter for the read-only `pas agents` / `pas agents list`
 * command surface.
 *
 * Renders one card per agent, with:
 *   - visible agent name
 *   - visible model / variant / reasoning effort
 *   - explicit `default` placeholder for unset values
 *   - state indicator (override ● vs default ○) — never success/failure
 *   - human-friendly model-capability guidance text
 *
 * Color policy (strict, see `shouldColorize` for the test contract):
 *   - `plain: true` always disables color
 *   - `NO_COLOR` env var set to any non-empty value disables color
 *   - non-TTY stdout disables color
 *   - `color: true` only forces color on when none of the above are set
 *
 * No external dependency on a color library: a minimal ANSI helper is
 * used so we keep the dependency surface small and the test surface
 * deterministic.
 */

import type { OpenCodeConfig } from '../../lib/config-safety';

/** Stable order of the canonical PAS agents. */
export const PAS_AGENTS: readonly string[] = [
  'Pulsar Agent Squad',
  'pas_researcher',
  'pas_developer',
  'pas_qa',
] as const;

/** ANSI SGR codes used by the presenter. */
export const ANSI = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  CYAN: '\x1b[36m',
  GREEN: '\x1b[32m',
  GRAY: '\x1b[90m',
} as const;

/** Environment-like snapshot used by `shouldColorize`. */
export interface ColorEnv {
  /** Whether stdout is a TTY. Defaults to `process.stdout.isTTY`. */
  isTTY?: boolean;
  /** Value of the NO_COLOR env var. Defaults to `process.env.NO_COLOR`. */
  noColor?: string | undefined;
}

/** Caller-controlled color options. */
export interface ColorOptions {
  /** Force-enable color (subject to --plain and NO_COLOR guards). */
  color?: boolean;
  /** Force-disable color (always wins). */
  plain?: boolean;
}

/**
 * Return the live environment snapshot the presenter uses for color
 * decisions. Pulls `process.stdout.isTTY` and `process.env.NO_COLOR` once.
 */
export function getDefaultColorEnv(): ColorEnv {
  return {
    isTTY: Boolean(process.stdout?.isTTY),
    noColor: process.env.NO_COLOR,
  };
}

/**
 * Resolve the final `colorize` boolean for a given call. The contract is:
 *   - `plain: true` always wins → false
 *   - `NO_COLOR` non-empty always wins → false
 *   - non-TTY always wins → false
 *   - on a TTY with no NO_COLOR and no --plain, color is on by default.
 *     `color: false` can force it off; `color: true` is the implicit default.
 */
export function shouldColorize(
  opts: ColorOptions = {},
  env: ColorEnv = getDefaultColorEnv(),
): boolean {
  if (opts.plain) return false;
  if (env.noColor && env.noColor.length > 0) return false;
  if (!env.isTTY) return false;
  // On a TTY with no NO_COLOR and no --plain, color is on by default.
  // `color: false` can still force it off, `color: true` is implicit.
  return opts.color !== false;
}

/**
 * Wrap `text` in `code` if `enabled` is true, otherwise return text
 * unchanged. Multi-code sequences are supported (caller can concatenate).
 */
export function colorize(text: string, code: string, enabled: boolean): string {
  if (!enabled) return text;
  return `${code}${text}${ANSI.RESET}`;
}

/** Inputs for a single agent card. */
export interface AgentCardInput {
  name: string;
  model?: string;
  variant?: string;
  guidance?: string;
  colorize: boolean;
}

const NAME_WIDTH = 24;

/**
 * Format a single agent card. The shape is intentionally stable and
 * parseable: it keeps one canonical `Model:` / `Variant:` pair.
 */
export function formatAgentCard(input: AgentCardInput): string {
  const { name, model, variant, guidance, colorize: useColor } = input;
  const isOverride = Boolean(model);
  const stateMarker = isOverride ? '●' : '○';
  const stateLabel = isOverride ? 'override' : 'default';
  const modelValue = model ?? 'default';
  const variantValue = variant && variant !== 'default' ? variant : 'default';

  // The state indicator is colored when useColor is on: green for
  // override, dim gray for default. We do NOT use success/failure glyphs.
  const markerColored = isOverride
    ? colorize(stateMarker, ANSI.GREEN, useColor)
    : colorize(stateMarker, ANSI.GRAY, useColor);
  const stateColored = colorize(stateLabel, ANSI.DIM, useColor);
  const nameColored = colorize(name, ANSI.BOLD + ANSI.CYAN, useColor);

  const lines: string[] = [];
  // Header line: <marker> <name>     · <state>
  // When color is on, the name is wrapped in ANSI codes so padEnd would
  // pad past the visible end. We use a visible-width-aware pad via
  // visibleWidth().
  const nameField = useColor
    ? padVisible(nameColored, NAME_WIDTH)
    : name.padEnd(NAME_WIDTH);
  lines.push(`${markerColored} ${nameField} · ${stateColored}`);

  // Each data line uses the format "Label: value" with exactly one space
  // after the colon, so the surface is grep-friendly
  // (e.g. `grep '^Model: '`). The LABEL_COL padding makes the value
  // column align across cards without affecting the colon/space pattern.
  const LABEL_COL_WIDTH = 18;
  const labelValueLine = (label: string, value: string) => {
    const padded = `${label}:`.padEnd(LABEL_COL_WIDTH);
    return `${padded} ${value}`;
  };
  lines.push(labelValueLine('Model', modelValue));
  lines.push(labelValueLine('Variant', variantValue));
  if (guidance) {
    const guidanceColored = colorize(guidance, ANSI.DIM, useColor);
    lines.push(labelValueLine('Guidance', guidanceColored));
  }
  return lines.join('\n');
}

/** Compute the visible width of a string, ignoring ANSI SGR sequences. */
function visibleWidth(s: string): number {
  // Strip CSI SGR sequences: \x1b[...m
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Pad a string to `width` based on its visible (ANSI-stripped) length. */
function padVisible(s: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(s));
  return s + ' '.repeat(pad);
}

// -----------------------------------------------------------------------------
// Guidance model: keep wording human-friendly, do not hardcode model names.
// -----------------------------------------------------------------------------

export type ModelGuidance = 'light' | 'heavy';

const AGENT_MODEL_GUIDANCE: Record<string, ModelGuidance> = {
  'Pulsar Agent Squad': 'heavy',
  pas_researcher: 'light',
  pas_developer: 'light',
  pas_qa: 'light',
};

const GUIDANCE_LABELS: Record<ModelGuidance, string> = {
  light: 'lighter model sufficient',
  heavy: 'heavy model recommended',
};

/**
 * Returns the model-capability guidance kind for an agent
 * (`'light' | 'heavy' | undefined`). Used by the setup wizard and any
 * callers that need the structured kind, not the human-readable label.
 */
export function getModelGuidance(agentName: string): ModelGuidance | undefined {
  return AGENT_MODEL_GUIDANCE[agentName];
}

/**
 * Returns the human-friendly model-capability guidance label for an agent
 * (e.g. "heavy model recommended"). Used by the card presenter and any
 * callers that want to display the wording directly.
 */
export function getModelGuidanceLabel(agentName: string): string | undefined {
  const kind = AGENT_MODEL_GUIDANCE[agentName];
  return kind ? GUIDANCE_LABELS[kind] : undefined;
}

// -----------------------------------------------------------------------------
// Full summary builder (used by bare `pas agents` and `pas agents list`).
// -----------------------------------------------------------------------------

function currentModelLabel(entry: unknown): string | undefined {
  if (entry && typeof entry === 'object' && 'model' in entry) {
    const m = (entry as { model?: unknown }).model;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}

function currentVariantLabel(entry: unknown): string | undefined {
  if (entry && typeof entry === 'object' && 'variant' in entry) {
    const v = (entry as { variant?: unknown }).variant;
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

/**
 * Build the multi-agent card summary. Used by both bare `pas agents` and
 * `pas agents list` so the two surfaces produce byte-identical output.
 *
 * Agents present in `config.agent` but not in `PAS_AGENTS` are ignored:
 * the summary is a view of the canonical set, not a config dump.
 */
export function buildAgentSummary(
  config: OpenCodeConfig | undefined,
  options: ColorOptions = {},
  env: ColorEnv = getDefaultColorEnv(),
): string {
  const colorize = shouldColorize(options, env);
  const agents = config?.agent;
  const blocks: string[] = [];
  for (const name of PAS_AGENTS) {
    const entry = agents?.[name];
    const modelId = currentModelLabel(entry);
    const variant = currentVariantLabel(entry);
    const guidance = getModelGuidanceLabel(name);
    blocks.push(
      formatAgentCard({
        name,
        model: modelId,
        variant,
        guidance,
        colorize,
      }),
    );
  }
  return blocks.join('\n\n');
}
