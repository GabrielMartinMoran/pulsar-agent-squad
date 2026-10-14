import { defineCommand } from 'citty';
import { parseManifest, type ManifestEntry } from '../lib/manifest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { injectSkillPoliciesFromConfig } from '../lib/skill-injection';

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
 * `opencode.json` (the `agent.<name>.permission.skill` block). The
 * build step uses this to look up the per-agent skill block to inject.
 *
 * Files that are NOT in the PAS agent set (defensive default) are
 * passed through unchanged.
 */
function agentNameFromDestFile(destFile: string): string | null {
  const base = destFile.split('/').pop() ?? '';
  if (base === 'pas_developer.md') return 'pas_developer';
  if (base === 'pas_qa.md') return 'pas_qa';
  if (base === 'pas_researcher.md') return 'pas_researcher';
  if (base === 'Pulsar Agent Squad.md') return 'Pulsar Agent Squad';
  return null;
}

function processAgentFile(sourceFile: string, destFile: string): void {
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
  const agentName = agentNameFromDestFile(destFile);
  if (agentName) {
    content = injectSkillPoliciesFromConfig(agentName, content);
  }

  writeFileSync(destFile, content);
}

function buildDirEntry(entry: ManifestEntry): void {
  const sourceDir = entry.source;
  const destDir = `dist/${entry.distPath}`;

  mkdirSync(destDir, { recursive: true });

  const files = readdirSync(sourceDir);
  for (const file of files) {
    const srcPath = `${sourceDir}/${file}`;
    const destPath = `${destDir}/${file}`;
    processAgentFile(srcPath, destPath);
  }

  console.log(`Built target: ${entry.target} -> dist/${entry.distPath}`);
}

function buildFileEntry(entry: ManifestEntry): void {
  const destPath = `dist/${entry.distPath}`;
  mkdirSync(destPath.substring(0, destPath.lastIndexOf('/')), { recursive: true });
  const content = readFileSync(entry.source);
  writeFileSync(destPath, content);
  console.log(`Built target: ${entry.target} -> dist/${entry.distPath}`);
}

export const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description: 'Build agent files for distribution',
  },
  args: {
    target: {
      type: 'string',
      description: 'Target platform to build (builds all if omitted)',
    },
  },
  async run({ args }) {
    const entries = parseManifest();
    const target = args.target as string | undefined;

    // Clean dist for target(s) before building
    if (target) {
      rmrf(`dist/platforms/${target}`);
    }

    let found = false;
    for (const entry of entries) {
      if (target && entry.target !== target) continue;
      found = true;

      if (entry.kind === 'dir') {
        buildDirEntry(entry);
      } else {
        buildFileEntry(entry);
      }
    }

    if (!found) {
      console.error(`ERROR: unknown TARGET '${target}'`);
      process.exit(1);
    }
  },
});
