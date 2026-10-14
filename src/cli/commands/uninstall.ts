import { defineCommand } from 'citty';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

export const uninstallCommand = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Remove PAS agent files and the pas_toolkit plugin from their target directories',
  },
  args: {
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
  },
  async run({ args }) {
    const dryRun = (args['dry-run'] as boolean) || false;
    const home = process.env.HOME || process.env.USERPROFILE || '~';
    const dest = (args.dest as string) || join(home, '.config', 'opencode', 'agents');
    const pluginsDest = (args['plugins-dest'] as string) || join(home, '.config', 'opencode', 'plugins');

    const agents = [
      'Pulsar Agent Squad.md',
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
