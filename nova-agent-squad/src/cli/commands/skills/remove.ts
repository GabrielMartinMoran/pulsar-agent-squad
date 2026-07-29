/**
 * Non-interactive `nas skills remove <pattern>` command.
 *
 * Removes a single rule from:
 *   - `--scope all-nas` (default): remove the pattern from every
 *     canonical NAS agent's per-agent block. NEVER touches top-level
 *     `permission.skill`.
 *   - `--scope agent --agent <name>`: a specific NAS agent's block.
 *
 * Usage:
 *   nas skills remove <pattern> [--scope all-nas|agent] [--agent <name>]
 *
 * When the last rule is removed, the surrounding blocks are cleaned up
 * (delegated to the `removeSkillPolicy` library).
 */

import { defineCommand } from 'citty';
import {
  readConfig,
  createBackup,
  writeConfig,
} from '../../lib/config-safety';
import { removeSkillPolicy, type WriteScope } from '../../lib/skill-policies';

function fail(message: string, code = 1): never {
  console.error('Error:', message);
  process.exit(code);
}

export default defineCommand({
  meta: {
    name: 'remove',
    description: 'Remove a `permission.skill` rule (all NAS agents or one specific agent)',
  },
  args: {
    pattern: {
      type: 'positional',
      description: 'Wildcard pattern to remove',
      required: true,
    },
    scope: {
      type: 'string',
      default: 'all-nas',
      description: 'Scope: all-nas | agent',
    },
    agent: {
      type: 'string',
      description: 'Agent name (required when --scope agent)',
    },
    'dry-run': {
      type: 'boolean',
      default: false,
      description: 'Print the resulting config without writing',
    },
  },
  run({ args }) {
    try {
      const pattern = String(args.pattern ?? '').trim();
      const scope = String(args.scope ?? 'all-nas').trim();
      const agentName = args.agent ? String(args.agent).trim() : undefined;

      if (!pattern) fail('Pattern must be a non-empty string.');
      if (scope !== 'all-nas' && scope !== 'agent') {
        fail(`Scope must be "all-nas" or "agent". Got: "${scope}".`);
      }
      if (scope === 'agent' && !agentName) {
        fail('Scope "agent" requires --agent <name>.');
      }

      const config = readConfig();
      const next = removeSkillPolicy(config, scope as WriteScope, pattern, agentName);

      if (args['dry-run']) {
        console.log(JSON.stringify(next, null, 2));
        return;
      }

      createBackup();
      writeConfig(next);
      console.log(
        `Removed ${scope === 'agent' ? `agent "${agentName}" ` : 'all NAS agents '}rule: ${pattern}`,
      );
      console.log('Restart OpenCode for changes to take effect.');
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});
