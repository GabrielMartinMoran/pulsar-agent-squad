/**
 * Non-interactive `nas skills clear` command.
 *
 * Clears skill policies for the given scope:
 *   - `all-nas` → drops every NAS agent's per-agent block
 *   - `agent`   → drops one specific NAS agent's per-agent block
 *     (requires `--agent <name>`)
 *   - `all`     → equivalent to `all-nas` (clears every NAS agent's
 *     per-agent block). Default for `nas skills clear`. Top-level
 *     `permission.skill` is NEVER touched (the CLI does not manage it).
 *
 * The default is `all`, which mirrors the user-facing UX intent
 * ("clear all my skill policies") without making the user type a flag.
 */

import { defineCommand } from 'citty';
import {
  readConfig,
  createBackup,
  writeConfig,
} from '../../lib/config-safety';
import { clearSkillPolicies, type SkillScope } from '../../lib/skill-policies';

function fail(message: string, code = 1): never {
  console.error('Error:', message);
  process.exit(code);
}

const VALID_SCOPES: ReadonlySet<SkillScope> = new Set(['all-nas', 'agent', 'all']);

export default defineCommand({
  meta: {
    name: 'clear',
    description: 'Clear `permission.skill` rules (default: all NAS agents)',
  },
  args: {
    scope: {
      type: 'string',
      default: 'all',
      description: 'Scope: all-nas | agent | all',
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
      const scope = String(args.scope ?? 'all').trim() as SkillScope;
      const agentName = args.agent ? String(args.agent).trim() : undefined;

      if (!VALID_SCOPES.has(scope)) {
        fail(`Scope must be one of: all-nas, agent, all. Got: "${scope}".`);
      }
      if (scope === 'agent' && !agentName) {
        fail('Scope "agent" requires --agent <name>.');
      }

      const config = readConfig();
      const next = clearSkillPolicies(config, scope, agentName);

      if (args['dry-run']) {
        console.log(JSON.stringify(next, null, 2));
        return;
      }

      createBackup();
      writeConfig(next);
      const target =
        scope === 'all'
          ? 'all NAS agent skill policies'
          : scope === 'agent'
            ? `agent "${agentName}" skill policies`
            : 'all NAS agent skill policies';
      console.log(`Cleared ${target}.`);
      console.log('Restart OpenCode for changes to take effect.');
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});
