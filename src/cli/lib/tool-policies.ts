import {
  ANSI,
  PAS_AGENTS,
  colorize,
  getDefaultColorEnv,
  shouldColorize,
  type ColorEnv,
  type ColorOptions,
} from '../commands/agents/presenter';
import {
  SUPPORTED_POLICY_VERSION,
  assertToolIdentifier,
  type AgentToolPolicy,
  type ToolPolicyStore,
} from './policy-store';

/** Global PAS scope or one named PAS agent. */
export type ToolScope = 'all-pas' | 'agent';

/** `clear` also accepts `all` as the historical alias for every PAS agent. */
export type ClearToolScope = ToolScope | 'all';

/** Tools are deny-only; this documents the single accepted effect. */
export type ToolEffect = 'deny';

/** Canonical modern action for each deprecated identifier OpenCode still documents. */
const TOOL_ALIASES: Readonly<Record<string, string>> = {
  bash: 'shell',
  task: 'subagent',
  write: 'edit',
  patch: 'edit',
};

/**
 * Documented OpenCode permission actions PAS can inject. Plugin and MCP
 * identifiers are dynamic: `normalizeTool` warns about them, and `blockTool`
 * refuses to store them because injection cannot make such a deny effective.
 */
const KNOWN_TOOLS: ReadonlySet<string> = new Set([
  'shell',
  'subagent',
  'edit',
  'read',
  'glob',
  'grep',
  'webfetch',
  'websearch',
  'question',
  'todowrite',
]);

export interface CanonicalTool {
  tool: string;
  normalizedFrom?: string;
}

export interface NormalizedTool extends CanonicalTool {
  warning?: string;
}

/**
 * Validate a raw identifier and map deprecated aliases to their canonical
 * action. Syntactically invalid input throws; an alias reports its source.
 */
export function canonicalToolIdentifier(identifier: string): CanonicalTool {
  const raw = assertToolIdentifier(identifier);
  const tool = TOOL_ALIASES[raw];
  return tool ? { tool, normalizedFrom: raw } : { tool: raw };
}

/**
 * Normalize for display. Unknown but syntactically valid identifiers are
 * returned with a warning that PAS does not inject them; nothing is granted.
 */
export function normalizeTool(identifier: string): NormalizedTool {
  const canonical = canonicalToolIdentifier(identifier);
  if (canonical.normalizedFrom) return canonical;
  if (KNOWN_TOOLS.has(canonical.tool)) return canonical;
  return {
    tool: canonical.tool,
    warning: `Unrecognized tool "${canonical.tool}": PAS does not inject undocumented tool identifiers, so this deny would not take effect.`,
  };
}

function requireInjectableTool(identifier: string): string {
  const normalized = normalizeTool(identifier);
  if (normalized.warning) {
    throw new Error(
      `Unsupported tool identifier "${normalized.tool}". ${normalized.warning}`,
    );
  }
  return normalized.tool;
}

function resolveTargets(scope: ClearToolScope, agent?: string): string[] {
  if (scope === 'all' || scope === 'all-pas') return [...PAS_AGENTS];
  if (scope !== 'agent') {
    throw new Error(
      `Unknown scope "${String(scope)}": expected "all-pas" or "agent".`,
    );
  }
  if (!agent) {
    throw new Error('Scope "agent" requires --agent <name>.');
  }
  if (!PAS_AGENTS.includes(agent)) {
    throw new Error(
      `Unknown PAS agent "${agent}". Expected one of: ${PAS_AGENTS.join(', ')}.`,
    );
  }
  return [agent];
}

function withTools(
  store: ToolPolicyStore,
  names: readonly string[],
  update: (prior: readonly string[]) => readonly string[],
): ToolPolicyStore {
  const agents: Record<string, AgentToolPolicy> = { ...store.agents };
  for (const name of names) {
    const tools = [...new Set(update(agents[name]?.tools ?? []))].sort();
    if (tools.length === 0) delete agents[name];
    else agents[name] = { tools };
  }
  return { version: SUPPORTED_POLICY_VERSION, agents };
}

/**
 * Add one deny. Repeating the same call is a no-op; an unsupported identifier
 * or a non-deny effect fails before any change is returned.
 */
export function blockTool(
  store: ToolPolicyStore,
  identifier: string,
  scope: ToolScope = 'all-pas',
  agent?: string,
  effect: string = 'deny',
): ToolPolicyStore {
  if (effect !== 'deny') {
    throw new Error(
      'Tools are deny-only; allow and ask are rejected. Edit the role prompts to change base permissions.',
    );
  }
  const tool = requireInjectableTool(identifier);
  const targets = resolveTargets(scope, agent);
  return withTools(store, targets, (prior) => [...prior, tool]);
}

/**
 * Remove one deny from the selected scope. An alias removes its canonical
 * action, so `unblock bash` and `unblock shell` are the same action.
 */
export function unblockTool(
  store: ToolPolicyStore,
  identifier: string,
  scope: ToolScope = 'all-pas',
  agent?: string,
): ToolPolicyStore {
  const { tool } = canonicalToolIdentifier(identifier);
  const targets = resolveTargets(scope, agent);
  return withTools(store, targets, (prior) =>
    prior.filter((entry) => entry !== tool),
  );
}

/**
 * Remove every tool deny in scope while preserving agents outside the PAS
 * roster. `all` is the same as `all-pas`.
 */
export function clearBlockedTools(
  store: ToolPolicyStore,
  scope: ClearToolScope = 'all-pas',
  agent?: string,
): ToolPolicyStore {
  const targets = resolveTargets(scope, agent);
  return withTools(store, targets, () => []);
}

/**
 * Render a deterministic, read-only view of every PAS agent. Unaffected
 * stored agents are intentionally omitted, matching `pas agents` behavior.
 */
export function buildToolsSummary(
  store: ToolPolicyStore,
  options: ColorOptions = {},
  env: ColorEnv = getDefaultColorEnv(),
): string {
  const colorizeOutput = shouldColorize(options, env);
  const lines = ['Tool policies (deny)'];
  for (const name of PAS_AGENTS) {
    const tools = store.agents[name]?.tools ?? [];
    const label = colorize(name, ANSI.BOLD, colorizeOutput);
    const value = tools.length
      ? tools.join(', ')
      : colorize('(none)', ANSI.DIM, colorizeOutput);
    lines.push(`${label}: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Non-blocking warnings for denies that break a role's workflow: a primary
 * losing delegation, or a worker losing shell/edit. Never a gate.
 */
export function criticalToolWarnings(store: ToolPolicyStore): string[] {
  const primary = new Set(['Pulsar Agent Squad', 'Pulsar Agent Turbo']);
  const warnings: string[] = [];
  for (const name of PAS_AGENTS) {
    const tools = store.agents[name]?.tools ?? [];
    const critical = primary.has(name) ? ['subagent'] : ['edit', 'shell'];
    for (const tool of critical) {
      if (tools.includes(tool)) {
        warnings.push(
          `Warning: ${name} blocks workflow-critical ${tool}.`,
        );
      }
    }
  }
  return warnings;
}
