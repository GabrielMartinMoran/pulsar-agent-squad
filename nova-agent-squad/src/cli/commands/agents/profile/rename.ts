/**
 * Non-interactive `nas agents profile rename <old> <new>` command.
 *
 * Renames a profile file under `~/.config/opencode/nas/profiles/`.
 * Operates on the profile file only — never touches
 * `opencode.json`.
 *
 * Behaviour (FEAT-008):
 *   - Throws (non-zero exit) when the source profile does not exist.
 *   - Throws (non-zero exit) when the target profile already exists; the
 *     source is NEVER overwritten into the target.
 *
 * Backed by the pure `renameProfile` library; this file is a thin I/O
 * shell.
 */

import { defineCommand } from 'citty';

import { renameProfile } from '../../../lib/profile-store';

function fail(message: string, code = 1): never {
  console.error('Error:', message);
  process.exit(code);
}

export default defineCommand({
  meta: {
    name: 'rename',
    description: 'Rename a saved NAS agents profile file',
  },
  args: {
    oldName: {
      type: 'positional',
      description: 'Existing profile name',
      required: true,
    },
    newName: {
      type: 'positional',
      description: 'New profile name',
      required: true,
    },
  },
  run({ args }) {
    try {
      const oldName = String(args.oldName ?? '').trim();
      const newName = String(args.newName ?? '').trim();
      if (!oldName) fail('Source profile name must be a non-empty string.');
      if (!newName) fail('Target profile name must be a non-empty string.');
      if (oldName === newName) {
        fail('Source and target profile names are identical.');
      }

      const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
      const newPath = renameProfile(home, oldName, newName);
      console.log(`Renamed profile "${oldName}" → "${newName}" (${newPath}).`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});
