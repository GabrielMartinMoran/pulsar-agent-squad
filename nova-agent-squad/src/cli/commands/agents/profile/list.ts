/**
 * Non-interactive `nas agents profile list` command.
 *
 * Reads every profile file under `~/.config/opencode/nas/profiles/` and
 * prints the names in sorted order. When no profiles exist, prints a
 * short notice and exits 0 (matching the `nas skills list` / `nas agents
 * list` read-only surface conventions).
 *
 * Backed by the pure `listProfiles` library; this file is a thin I/O
 * shell.
 */

import { defineCommand } from 'citty';

import { listProfiles } from '../../../lib/profile-store';

export default defineCommand({
  meta: {
    name: 'list',
    description: 'List every saved NAS agents profile (sorted by name)',
  },
  run() {
    try {
      const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
      const names = listProfiles(home);

      if (names.length === 0) {
        console.log('No profiles saved. Use `nas agents profile save <name>` to create one.');
        return;
      }

      console.log('Saved NAS agents profiles:');
      for (const name of names) {
        console.log(`  ${name}`);
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});
