import { defineCommand } from 'citty';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

export const uninstallCommand = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Remove NAS agent files from target directory',
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
  },
  async run({ args }) {
    const dryRun = (args['dry-run'] as boolean) || false;
    const home = process.env.HOME || process.env.USERPROFILE || '~';
    const dest = (args.dest as string) || join(home, '.config', 'opencode', 'agents');

    const agents = [
      'Nova Agent Squad.md',
      'nas_researcher.md',
      'nas_planner.md',
      'nas_developer.md',
      'nas_qa.md',
    ];

    console.log('Uninstalling Nova Agent Squad agents...');

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

    if (!dryRun) {
      console.log('');
      console.log('Note: This removes only the agent files.');
      console.log('To reset default_agent, edit ~/.config/opencode/opencode.json');
    }
  },
});
