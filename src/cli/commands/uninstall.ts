import { defineCommand } from 'citty';
import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { parseManifest } from '../lib/manifest';
import { resolveArtifactDestination } from '../lib/install-paths';

/** Remove only the installed files that mirror a source directory. */
function removeDirectoryArtifact(
  sourceDir: string,
  destDir: string,
  relative: string,
  dryRun: boolean,
): void {
  const dir = relative ? join(sourceDir, relative) : sourceDir;
  for (const file of readdirSync(dir)) {
    const rel = relative ? join(relative, file) : file;
    const srcPath = join(sourceDir, rel);
    const destPath = join(destDir, rel);

    if (statSync(srcPath).isDirectory()) {
      removeDirectoryArtifact(sourceDir, destDir, rel, dryRun);
      continue;
    }

    if (dryRun) {
      console.log(`DRY-RUN: rm '${destPath}'`);
    } else if (existsSync(destPath)) {
      rmSync(destPath);
      console.log(`✓ Removed: ${destPath}`);
    } else {
      console.log(`Not found (skipped): ${destPath}`);
    }
  }
}

function uninstallPi(destdir: string | undefined, dryRun: boolean): void {
  console.log('Uninstalling Pi target artifacts...');

  for (const entry of parseManifest()) {
    if (entry.target !== 'pi') continue;
    const { target } = resolveArtifactDestination(entry, destdir);

    if (entry.kind === 'dir') {
      if (!existsSync(entry.source)) continue;
      removeDirectoryArtifact(entry.source, target, '', dryRun);
      continue;
    }

    const filePath = target;
    if (dryRun) {
      console.log(`DRY-RUN: rm '${filePath}'`);
    } else if (existsSync(filePath)) {
      rmSync(filePath);
      console.log(`✓ Removed: ${filePath}`);
    } else {
      console.log(`Not found (skipped): ${filePath}`);
    }
  }

  if (!dryRun) {
    console.log('');
    console.log('Note: This removes only Pi artifacts installed by PAS.');
  }
}

export const uninstallCommand = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Remove PAS agent files and the pas_toolkit plugin from their target directories',
  },
  args: {
    target: {
      type: 'string',
      description: 'Target platform to uninstall (defaults to opencode)',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Show what would be removed without deleting',
    },
    dest: {
      type: 'string',
      description: 'Target directory (default: ~/.config/opencode/agents)',
    },
    'plugins-dest': {
      type: 'string',
      description: 'Plugins directory containing pas-toolkit.ts (default: ~/.config/opencode/plugins)',
    },
    destdir: {
      type: 'string',
      description: 'Custom base directory instead of HOME (Pi target)',
    },
  },
  async run({ args }) {
    const target = args.target as string | undefined;
    const dryRun = (args['dry-run'] as boolean) || false;
    const destdir = args.destdir as string | undefined;

    if (target === 'pi') {
      uninstallPi(destdir, dryRun);
      return;
    }

    const home = process.env.HOME || process.env.USERPROFILE || '~';
    const dest = (args.dest as string) || join(home, '.config', 'opencode', 'agents');
    const pluginsDest = (args['plugins-dest'] as string) || join(home, '.config', 'opencode', 'plugins');

    const agents = [
      'Pulsar Agent Squad.md',
      'Pulsar Agent Turbo.md',
      'pas_researcher.md',
      'pas_developer.md',
      'pas_qa.md',
    ];

    console.log('Uninstalling Pulsar Agent Squad agents...');

    for (const agent of agents) {
      const filePath = join(dest, agent);
      if (dryRun) {
        console.log(`DRY-RUN: rm '${filePath}'`);
      } else if (existsSync(filePath)) {
        rmSync(filePath);
        console.log(`✓ Removed: ${filePath}`);
      } else {
        console.log(`Not found (skipped): ${filePath}`);
      }
    }

    // Remove only the installed pas_toolkit plugin FILE. The `plugins/`
    // container directory may hold unrelated plugins, so it is never removed.
    const pluginPath = join(pluginsDest, 'pas-toolkit.ts');
    if (dryRun) {
      console.log(`DRY-RUN: rm '${pluginPath}'`);
    } else if (existsSync(pluginPath)) {
      rmSync(pluginPath);
      console.log(`✓ Removed: ${pluginPath}`);
    } else {
      console.log(`Not found (skipped): ${pluginPath}`);
    }

    if (!dryRun) {
      console.log('');
      console.log('Note: This removes the PAS agent files and the pas_toolkit plugin.');
      console.log('To reset default_agent, edit ~/.config/opencode/opencode.json');
    }
  },
});
