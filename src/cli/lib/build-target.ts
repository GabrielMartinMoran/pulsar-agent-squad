/**
 * Shared build logic for every platform in `config/platforms.manifest`.
 *
 * Both `pas build` and `pas test` use this module so there is exactly one
 * walker: the CLI `test` command can no longer drift from the build command
 * (and cannot crash on nested agent/skill directories).
 *
 * Injection rule: OpenCode compiles the user's CLI-managed
 * `permission.skill` rules into canonical agent frontmatter. Every other
 * target — `pi` included — gets verbatim copies, frontmatter untouched.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { parseManifest, type ManifestEntry } from './manifest';
import { injectSkillPoliciesFromConfig } from './skill-injection';

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
 * `opencode.json`. Files outside the PAS agent set pass through unchanged.
 */
function agentNameFromDestFile(destFile: string): string | null {
  const base = destFile.split('/').pop() ?? '';
  if (base === 'pas_engineer.md') return 'pas_engineer';
  if (base === 'pas_copilot.md') return 'pas_copilot';
  if (base === 'pas_researcher.md') return 'pas_researcher';
  if (base === 'Pulsar Agent Squad.md') return 'Pulsar Agent Squad';
  if (base === 'Pulsar Agent Turbo.md') return 'Pulsar Agent Turbo';
  return null;
}

/**
 * Copy one markdown file. When `inject` is true and the destination is a
 * canonical agent basename, OpenCode skill policies are compiled into the
 * frontmatter; otherwise the file is copied byte-for-byte.
 */
function copyMarkdownFile(sourceFile: string, destFile: string, inject: boolean): void {
  const content = readFileSync(sourceFile);
  if (!inject) {
    writeFileSync(destFile, content);
    return;
  }

  const text = content.toString('utf-8');
  const agentName = agentNameFromDestFile(destFile);
  writeFileSync(destFile, agentName ? injectSkillPoliciesFromConfig(agentName, text) : text);
}

function copyMarkdownTree(
  sourceDir: string,
  destDir: string,
  relative: string,
  inject: boolean,
): void {
  const dir = relative ? `${sourceDir}/${relative}` : sourceDir;
  for (const file of readdirSync(dir)) {
    const rel = relative ? `${relative}/${file}` : file;
    const srcPath = `${sourceDir}/${rel}`;
    if (statSync(srcPath).isDirectory()) {
      copyMarkdownTree(sourceDir, destDir, rel, inject);
      continue;
    }
    if (!file.endsWith('.md')) continue;
    const destPath = `${destDir}/${rel}`;
    mkdirSync(dirname(destPath), { recursive: true });
    copyMarkdownFile(srcPath, destPath, inject);
  }
}

function buildDirEntry(entry: ManifestEntry): void {
  const sourceDir = entry.source;
  const destDir = `dist/${entry.distPath}`;
  const inject = entry.target === 'opencode';

  mkdirSync(destDir, { recursive: true });

  // Agent source directories hold flat markdown prompts; skip nested
  // subdirectories and non-markdown files so a subdirectory cannot crash the
  // flat walk with EISDIR. Skill source directories keep their one-level skill
  // layout and are walked recursively (markdown only).
  const isAgentSource = sourceDir === 'src/agents' || sourceDir.startsWith('src/agents/');
  if (isAgentSource) {
    for (const file of readdirSync(sourceDir)) {
      const srcPath = `${sourceDir}/${file}`;
      if (statSync(srcPath).isDirectory()) continue;
      if (!file.endsWith('.md')) continue;
      copyMarkdownFile(srcPath, `${destDir}/${file}`, inject);
    }
  } else {
    copyMarkdownTree(sourceDir, destDir, '', inject);
  }

  console.log(`Built target: ${entry.target} -> dist/${entry.distPath}`);
}

/**
 * Assemble the Pi `pas-toolkit` extension directory.
 *
 * The adapter (`index.ts`) is copied as-is. The canonical state logic is
 * copied from `src/tools/pas-toolkit.ts` to `core.ts` so the distributed
 * extension is self-contained and there is a single source of truth.
 */
function buildPiToolkitEntry(entry: ManifestEntry): void {
  const destDir = `dist/${entry.distPath}`;
  rmrf(destDir);
  mkdirSync(destDir, { recursive: true });

  writeFileSync(`${destDir}/index.ts`, readFileSync(`${entry.source}/index.ts`));
  writeFileSync(`${destDir}/core.ts`, readFileSync('src/tools/pas-toolkit.ts'));

  console.log(`Built target: ${entry.target} -> dist/${entry.distPath}`);
}

function buildFileEntry(entry: ManifestEntry): void {
  const destPath = `dist/${entry.distPath}`;
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, readFileSync(entry.source));
  console.log(`Built target: ${entry.target} -> dist/${entry.distPath}`);
}

/** Build a single manifest row (target-aware, byte-stable). */
export function buildManifestEntry(entry: ManifestEntry): void {
  if (entry.target === 'pi' && entry.source === 'src/tools/pi/pas-toolkit') {
    buildPiToolkitEntry(entry);
  } else if (entry.kind === 'dir') {
    buildDirEntry(entry);
  } else {
    buildFileEntry(entry);
  }
}

/**
 * Clean and rebuild every manifest row for `target`.
 * Returns false when the manifest declares no row for that target.
 */
export function buildTarget(target: string): boolean {
  rmrf(`dist/platforms/${target}`);
  let found = false;
  for (const entry of parseManifest()) {
    if (entry.target !== target) continue;
    found = true;
    buildManifestEntry(entry);
  }
  return found;
}
