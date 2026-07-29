/**
 * Non-interactive `pas skills clear` command.
 *
 * Clears skill policies for the given scope:
 *   - `all-pas` → drops every PAS agent's per-agent block
 *   - `agent`   → drops one specific PAS agent's per-agent block
 *     (requires `--agent <name>`)
 *   - `all`     → equivalent to `all-pas` (clears every PAS agent's
 *     per-agent block). Default for `pas skills clear`. Top-level
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

const VALID_SCOPES: ReadonlySet<SkillScope> = new Set(['all-pas', 'agent', 'all']);

export default defineCommand({
  meta: {
    name: 'clear',
    description: 'Clear `permission.skill` rules (default: all PAS agents)',
  },
  args: {
    scope: {
      type: 'string',
      default: 'all',
      description: 'Scope: all-pas | agent | all',
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
         fail(`Scope must be one of: all-pas, agent, all. Got: "${scope}".`);
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
           ? 'all PAS agent skill policies'
          : scope === 'agent'
            ? `agent "${agentName}" skill policies`
             : 'all PAS agent skill policies';
      console.log(`Cleared ${target}.`);
      console.log('Restart OpenCode for changes to take effect.');
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});
