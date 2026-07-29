/**
 * Non-interactive `nas agents profile save <name>` command.
 *
 * Snapshots the current canonical NAS agent model+variant overrides from
 * `~/.config/opencode/opencode.json` into a sidecar profile file at
 * `~/.config/opencode/nas/profiles/<name>.json`.
 *
 * Backed by the pure `saveProfile` library; this file is a thin I/O shell
 * (argument validation, error handling, console output).
 *
 * Behaviour (FEAT-008):
 *   - Only canonical NAS agents (`NAS_AGENTS`) are serialized, and only
 *     with their `model` and `variant` fields. Extra fields (mode,
 *     permission, ...) are dropped.
 *   - Duplicate names are rejected (the existing file is NEVER overwritten).
 *   - Creates the profile directory on first save.
 *
 * Usage:
 *   nas agents profile save <name>
 */

import { defineCommand } from 'citty';

import { readConfig } from '../../../lib/config-safety';
import { saveProfile } from '../../../lib/profile-store';

function fail(message: string, code = 1): never {
  console.error('Error:', message);
  process.exit(code);
}

export default defineCommand({
  meta: {
    name: 'save',
    description:
      'Snapshot current canonical NAS agent model+variant overrides into a named profile',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Profile name (saved under ~/.config/opencode/nas/profiles/<name>.json)',
      required: true,
    },
  },
  run({ args }) {
    try {
      const name = String(args.name ?? '').trim();
      if (!name) {
        fail('Profile name must be a non-empty string.');
      }

      const config = readConfig();
      const written = saveProfile(process.env.HOME || process.env.USERPROFILE || '/tmp', name, config);
      console.log(`Saved profile "${name}" to ${written}.`);
      console.log('Restart OpenCode (or run `nas agents profile load <name>`) to apply it.');
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});
