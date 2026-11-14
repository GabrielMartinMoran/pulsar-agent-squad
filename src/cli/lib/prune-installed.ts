import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Agent files the install owns: the `pas_*` roster built from `src/agents`.
 * Matches the basename only, so a nested directory is never mistaken for one.
 */
const PAS_AGENT_FILE = /^pas_[a-z0-9_]+\.md$/;

/** Orchestrator prompts installed under their display names. */
const PAS_ORCHESTRATORS = new Set(['Pulsar Agent Squad.md', 'Pulsar Agent Turbo.md']);

/**
 * True when `fileName` is an agent file PAS installs and may therefore prune.
 * Anything else belongs to the user or another tool and is never touched.
 */
export function isPasOwnedAgentFile(fileName: string): boolean {
  return PAS_AGENT_FILE.test(fileName) || PAS_ORCHESTRATORS.has(fileName);
}

/**
 * List the PAS-owned agent files in `agentsDir` that the current roster no
 * longer ships, as absolute paths sorted by name.
 *
 * `shippedFileNames` is the set of basenames the manifest installs into that
 * directory. Anything PAS-owned but absent from that set is stale. A missing
 * directory yields no candidates, and directories or symlinks that happen to
 * match an owned name are left alone.
 */
export function stalePasAgentFiles(agentsDir: string, shippedFileNames: Iterable<string>): string[] {
  if (!existsSync(agentsDir)) return [];

  const shipped = new Set(shippedFileNames);
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isPasOwnedAgentFile(entry.name) && !shipped.has(entry.name))
    .map((entry) => join(agentsDir, entry.name))
    .sort();
}
