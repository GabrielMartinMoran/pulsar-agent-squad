/**
 * Non-interactive `pas agents profile save <name>` command.
 *
 * Snapshots the current canonical agent model+variant overrides from
 * `~/.config/opencode/opencode.json` into a sidecar profile file at
 * `~/.config/opencode/pas/profiles/<name>.json`.
 *
 * Backed by the pure `saveProfile` library; this file is a thin I/O shell
 * (argument validation, error handling, console output).
 *
 * Behaviour (FEAT-008):
 *   - Only canonical agents (`PAS_AGENTS`) are serialized, and only
 *     with their `model` and `variant` fields. Extra fields (mode,
 *     permission, ...) are dropped.
 *   - Duplicate names are rejected (the existing file is NEVER overwritten).
 *   - Creates the profile directory on first save.
 *
 * Usage:
 *   pas agents profile save <name>
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
      'Snapshot current canonical PAS agent model+variant overrides into a named profile',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Profile name (saved under ~/.config/opencode/pas/profiles/<name>.json)',
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
      console.log('Restart OpenCode (or run `pas agents profile load <name>`) to apply it.');
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});
