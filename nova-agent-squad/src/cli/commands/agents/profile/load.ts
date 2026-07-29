/**
 * Non-interactive `nas agents profile load <name>` command.
 *
 * Reads a previously saved profile and applies it to
 * `~/.config/opencode/opencode.json`, intersecting the profile with
 * `NAS_AGENTS` (canonical NAS agents only).
 *
 * Behaviour (FEAT-008):
 *   - Only canonical NAS agents in the profile are written to the live
 *     config.
 *   - Live canonical overrides ABSENT from the profile are removed
 *     (the agent falls back to the default model).
 *   - Non-canonical / orphaned profile entries are silently ignored and
 *     reported in the command output (the load does not fail on them).
 *   - Unrelated top-level config fields and unrelated non-canonical
 *     agent overrides are preserved.
 *   - A timestamped backup (`opencode.json.bak.YYYYMMDDHHmmss`) is
 *     created BEFORE the write, matching the `nas skills` / `nas agents
 *     setup` policy.
 *
 * Backed by the pure `applyProfileToConfig` library for the
 * intersect/apply step; this file is the thin I/O shell (read, backup,
 * write, report).
 */

import { defineCommand } from 'citty';

import {
  readConfig,
  createBackup,
  writeConfig,
} from '../../../lib/config-safety';
import {
  applyProfileToConfig,
  readProfile,
} from '../../../lib/profile-store';

function fail(message: string, code = 1): never {
  console.error('Error:', message);
  process.exit(code);
}

export default defineCommand({
  meta: {
    name: 'load',
    description:
      'Apply a saved profile to ~/.config/opencode/opencode.json (intersected with the canonical NAS agent set)',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Profile name to load',
      required: true,
    },
  },
  run({ args }) {
    try {
      const name = String(args.name ?? '').trim();
      if (!name) {
        fail('Profile name must be a non-empty string.');
      }

      const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
      const config = readConfig();
      const profile = readProfile(home, name);

      const result = applyProfileToConfig(config, profile);

      // Backup-before-write, mirroring the `nas skills` and
      // `nas agents setup` policy. Only the write-side of `load` ever
      // touches `opencode.json`; the profile file is read-only here.
      createBackup();
      writeConfig(result.config);

      if (result.applied.length > 0) {
        console.log(`Updated NAS agents from profile "${name}":`);
        for (const agentName of result.applied) {
          console.log(`  ${agentName}`);
        }
      } else {
        console.log(`Profile "${name}" had no canonical NAS agents to apply.`);
      }

      if (result.ignored.length > 0) {
        // Per contract: silently ignore non-canonical/orphaned profile
        // entries, but still surface them so the user can clean up the
        // profile file if desired.
        console.log(`Skipped (no longer canonical): ${result.ignored.join(', ')}`);
      }

      console.log('Restart OpenCode for changes to take effect.');
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});
