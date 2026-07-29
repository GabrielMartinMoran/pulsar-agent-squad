/**
 * Safe editing of ~/.config/opencode/opencode.json.
 *
 * Guarantees:
 * - Backup before any modification
 * - Parse → modify → stringify (never string manipulation)
 * - Preserve unknown keys
 * - Clean up empty agent section
 * - 2-space indentation
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';

/**
 * One row of an OpenCode permission map. Both top-level and per-agent
 * `permission` blocks share this shape, which is a record of wildcard
 * patterns mapped to an action.
 */
export type PermissionAction = 'ask' | 'allow' | 'deny';
export type PermissionRuleConfig =
  | PermissionAction
  | Record<string, PermissionAction>;

/**
 * Top-level OpenCode `permission` block. Keys are tool names (e.g. `edit`,
 * `bash`, `skill`); values are either a flat action or a per-pattern map.
 *
 * The `skill` key is the one `nas skills` operates on. The other keys are
 * surfaced as unknown so the rest of the codebase does not lose fidelity
 * when round-tripping the config.
 */
export interface PermissionConfig {
  skill?: Record<string, PermissionAction>;
  [tool: string]: PermissionRuleConfig | undefined;
}

/**
 * Single NAS-style permission row. Mirrors the OpenCode shape but
 * canonicalizes the flat-action form to a `{ pattern, action }` pair so
 * the rest of the codebase can iterate in a single, stable order.
 */
export interface PermissionEntry {
  /** Wildcard pattern (OpenCode-native: `*`, `?`). */
  pattern: string;
  /** Resolved action. */
  action: PermissionAction;
}

export interface OpenCodeConfig {
  $schema?: string;
  default_agent?: string;
  mcp?: Record<string, unknown>;
  instructions?: unknown[];
  plugin?: unknown[];
  provider?: Record<string, unknown>;
  permission?: PermissionConfig;
  agent?: Record<
    string,
    {
      model?: string;
      mode?: string;
      permission?: PermissionConfig;
      [key: string]: unknown;
    }
  >;
  [key: string]: unknown;
}

const DEFAULT_PATH = (): string => {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return `${home}/.config/opencode/opencode.json`;
};

/**
 * Read and parse opencode.json from disk.
 * Returns minimal valid config if file doesn't exist.
 * Throws if JSON is malformed.
 */
export function readConfig(path?: string): OpenCodeConfig {
  const filePath = path || DEFAULT_PATH();

  if (!existsSync(filePath)) {
    return {};
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read config at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    return JSON.parse(raw) as OpenCodeConfig;
  } catch (err) {
    throw new Error(`Malformed JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Create a timestamped backup: opencode.json → opencode.json.bak.YYYYMMDDHHmmss
 * Returns the backup path, or empty string if source doesn't exist.
 */
export function createBackup(path?: string): string {
  const filePath = path || DEFAULT_PATH();

  if (!existsSync(filePath)) {
    return '';
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');

  const backupPath = `${filePath}.bak.${ts}`;
  copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Add or update a model override for an agent.
 * Optionally sets or removes a variant field.
 * - When variant is provided and not "default": sets variant in agent config
 * - When variant is "default": removes variant field (inherit default)
 * - When variant is undefined: preserves existing variant field if present
 * Returns a new config object (does not mutate input).
 */
export function setAgentModel(
  config: OpenCodeConfig,
  agentName: string,
  modelId: string,
  variant?: string,
): OpenCodeConfig {
  const result = { ...config };

  if (!result.agent) {
    result.agent = {};
  }

  const existing = result.agent[agentName] || {};
  const entry: Record<string, unknown> = {
    ...existing,
    model: modelId,
  };

  if (variant !== undefined && variant !== 'default') {
    entry.variant = variant;
  } else if (variant === 'default') {
    // Remove variant field to inherit default — use destructured omit
    const { variant: _removed, ...rest } = entry;
    result.agent = {
      ...result.agent,
      [agentName]: rest,
    };
    return result;
  }
  // variant is undefined: preserve existing variant field (leave it in via ...existing spread)

  result.agent = {
    ...result.agent,
    [agentName]: entry,
  };

  return result;
}

/**
 * Remove an agent's model override (inherit default).
 * Cleans up empty agent section if last entry removed.
 * Returns a new config object (does not mutate input).
 */
export function removeAgentOverride(config: OpenCodeConfig, agentName: string): OpenCodeConfig {
  if (!config.agent) return { ...config };

  const { [agentName]: _removed, ...remainingAgents } = config.agent;

  // If nothing was removed, return copy unchanged
  if (Object.keys(remainingAgents).length === Object.keys(config.agent).length) {
    return { ...config };
  }

  const result = { ...config };

  if (Object.keys(remainingAgents).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { agent: _empty, ...rest } = result;
    return rest as OpenCodeConfig;
  }

  result.agent = remainingAgents;
  return result;
}

/**
 * Write config to disk with 2-space indentation.
 * NOTE: Caller is responsible for calling createBackup() before this.
 */
export function writeConfig(config: OpenCodeConfig, path?: string): void {
  const filePath = path || DEFAULT_PATH();
  const json = JSON.stringify(config, null, 2) + '\n';
  writeFileSync(filePath, json, 'utf-8');
}
