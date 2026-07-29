/**
 * Agent-profile CRUD library.
 *
 * Pure-logic foundation of the `pas agents profile` CLI surface (FEAT-008,
 * see `specs/features/product/FEAT-008-agents-profile-crud.feature`). The
 * library is intentionally split into a pure core (`canonicalizeProfile`,
 * `applyProfileToConfig`) and thin filesystem helpers (`saveProfile`,
 * `listProfiles`, `readProfile`, `renameProfile`, `deleteProfile`). The
 * pure core is fully exercised by unit tests without the filesystem; the
 * filesystem helpers accept an explicit `home` parameter so the test
 * suite can isolate both `opencode.json` and profile files in a
 * temporary directory.
 *
 * Approved contract (persisted as
 * `specs/features/product/FEAT-008-agents-profile-crud.feature`):
 *   - Profile storage path is `~/.config/opencode/pas/profiles/<name>.json`
 *     (resolved from `HOME`, or from the explicit `home` argument).
 *   - Save behaviour: snapshot ONLY the unchanged canonical agent set from the live
 *     config, ONLY with `model` and `variant` fields. Extra fields are
 *     dropped. Reject duplicate names — existing files are NEVER
 *     overwritten.
 *   - Load behaviour: intersect the profile with `PAS_AGENTS`. Silently
 *     ignore non-canonical / orphaned profile entries (still report
 *     them in the result so the CLI can surface them). Remove live
 *     canonical overrides absent from the profile. Preserve unrelated
 *     top-level config fields and unrelated non-canonical live
 *     overrides.
 *   - Rename / delete operate on profile files only; reject missing
 *     sources and (for rename) existing targets.
 *
 * The CLI commands (under `src/cli/commands/agents/profile/*`) wrap
 * these helpers with the read/write/backup flow already provided by
 * `config-safety.ts` and `createBackup`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import type { OpenCodeConfig } from './config-safety';
import { PAS_AGENTS } from '../commands/agents/presenter';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** A single canonical agent entry as stored in a profile file. */
export interface ProfileAgentEntry {
  model: string;
  variant?: string;
}

/** A profile file's decoded payload — only canonical agents with `model`/`variant`. */
export interface ProfilePayload {
  [agentName: string]: ProfileAgentEntry | undefined;
}

/**
 * Result of `applyProfileToConfig`. Reports which canonical agents were
 * updated and which non-canonical / orphaned profile entries were
 * silently dropped, so the CLI can surface them in the response.
 */
export interface LoadResult {
  config: OpenCodeConfig;
  /** Canonical agents whose live override was set from the profile. */
  applied: string[];
  /** Non-canonical / orphaned profile entries that were ignored. */
  ignored: string[];
}

// -----------------------------------------------------------------------------
// Path resolution
// -----------------------------------------------------------------------------

const DEFAULT_HOME = (): string => process.env.HOME || process.env.USERPROFILE || '/tmp';

/**
 * Resolve the directory containing all saved profiles
 * (`<home>/.config/opencode/pas/profiles/`).
 */
export function getProfilesDir(home: string = DEFAULT_HOME()): string {
  return join(home, '.config', 'opencode', 'pas', 'profiles');
}

/**
 * Resolve the file path of a single profile (`<dir>/<name>.json`).
 * The profile name is encoded verbatim — sanitization is the CLI's
 * responsibility, not the library's.
 */
export function getProfilePath(home: string, name: string): string {
  return join(getProfilesDir(home), `${name}.json`);
}

// -----------------------------------------------------------------------------
// Pure helpers — no filesystem access
// -----------------------------------------------------------------------------

/**
 * Build the canonical, minimal profile payload from a parsed live config.
 * Pure: no I/O, no mutation.
 *
 *   - Keeps only agents whose name is in `PAS_AGENTS`.
 *   - For each kept agent, keeps ONLY the `model` and `variant` fields.
 *     All other entry-level fields (mode, permission, ...) are dropped.
 *   - Agents without a `model` field are dropped (defensive — the live
 *     entry is malformed from a profile-perspective).
 *   - Canonical agents are emitted in `PAS_AGENTS` order so the JSON
 *     file is stable and diff-friendly across runs.
 */
export function canonicalizeProfile(config: OpenCodeConfig): ProfilePayload {
  const agents = config.agent ?? {};
  const out: ProfilePayload = {};
  for (const name of PAS_AGENTS) {
    const entry = agents[name];
    if (!entry || typeof entry !== 'object') continue;
    const entryObj = entry as { model?: unknown; variant?: unknown };
    if (typeof entryObj.model !== 'string' || entryObj.model.length === 0) continue;
    const pick: ProfileAgentEntry = { model: entryObj.model };
    if (typeof entryObj.variant === 'string' && entryObj.variant.length > 0) {
      pick.variant = entryObj.variant;
    }
    out[name] = pick;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Filesystem helpers
// -----------------------------------------------------------------------------

/**
 * Write the canonical profile payload for `name` to disk.
 *
 *   - Creates the profile directory on first use (idempotent).
 *   - Throws (and never overwrites) when the profile file already
 *     exists. The contract rejects duplicate saves.
 *   - Serializes JSON with 2-space indentation to match the existing
 *     `opencode.json` style.
 *
 * Returns the absolute path of the written file.
 */
export function saveProfile(
  home: string,
  name: string,
  config: OpenCodeConfig,
): string {
  const filePath = getProfilePath(home, name);
  if (existsSync(filePath)) {
    throw new Error(`Profile "${name}" already exists at ${filePath}.`);
  }
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const payload = canonicalizeProfile(config);
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return filePath;
}

/**
 * List every saved profile for the given home, sorted by name. Returns
 * an empty array when the directory does not exist or is empty.
 * Non-`.json` files in the directory are ignored.
 */
export function listProfiles(home: string): string[] {
  const dir = getProfilesDir(home);
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    names.push(entry.slice(0, -'.json'.length));
  }
  names.sort();
  return names;
}

/**
 * Read and parse a single profile file.
 * Throws when the file does not exist or contains malformed JSON.
 */
export function readProfile(home: string, name: string): ProfilePayload {
  const filePath = getProfilePath(home, name);
  if (!existsSync(filePath)) {
    throw new Error(`Profile "${name}" does not exist at ${filePath}.`);
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Cannot read profile "${name}" at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(raw) as ProfilePayload;
  } catch (err) {
    throw new Error(
      `Malformed JSON in profile "${name}" (${filePath}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Rename a profile file from `oldName` to `newName`.
 *
 *   - Throws when the source file does not exist (the contract requires
 *     rejections for missing sources).
 *   - Throws when the target file already exists (the contract requires
 *     rejections for existing targets — no overwrites).
 *
 * Returns the new file path.
 */
export function renameProfile(home: string, oldName: string, newName: string): string {
  const oldPath = getProfilePath(home, oldName);
  const newPath = getProfilePath(home, newName);
  if (!existsSync(oldPath)) {
    throw new Error(`Profile "${oldName}" does not exist.`);
  }
  if (existsSync(newPath)) {
    throw new Error(`Profile "${newName}" already exists.`);
  }
  renameSync(oldPath, newPath);
  return newPath;
}

/**
 * Delete a profile file by name. Throws when the profile does not exist
 * (the contract requires loud rejections for missing targets).
 *
 * Returns the path of the deleted file.
 */
export function deleteProfile(home: string, name: string): string {
  const filePath = getProfilePath(home, name);
  if (!existsSync(filePath)) {
    throw new Error(`Profile "${name}" does not exist.`);
  }
  rmSync(filePath);
  return filePath;
}

// -----------------------------------------------------------------------------
// Pure intersection logic for `load`
// -----------------------------------------------------------------------------

/**
 * Pure intersection of a profile payload with `PAS_AGENTS`.
 *
 * Contract:
 *   - Canonical agents in the profile are written to the config.
 *     Existing live overrides for those agents are replaced.
 *   - Live canonical overrides ABSENT from the profile are removed.
 *   - Non-canonical / orphaned profile entries are silently ignored
 *     (not written to the config) and reported via `result.ignored`.
 *   - All other top-level config fields are preserved.
 *   - Non-canonical agent overrides in the live config are preserved.
 *   - The input config is NOT mutated.
 *
 * The returned `LoadResult.config` is the new config ready for the CLI
 * to back up + write to disk.
 */
export function applyProfileToConfig(
  config: OpenCodeConfig,
  profile: ProfilePayload,
): LoadResult {
  // Always start from a fresh clone so the original is never mutated.
  const base: OpenCodeConfig = { ...config };
  const liveAgents = base.agent ? { ...base.agent } : {};
  const canonical = new Set<string>(PAS_AGENTS);
  const applied: string[] = [];
  const ignored: string[] = [];

  // 1. Apply profile entries.
  for (const [name, entry] of Object.entries(profile)) {
    if (!canonical.has(name)) {
      ignored.push(name);
      continue;
    }
    if (!entry || typeof entry !== 'object') {
      // Treat malformed entry as ignored — never crash on load.
      ignored.push(name);
      continue;
    }
    const obj = entry as { model?: unknown; variant?: unknown };
    if (typeof obj.model !== 'string' || obj.model.length === 0) {
      ignored.push(name);
      continue;
    }
    // Preserve sibling fields on the canonical agent (mode, permission, ...).
    const existing = (liveAgents[name] ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...existing, model: obj.model };
    if (typeof obj.variant === 'string' && obj.variant.length > 0) {
      next.variant = obj.variant;
    } else {
      // No variant in the profile → drop a stale one in the live config
      // so the override matches the profile exactly.
      delete next.variant;
    }
    liveAgents[name] = next;
    applied.push(name);
  }

  // 2. Remove canonical overrides absent from the profile.
  for (const name of canonical) {
    if (applied.includes(name)) continue;
    // Anything in `applied` already has the canonical entry rewritten;
    // here we only clear canonical agents the profile did NOT touch.
    if (liveAgents[name] === undefined) continue;
    delete liveAgents[name];
  }

  if (Object.keys(liveAgents).length === 0) {
    const { agent: _removed, ...rest } = base;
    return {
      config: rest as OpenCodeConfig,
      applied,
      ignored,
    };
  }

  return {
    config: { ...base, agent: liveAgents },
    applied,
    ignored,
  };
}
