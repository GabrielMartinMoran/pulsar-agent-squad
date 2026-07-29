/**
 * Non-interactive `nas skills add <pattern> <action>` command.
 *
 * Adds a single rule to:
 *   - `--scope all-nas` (default): fan out to every canonical NAS
 *     agent's `agent.<name>.permission.skill` block. NEVER writes to
 *     top-level `permission.skill`.
 *   - `--scope agent --agent <name>`: a specific NAS agent's block.
 *
 * Backed by the pure `addSkillPolicy` library; the CLI only handles
 * I/O, backup, and confirmation.
 *
 * Usage:
 *   nas skills add <pattern> <action> [--scope all-nas|agent] [--agent <name>]
 *
 * Backups are created via `createBackup` BEFORE any write, matching the
 * `nas agents setup` policy.
 */

import { defineCommand } from 'citty';
import {
  readConfig,
  createBackup,
  writeConfig,
} from '../../lib/config-safety';
import {
  addSkillPolicy,
  type PermissionAction,
  type WriteScope,
  isValidAction,
} from '../../lib/skill-policies';

function fail(message: string, code = 1): never {
  console.error('Error:', message);
  process.exit(code);
}

export default defineCommand({
  meta: {
    name: 'add',
    description: 'Add a `permission.skill` rule (all NAS agents or one specific agent)',
  },
  args: {
    pattern: {
      type: 'positional',
      description: 'Wildcard pattern (native OpenCode syntax: `*`, `?`)',
      required: true,
    },
    action: {
      type: 'positional',
      description: 'Action: allow | deny | ask',
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
      const action = String(args.action ?? '').trim() as PermissionAction;
      const scope = String(args.scope ?? 'all-nas').trim();
      const agentName = args.agent ? String(args.agent).trim() : undefined;

      if (!pattern) fail('Pattern must be a non-empty string.');
      if (!isValidAction(action)) {
        fail(`Action must be one of: allow, deny, ask. Got: "${action}".`);
      }
      if (scope !== 'all-nas' && scope !== 'agent') {
        fail(`Scope must be "all-nas" or "agent". Got: "${scope}".`);
      }
      if (scope === 'agent' && !agentName) {
        fail('Scope "agent" requires --agent <name>.');
      }

      const config = readConfig();
      const next = addSkillPolicy(config, scope as WriteScope, pattern, action, agentName);

      if (args['dry-run']) {
        console.log(JSON.stringify(next, null, 2));
        return;
      }

      createBackup();
      writeConfig(next);
      console.log(
        `Added ${scope === 'agent' ? `agent "${agentName}" ` : 'all NAS agents '}rule: ${pattern} → ${action}`,
      );
      console.log(
        'Run `nas build --target=opencode && nas install --target=opencode` to propagate the rule into the dist + installed agent files, then restart OpenCode for the change to take effect at runtime.',
      );
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});
