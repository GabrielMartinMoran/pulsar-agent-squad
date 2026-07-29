import { defineCommand } from 'citty';
import { parseManifest, type ManifestEntry } from '../lib/manifest';
import { existsSync, mkdirSync } from 'fs';

function resolveDest(installPath: string, destdir?: string): string {
  if (destdir) {
    return `${destdir.replace(/\/+$/, '')}/${installPath.replace(/^\/+/, '')}`;
  }
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return `${home}/${installPath}`;
}

function copyFiles(src: string, dest: string, dryRun: boolean): void {
  const { readdirSync, readFileSync, writeFileSync, statSync } = require('fs');
  const { join } = require('path');

  if (!existsSync(src)) return;

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
  } else {
    if (dryRun) {
      console.log(`DRY-RUN: cp '${src}' -> '${dest}'`);
    } else {
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, src.split('/').pop()!), readFileSync(src));
    }
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
    const entries = parseManifest();
    const target = args.target as string | undefined;
    const dryRun = (args['dry-run'] as boolean) || false;
    const destdir = args.destdir as string | undefined;

    let matched = false;

    for (const entry of entries) {
      if (target && entry.target !== target) continue;
      matched = true;

      const artifact = `dist/${entry.distPath}`;
      if (!existsSync(artifact)) {
        console.error(`ERROR: missing built artifact '${artifact}'. Run 'nas build --target=${entry.target}' first.`);
        process.exit(1);
      }

      const destination = resolveDest(entry.installPath, destdir);
      copyFiles(artifact, destination, dryRun);
      console.log(`Installed target: ${entry.target} -> ${destination}`);
    }

    if (!matched) {
      console.error(`ERROR: unknown TARGET '${target}'`);
      process.exit(1);
    }
  },
});
