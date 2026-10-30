import { defineCommand } from 'citty';
import { parseManifest } from '../lib/manifest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { installPiPackages, piAvailable } from '../lib/pi-plugins';
import { resolveArtifactDestination } from '../lib/install-paths';
import { stalePasAgentFiles } from '../lib/prune-installed';

// Re-export the helper so existing imports from this command keep working.
export { isPiPackageListed } from '../lib/pi-plugins';

const PI_PREFLIGHT_ERROR =
  "ERROR: 'pi' binary not found on PATH. Install Pi and retry 'pas install --target=pi'.";

/**
 * The only install path PAS prunes: the OpenCode roster directory. Pi keeps
 * its own agent names on purpose, so it is never pruned.
 */
const OPENCODE_AGENTS_INSTALL_PATH = '.config/opencode/agents';

interface AgentsDirectory {
  /** Built agents directory, whose files are the current roster. */
  artifactDir: string;
  /** Installed agents directory that receives the roster. */
  installedDir: string;
}

/**
 * Copy a directory artifact recursively so nested skill layouts are
 * installed. Dry-run prints the planned copies without touching disk.
 */
function copyDirectoryArtifact(src: string, dest: string, dryRun: boolean): void {
  if (!existsSync(src)) return;

  if (!dryRun) mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(src)) {
    const srcPath = join(src, file);
    const destPath = join(dest, file);
    if (statSync(srcPath).isDirectory()) {
      copyDirectoryArtifact(srcPath, destPath, dryRun);
    } else if (dryRun) {
      console.log(`DRY-RUN: cp '${srcPath}' -> '${destPath}'`);
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

/**
 * Copy a single file artifact byte-for-byte. The reported destination is the
 * path printed by install; the target is the exact file written on disk.
 *
 * With `backupExisting`, a differing destination is copied to `<target>.bak`
 * before being overwritten; an identical destination is left alone. This keeps
 * user edits recoverable without churning a backup on every reinstall.
 *
 * Returns `true` when bytes were written and `false` when nothing changed.
 */
function copyFileArtifact(
  artifact: string,
  reported: string,
  target: string,
  dryRun: boolean,
  backupExisting: boolean,
): boolean {
  if (dryRun) {
    console.log(`DRY-RUN: cp '${artifact}' -> '${reported}'`);
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  const sourceBytes = readFileSync(artifact);
  if (backupExisting && existsSync(target)) {
    if (!statSync(target).isFile()) {
      console.error(
        `ERROR: destination '${target}' is not a regular file. Remove or rename the conflicting path, then retry 'pas install --target=pi'.`,
      );
      process.exit(1);
    }
    const existingBytes = readFileSync(target);
    if (existingBytes.equals(sourceBytes)) return false;
    try {
      writeFileSync(`${target}.bak`, existingBytes);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `ERROR: could not write backup '${target}.bak': ${reason}. Remove or rename the conflicting path and ensure its parent directory is writable, then retry 'pas install --target=pi'.`,
      );
      process.exit(1);
    }
  }
  writeFileSync(target, sourceBytes);
  return true;
}

/**
 * Install one artifact. The manifest `kind` selects the single copy path:
 * `dir` walks the artifact tree into the destination directory; `file` writes
 * one file, appending its basename when the install path names a containing
 * directory.
 */
function copyArtifact(
  artifact: string,
  reported: string,
  target: string,
  kind: 'dir' | 'file',
  dryRun: boolean,
  backupExisting: boolean,
): boolean {
  if (kind === 'dir') {
    copyDirectoryArtifact(artifact, target, dryRun);
    return true;
  }
  return copyFileArtifact(artifact, reported, target, dryRun, backupExisting);
}

/** Basenames of the agent files the current build ships into the roster. */
function shippedAgentNames(artifactDir: string): string[] {
  return readdirSync(artifactDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

/**
 * Remove every PAS-owned agent file the current roster no longer ships. Files
 * PAS does not own are never touched, and a dry run only reports candidates.
 */
function pruneStaleAgents(agentsDir: string, shipped: string[], dryRun: boolean): void {
  const stale = stalePasAgentFiles(agentsDir, shipped);

  if (stale.length === 0) {
    console.log(`Nothing to prune: ${agentsDir}`);
    return;
  }

  for (const filePath of stale) {
    if (dryRun) {
      console.log(`DRY-RUN: rm '${filePath}'`);
      continue;
    }
    rmSync(filePath);
    console.log(`✓ Pruned stale agent: ${filePath}`);
  }
}

export const installCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Install built agent files to their platform destinations',
  },
  args: {
    target: {
      type: 'string',
      description: 'Target platform to install (installs all if omitted)',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Show what would be installed without writing',
    },
    destdir: {
      type: 'string',
      description: 'Custom base directory instead of HOME',
    },
  },
  async run({ args }) {
    const target = args.target as string | undefined;
    const dryRun = (args['dry-run'] as boolean) || false;
    const destdir = args.destdir as string | undefined;
    const isPi = target === 'pi';

    // Pi preflight: fail before copying anything when the binary is absent.
    // A dry-run previews commands and needs no Pi installation.
    if (isPi && !dryRun && !piAvailable()) {
      console.error(PI_PREFLIGHT_ERROR);
      process.exit(1);
    }

    let matched = false;
    let opencodeAgents: AgentsDirectory | undefined;

    for (const entry of parseManifest()) {
      if (target && entry.target !== target) continue;
      matched = true;

      const artifact = `dist/${entry.distPath}`;
      if (!existsSync(artifact)) {
        console.error(`ERROR: missing built artifact '${artifact}'. Run 'pas build --target=${entry.target}' first.`);
        process.exit(1);
      }

      const { reported, target: copyTarget } = resolveArtifactDestination(entry, destdir);
      const backupExisting = entry.target === 'pi' && entry.kind === 'file';
      const wrote = copyArtifact(artifact, reported, copyTarget, entry.kind, dryRun, backupExisting);
      const action = dryRun
        ? 'DRY-RUN: would install target'
        : wrote
          ? 'Installed target'
          : 'Unchanged target';
      console.log(`${action}: ${entry.target} -> ${reported}`);

      if (
        entry.target === 'opencode' &&
        entry.kind === 'dir' &&
        entry.installPath === OPENCODE_AGENTS_INSTALL_PATH
      ) {
        opencodeAgents = { artifactDir: artifact, installedDir: copyTarget };
      }
    }

    if (!matched) {
      console.error(`ERROR: unknown TARGET '${target}'`);
      process.exit(1);
    }

    // Prune after the copy so the new roster is on disk before stale names go.
    if (opencodeAgents) {
      pruneStaleAgents(
        opencodeAgents.installedDir,
        shippedAgentNames(opencodeAgents.artifactDir),
        dryRun,
      );
    }

    if (isPi) {
      installPiPackages(dryRun);
    }
  },
});
