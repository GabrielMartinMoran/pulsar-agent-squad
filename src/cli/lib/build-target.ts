import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { ManifestEntry } from './manifest';
import { injectSkillPoliciesFromConfig } from './skill-injection';
import { injectToolDenies } from './policy-injection';
import {
  loadToolPolicyStore,
  resolvePolicyPath,
  type ToolPolicyStore,
} from './policy-store';

function rmrf(path: string): void {
  if (!path) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // ignore - dir may not exist
  }
}

/**
 * Map a dist agent file basename to its canonical agent name used in
 * `opencode.json` (the `agent.<name>.permission.skill` block). Files that are
 * NOT in the PAS agent set (defensive default) are passed through unchanged.
 */
function agentNameFromDestFile(destFile: string): string | null {
  const base = destFile.split('/').pop() ?? '';
  if (base === 'pas_developer.md') return 'pas_developer';
  if (base === 'pas_qa.md') return 'pas_qa';
  if (base === 'pas_researcher.md') return 'pas_researcher';
  if (base === 'Pulsar Agent Squad.md') return 'Pulsar Agent Squad';
  if (base === 'Pulsar Agent Turbo.md') return 'Pulsar Agent Turbo';
  return null;
}

function processAgentFile(
  sourceFile: string,
  destFile: string,
  policyStore: ToolPolicyStore | null,
): void {
  let content = readFileSync(sourceFile, 'utf-8');

  // Build-time injection of CLI-managed `permission.skill` rules from
  // the user's `opencode.json` (or `PAS_OPENCODE_CONFIG_PATH` override).
  // The new `skill:` key is placed AFTER the existing `*`: allow line in
  // the agent's frontmatter `permission:` block, so OpenCode's
  // "last matching rule wins" semantics make the specific skill rules
  // override the catch-all. The user's CLI (`pas skills add/setup`) is
  // preserved as the source of truth - the build step is read-only on
  // `opencode.json`. If the user has no per-agent rules, the dist file
  // is byte-identical to the source.
  //
  // Tool denies come second, so a deny always follows the injected skill
  // block and every pre-existing rule in the same frontmatter format.
  const agentName = agentNameFromDestFile(destFile);
  if (agentName) {
    content = injectSkillPoliciesFromConfig(agentName, content);
    const tools = policyStore?.agents[agentName]?.tools ?? [];
    if (tools.length > 0) {
      const file = destFile.split('/').pop() ?? destFile;
      content = injectToolDenies(content, tools, (message) =>
        console.warn(`Warning: ${file}: ${message}`),
      );
    }
  }

  writeFileSync(destFile, content);
}

function buildDirEntry(
  entry: ManifestEntry,
  policyStore: ToolPolicyStore | null,
): void {
  const sourceDir = entry.source;
  const destDir = `dist/${entry.distPath}`;

  mkdirSync(destDir, { recursive: true });

  const files = readdirSync(sourceDir);
  for (const file of files) {
    const srcPath = `${sourceDir}/${file}`;
    const destPath = `${destDir}/${file}`;
    processAgentFile(srcPath, destPath, policyStore);
  }
}

function buildFileEntry(entry: ManifestEntry): void {
  const destPath = `dist/${entry.distPath}`;
  mkdirSync(dirname(destPath), { recursive: true });
  const content = readFileSync(entry.source);
  writeFileSync(destPath, content);
}

/**
 * Select the manifest rows a command may act on. Selecting before any build
 * or copy keeps an unknown target from touching the filesystem, and keeps
 * `install --target=X` from writing another target's destination.
 */
export function selectManifestEntries(
  entries: ManifestEntry[],
  target?: string,
): ManifestEntry[] {
  if (!target) return entries;
  return entries.filter((entry) => entry.target === target);
}

/** Artifact path a built manifest row is copied from. */
export function artifactPathFor(entry: ManifestEntry): string {
  return `dist/${entry.distPath}`;
}

/**
 * Build the given manifest rows from source. Each selected target's dist
 * directory is cleared first, so a real build (and every real install) ships
 * fresh artifacts instead of stale ones. Targets not present in `entries`
 * are never touched.
 *
 * The PAS tool policy store is loaded and validated before any dist path is
 * cleared: an invalid store aborts the build without writing output. A missing
 * store is the normal empty state.
 */
export function buildManifestEntries(
  entries: ManifestEntry[],
  policyStore: ToolPolicyStore | null = loadToolPolicyStore(resolvePolicyPath()),
): void {
  for (const target of new Set(entries.map((entry) => entry.target))) {
    rmrf(`dist/platforms/${target}`);
  }

  for (const entry of entries) {
    if (entry.kind === 'dir') {
      buildDirEntry(entry, policyStore);
    } else {
      buildFileEntry(entry);
    }
    console.log(`Built target: ${entry.target} -> dist/${entry.distPath}`);
  }
}
