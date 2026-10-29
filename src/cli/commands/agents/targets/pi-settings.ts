/**
 * Pure Pi settings adapter.
 *
 * Reads, merges, prunes and writes `~/.pi/agent/settings.json` without knowing
 * where "home" is. Callers pass explicit paths; this module never invokes the
 * Pi binary, prompts, or exits the process.
 *
 * Unknown settings keys and their value types are preserved at every level.
 */

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export class PiSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PiSettingsError';
  }
}

/** The three fields PAS writes under `subagents.agentOverrides.<agent>`. */
export interface PiAgentOverride {
  model: string;
  defaultProvider?: string;
  thinking?: string;
}

/** Pi's user settings object. Unknown keys are intentionally allowed. */
export interface PiSettings {
  [key: string]: unknown;
}

export interface WritePiSettingsOptions {
  backup?: boolean;
  now?: () => Date;
}

export interface WritePiSettingsResult {
  written: boolean;
  backupPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function defaultPiSettingsPath(home: string): string {
  return join(home, '.pi', 'agent', 'settings.json');
}

export function piAgentDirExists(home: string): boolean {
  try {
    return statSync(join(home, '.pi', 'agent')).isDirectory();
  } catch {
    return false;
  }
}

export function readPiSettings(path: string): PiSettings {
  if (!existsSync(path)) {
    return {};
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PiSettingsError(`Cannot read Pi settings at ${path}: ${reason}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PiSettingsError(`Malformed JSON in Pi settings at ${path}: ${reason}`);
  }

  if (!isRecord(parsed)) {
    throw new PiSettingsError(`Malformed Pi settings at ${path}: expected a JSON object`);
  }

  return parsed;
}

export function setAgentOverride(
  settings: PiSettings,
  agent: string,
  override: PiAgentOverride,
): PiSettings {
  const subagents = isRecord(settings.subagents) ? settings.subagents : {};
  const agentOverrides = isRecord(subagents.agentOverrides) ? subagents.agentOverrides : {};
  const existing = isRecord(agentOverrides[agent]) ? agentOverrides[agent] : {};

  const merged: Record<string, unknown> = { ...existing };
  if (override.model !== undefined) merged.model = override.model;
  if (override.defaultProvider !== undefined) merged.defaultProvider = override.defaultProvider;
  if (override.thinking !== undefined) merged.thinking = override.thinking;

  return {
    ...settings,
    subagents: {
      ...subagents,
      agentOverrides: {
        ...agentOverrides,
        [agent]: merged,
      },
    },
  };
}

export function removeAgentOverride(settings: PiSettings, agent: string): PiSettings {
  const result: PiSettings = { ...settings };
  if (!isRecord(settings.subagents)) return result;

  const subagents = settings.subagents;
  if (!isRecord(subagents.agentOverrides)) return result;
  if (!(agent in subagents.agentOverrides)) return result;

  const remainingOverrides: Record<string, unknown> = { ...subagents.agentOverrides };
  delete remainingOverrides[agent];

  if (Object.keys(remainingOverrides).length > 0) {
    result.subagents = { ...subagents, agentOverrides: remainingOverrides };
    return result;
  }

  const remainingSubagents: Record<string, unknown> = { ...subagents };
  delete remainingSubagents.agentOverrides;

  if (Object.keys(remainingSubagents).length > 0) {
    result.subagents = remainingSubagents;
  } else {
    delete result.subagents;
  }

  return result;
}

export function serializePiSettings(settings: PiSettings): string {
  return JSON.stringify(settings, null, 2) + '\n';
}

export function writePiSettings(
  path: string,
  settings: PiSettings,
  options: WritePiSettingsOptions = {},
): WritePiSettingsResult {
  const parent = dirname(path);
  let parentIsDirectory = false;
  try {
    parentIsDirectory = statSync(parent).isDirectory();
  } catch {
    parentIsDirectory = false;
  }

  if (!parentIsDirectory) {
    throw new PiSettingsError(
      `Cannot write Pi settings at ${path}: parent directory ${parent} does not exist`,
    );
  }

  const content = serializePiSettings(settings);

  let current: string | undefined;
  if (existsSync(path)) {
    try {
      current = readFileSync(path, 'utf-8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new PiSettingsError(`Cannot read Pi settings at ${path}: ${reason}`);
    }
  }

  if (current === content) {
    return { written: false };
  }

  let backupPath: string | undefined;
  if (options.backup === true && current !== undefined) {
    const now = options.now ? options.now() : new Date();
    backupPath = `${path}.bak.${timestamp(now)}`;
    try {
      copyFileSync(path, backupPath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new PiSettingsError(`Cannot back up Pi settings at ${path}: ${reason}`);
    }
  }

  try {
    writeFileSync(path, content, 'utf-8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PiSettingsError(`Cannot write Pi settings at ${path}: ${reason}`);
  }

  return backupPath === undefined ? { written: true } : { written: true, backupPath };
}
