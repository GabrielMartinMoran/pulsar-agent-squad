/**
 * Skill policy library — the read/edit source of truth for
 * `permission.skill` rules in `~/.config/opencode/opencode.json`.
 *
 * This module is the foundation of the `nas skills` CLI surface. It is
 * intentionally kept as pure logic against a parsed `OpenCodeConfig`:
 *   - no I/O
 *   - no filesystem access
 *   - no process spawning
 *
 * The CLI commands wrap these functions with the read/write/backup flow
 * already provided by `config-safety.ts`.
 *
 * Scopes (per approved contract, 2026-06-30 bugfix):
 *   - `all-nas` → fan out to every canonical NAS agent as a per-agent
 *     `agent.<name>.permission.skill` block. The broad scope is the
 *     NAS agent list only — it NEVER writes to top-level
 *     `permission.skill` (which is OpenCode-wide and would leak past
 *     NAS to every non-NAS agent).
 *   - `agent`   → one specific NAS agent's `agent.<name>.permission.skill`
 *     (requires an agent name).
 *   - `all`     → used by `nas skills clear`. Clears every NAS agent's
 *     per-agent block. Does NOT touch top-level `permission.skill`
 *     (the CLI does not manage it).
 *
 * Top-level `permission.skill` is still read by `readSkillPolicies` for
 * legacy/manual inspection but the CLI never writes to it. The presenter
 * intentionally does not surface it as a managed scope.
 *
 * Actions: `'allow' | 'deny' | 'ask'` (matches OpenCode's
 * `PermissionAction` enum).
 *
 * Patterns: native OpenCode wildcards (`*`, `?`). We do NOT invent a
 * matcher — the pattern is stored verbatim and OpenCode resolves it.
 *
 * Out of scope (per the approved contract exclusions):
 *   - build-time compilation of skill policies into agent frontmatter
 *   - non-OpenCode platform support
 *   - Skill Assignment Contract filtering
 */

import type { OpenCodeConfig, PermissionAction } from './config-safety';
import { NAS_AGENTS } from '../commands/agents/presenter';

export type { PermissionAction };

export type SkillScope = 'all-nas' | 'agent' | 'all';

/** Scope values accepted by `addSkillPolicy` / `removeSkillPolicy`. */
export type WriteScope = 'all-nas' | 'agent';

export interface SkillRule {
  /** Wildcard pattern, native OpenCode syntax. */
  pattern: string;
  /** Resolved action. */
  action: PermissionAction;
}

export interface SkillPolicyView {
  global: SkillRule[];
  /** Agent name → ordered rule list. Missing agent → key absent. */
  perAgent: Record<string, SkillRule[]>;
}

const VALID_ACTIONS: ReadonlySet<PermissionAction> = new Set([
  'allow',
  'deny',
  'ask',
]);

/** Type guard for `PermissionAction`. */
export function isValidAction(value: unknown): value is PermissionAction {
  return typeof value === 'string' && VALID_ACTIONS.has(value as PermissionAction);
}

/**
 * Parse a `permission.skill` block from a single object (global or
 * per-agent). Returns an empty list when the block is missing or empty.
 * Patterns are returned in their declaration order — OpenCode resolves
 * last-match-wins, and the CLI preserves that order for the human view.
 */
function parseSkillBlock(
  block: unknown,
): SkillRule[] {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return [];
  }
  const out: SkillRule[] = [];
  for (const [pattern, rawAction] of Object.entries(block as Record<string, unknown>)) {
    if (!isValidAction(rawAction)) {
      // Skip invalid rows silently — `readConfig` would have raised on
      // bad JSON, so a bad action is the only "wrong" value that can
      // sneak in, and we don't want the read view to throw.
      continue;
    }
    out.push({ pattern, action: rawAction });
  }
  return out;
}

/**
 * Build a read-only view of all skill policies in the config.
 * Does not mutate the input.
 */
export function readSkillPolicies(config: OpenCodeConfig): SkillPolicyView {
  const view: SkillPolicyView = {
    global: parseSkillBlock(config.permission?.skill),
    perAgent: {},
  };
  const agents = config.agent ?? {};
  for (const [agentName, entry] of Object.entries(agents)) {
    if (!entry || typeof entry !== 'object') continue;
    const rules = parseSkillBlock((entry as { permission?: { skill?: unknown } }).permission?.skill);
    if (rules.length > 0) {
      view.perAgent[agentName] = rules;
    }
  }
  return view;
}

function validateScopeAndAgent(
  scope: SkillScope,
  agentName?: string,
): void {
  if (scope === 'agent' && (!agentName || agentName.length === 0)) {
    throw new Error('Scope "agent" requires a non-empty agent name.');
  }
}

/**
 * Add a single per-agent rule to `config`. Pure helper used by
 * `addSkillPolicy` for both `all-nas` (fan-out) and `agent` (single)
 * scopes. The agent block is created when needed; existing fields
 * (model, mode, ...) are preserved.
 */
function addPerAgentRule(
  config: OpenCodeConfig,
  agentName: string,
  pattern: string,
  action: PermissionAction,
): OpenCodeConfig {
  const current = config.agent?.[agentName]?.permission?.skill;
  const rules = [...parseSkillBlock(current)];
  rules.push({ pattern, action });
  return setSkillBlock(config, rules, agentName);
}

/**
 * Remove a single per-agent rule from `config`. Pure helper used by
 * `removeSkillPolicy` for both `all-nas` and `agent` scopes. Cleans up
 * the surrounding blocks when the last rule is removed.
 */
function removePerAgentRule(
  config: OpenCodeConfig,
  agentName: string,
  pattern: string,
): OpenCodeConfig {
  const current = parseSkillBlock(
    config.agent?.[agentName]?.permission?.skill,
  );
  const filtered = current.filter((r) => r.pattern !== pattern);
  if (filtered.length === current.length) return config;
  return setSkillBlock(config, filtered, agentName);
}

function validatePattern(pattern: string): void {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('Skill pattern must be a non-empty string.');
  }
}

function validateAction(action: PermissionAction): void {
  if (!isValidAction(action)) {
    throw new Error(
      `Invalid skill action "${String(action)}". Must be one of: allow, deny, ask.`,
    );
  }
}

/**
 * Return a shallow clone with the named agent entry materialized, creating
 * the agent block when needed.
 */
function withAgent(
  config: OpenCodeConfig,
  agentName: string,
  next: OpenCodeConfig['agent'][string] | undefined,
): OpenCodeConfig {
  const agents = { ...(config.agent ?? {}) };
  if (next === undefined) {
    delete agents[agentName];
  } else {
    agents[agentName] = next;
  }
  if (Object.keys(agents).length === 0) {
    const { agent: _removed, ...rest } = config;
    return rest as OpenCodeConfig;
  }
  return { ...config, agent: agents };
}

/**
 * Set the per-agent `permission.skill` block. When `rules` is empty the
 * `permission` block is removed from the agent entry, and the agent
 * block itself is dropped if no sibling fields remain (mirrored by
 * `withAgent`). Top-level `permission.skill` is never touched here —
 * the CLI does not manage it.
 */
function setSkillBlock(
  config: OpenCodeConfig,
  rules: SkillRule[],
  agentName: string,
): OpenCodeConfig {
  const agentEntry = { ...(config.agent?.[agentName] ?? {}) };
  if (rules.length === 0) {
    const { permission: _p, ...rest } = agentEntry as { permission?: unknown };
    // If the agent block has no remaining fields, drop it entirely
    if (Object.keys(rest).length === 0) {
      return withAgent(config, agentName, undefined);
    }
    return withAgent(config, agentName, rest as OpenCodeConfig['agent'][string]);
  }
  const permOnAgent = (agentEntry.permission ?? {}) as NonNullable<
    OpenCodeConfig['agent'][string]['permission']
  >;
  const skill: Record<string, PermissionAction> = {};
  for (const r of rules) skill[r.pattern] = r.action;
  return withAgent(config, agentName, {
    ...agentEntry,
    permission: { ...permOnAgent, skill },
  });
}

/**
 * Add a rule to the given scope. Returns a NEW config (input is not
 * mutated).
 *
 *   - `all-nas` → fan out: the rule is appended to every canonical NAS
 *     agent's per-agent block. Top-level `permission.skill` is NEVER
 *     written. The append order per agent matches `NAS_AGENTS` order;
 *     within a block, the rule is appended after existing rules (order
 *     matters because OpenCode resolves `permission.skill` as
 *     last-match-wins).
 *   - `agent`   → write to one specific NAS agent's per-agent block
 *     (requires `agentName`).
 */
export function addSkillPolicy(
  config: OpenCodeConfig,
  scope: WriteScope,
  pattern: string,
  action: PermissionAction,
  agentName?: string,
): OpenCodeConfig {
  validatePattern(pattern);
  validateAction(action);
  validateScopeAndAgent(scope, agentName);
  if (scope === 'all-nas') {
    let next = config;
    for (const name of NAS_AGENTS) {
      next = addPerAgentRule(next, name, pattern, action);
    }
    return next;
  }
  // scope === 'agent'
  return addPerAgentRule(config, agentName as string, pattern, action);
}

/**
 * Remove a rule from the given scope. Returns a NEW config (input is not
 * mutated). When the last rule is removed from a per-agent block, the
 * surrounding `agent.<name>` shell is cleaned up (delegated to
 * `setSkillBlock`).
 *
 *   - `all-nas` → remove the pattern from every canonical NAS agent's
 *     per-agent block. Top-level `permission.skill` is NEVER touched
 *     (legacy/manual rules are preserved as-is).
 *   - `agent`   → remove from one specific NAS agent.
 */
export function removeSkillPolicy(
  config: OpenCodeConfig,
  scope: WriteScope,
  pattern: string,
  agentName?: string,
): OpenCodeConfig {
  validatePattern(pattern);
  validateScopeAndAgent(scope, agentName);
  if (scope === 'all-nas') {
    let next = config;
    for (const name of NAS_AGENTS) {
      next = removePerAgentRule(next, name, pattern);
    }
    return next;
  }
  // scope === 'agent'
  return removePerAgentRule(config, agentName as string, pattern);
}

/**
 * Clear skill policies for the given scope.
 *
 *   - `all-nas` → drop `agent.<name>.permission.skill` for every canonical
 *     NAS agent. Top-level `permission.skill` is NEVER touched (the CLI
 *     does not manage it).
 *   - `agent`   → drop one specific NAS agent's per-agent block.
 *   - `all`     → equivalent to `all-nas` for the per-agent side; the
 *     default for `nas skills clear` ("clear everything I have"). Top-level
 *     `permission.skill` is NEVER touched.
 */
export function clearSkillPolicies(
  config: OpenCodeConfig,
  scope: SkillScope,
  agentName?: string,
): OpenCodeConfig {
  if (scope === 'all-nas' || scope === 'all') {
    // Drop the per-agent block for every canonical NAS agent, but only if
    // it exists (avoids creating empty shells).
    for (const name of NAS_AGENTS) {
      if (config.agent?.[name]?.permission?.skill) {
        config = setSkillBlock(config, [], name);
      }
    }
    return config;
  }
  // scope === 'agent'
  validateScopeAndAgent('agent', agentName);
  if (config.agent?.[agentName as string]?.permission?.skill) {
    config = setSkillBlock(config, [], agentName as string);
  }
  return config;
}
