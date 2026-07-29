/**
 * Non-interactive `nas agents profile delete <name>` command.
 *
 * Deletes a profile file under `~/.config/opencode/nas/profiles/`.
 * Operates on the profile file only — never touches
 * `opencode.json`.
 *
 * Behaviour (FEAT-008):
 *   - Throws (non-zero exit) when the profile does not exist. This is
 *     intentional: silent no-ops on delete hide typos.
 *
 * Backed by the pure `deleteProfile` library; this file is a thin I/O
 * shell.
 */

import { defineCommand } from 'citty';

import { deleteProfile } from '../../../lib/profile-store';

function fail(message: string, code = 1): never {
  console.error('Error:', message);
  process.exit(code);
}

export default defineCommand({
  meta: {
    name: 'delete',
    description: 'Delete a saved NAS agents profile file',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Profile name to delete',
      required: true,
    },
  },
  run({ args }) {
    try {
      const name = String(args.name ?? '').trim();
      if (!name) fail('Profile name must be a non-empty string.');

      const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
      const removed = deleteProfile(home, name);
      console.log(`Deleted profile "${name}" (${removed}).`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});
