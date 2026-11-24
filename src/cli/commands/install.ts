import { defineCommand } from 'citty';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { parseManifest, type ManifestEntry } from '../lib/manifest';
import {
  artifactPathFor,
  buildManifestEntries,
  selectManifestEntries,
} from '../lib/build-target';
import {
  assertSafeAgentDestination,
  readInstallInventory,
  syncInstallInventory,
  type InstallInventory,
} from '../lib/install-inventory';

export interface InstallOptions {
  dryRun: boolean;
  destdir?: string;
}

function resolveDest(installPath: string, destdir?: string): string {
  if (destdir) {
    return `${destdir.replace(/\/+$/, '')}/${installPath.replace(/^\/+/, '')}`;
  }
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return `${home}/${installPath}`;
}

function copyFiles(src: string, dest: string, dryRun: boolean): string[] {
  if (!existsSync(src)) return [];

  const stat = statSync(src);
  if (stat.isDirectory()) {
    const files = readdirSync(src);
    for (const file of files) {
      const srcPath = join(src, file);
      const destPath = join(dest, file);
      if (dryRun) {
        console.log(`DRY-RUN: cp '${srcPath}' -> '${destPath}'`);
      } else {
        mkdirSync(dest, { recursive: true });
        writeFileSync(destPath, readFileSync(srcPath));
      }
    }
    return files;
  }

  const basename = src.split('/').pop()!;
  if (dryRun) {
    console.log(`DRY-RUN: cp '${src}' -> '${dest}'`);
  } else {
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, basename), readFileSync(src));
  }
  return [basename];
}

function assertArtifacts(entries: ManifestEntry[]): void {
  const missing = entries.filter((entry) => !existsSync(artifactPathFor(entry)));
  if (missing.length === 0) return;

  throw new Error(
    missing
      .map(
        (entry) =>
          `missing built artifact '${artifactPathFor(entry)}'. Run 'pas build --target=${entry.target}' first.`,
      )
      .join('\n'),
  );
}

/**
 * Install the selected manifest rows to their destinations.
 *
 * A real install builds every selected artifact from source and validates the
 * whole artifact set before the first destination write, so a build failure
 * cannot leave a half-installed destination. A dry run writes nothing and
 * never builds: it previews the existing artifacts, or fails naming the
 * missing ones.
 *
 * OpenCode agent destinations also carry a destination-local inventory. An
 * existing inventory is read and validated before anything is built or
 * copied, then reconciled only after the copy succeeds: recorded retired
 * files are pruned only while they are still unmodified regular files.
 */
export function installManifestEntries(
  entries: ManifestEntry[],
  options: InstallOptions,
): void {
  if (options.dryRun) {
    assertArtifacts(entries);
  }

  const inventories = new Map<string, InstallInventory | null>();
  for (const entry of entries) {
    if (!isOpenCodeAgentEntry(entry)) continue;
    const destination = resolveDest(entry.installPath, options.destdir);
    if (inventories.has(destination)) continue;
    // Validate the destination before reading its inventory, building, or
    // copying. A symlinked agents directory, a non-directory, or an unsafe
    // shipped path is a conflict; only lstat is used, so no link is followed.
    assertSafeAgentDestination(destination, shippedAgentNames(entry));
    inventories.set(destination, readInstallInventory(destination));
  }

  if (!options.dryRun) {
    try {
      buildManifestEntries(entries);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `build failed for the selected artifacts; nothing was installed: ${message}`,
      );
    }
    assertArtifacts(entries);
  }

  const agentDestinations: Array<{ destination: string; shipped: string[] }> = [];

  for (const entry of entries) {
    const destination = resolveDest(entry.installPath, options.destdir);
    const copied = copyFiles(artifactPathFor(entry), destination, options.dryRun);
    if (isOpenCodeAgentEntry(entry)) {
      agentDestinations.push({ destination, shipped: copied });
    }
    console.log(`Installed target: ${entry.target} -> ${destination}`);
  }

  // Reconcile only after every copy succeeded. A dry run prints the same plan
  // without deleting or writing the inventory.
  for (const { destination, shipped } of agentDestinations) {
    const result = syncInstallInventory(destination, shipped, {
      dryRun: options.dryRun,
      prior: inventories.get(destination) ?? null,
    });
    for (const name of result.pruned) {
      const path = join(destination, name);
      console.log(
        options.dryRun
          ? `DRY-RUN: prune '${path}'`
          : `Pruned stale agent: ${path}`,
      );
    }
  }
}

function isOpenCodeAgentEntry(entry: ManifestEntry): boolean {
  return entry.target === 'opencode' && entry.kind === 'dir';
}

/**
 * Names the build will ship for a directory entry. A missing source is left to
 * the build step so the user sees its clearer failure message.
 */
function shippedAgentNames(entry: ManifestEntry): string[] {
  try {
    return readdirSync(entry.source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
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
      description: 'Preview existing artifacts without building or writing',
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

    const entries = selectManifestEntries(parseManifest(), target);
    if (entries.length === 0) {
      console.error(`ERROR: unknown TARGET '${target}'`);
      process.exit(1);
    }

    try {
      installManifestEntries(entries, { dryRun, destdir });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`ERROR: ${message}`);
      process.exit(1);
    }
  },
});
