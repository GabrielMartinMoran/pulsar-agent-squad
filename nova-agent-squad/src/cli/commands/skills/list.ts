/**
 * Read-only summary printer for `permission.skill` rules in OpenCode.
 *
 * Reuses `buildSkillSummary` from `./presenter` so that the bare
 * `nas skills` command path and the explicit `nas skills list`
 * subcommand produce byte-identical output.
 *
 * The list surface is intentionally read-only:
 *   - it never modifies `opencode.json`
 *   - it never creates backups
 *   - the only environment side-effect is printing to stdout
 *
 * Available skills (from `opencode debug skill`) are surfaced as a
 * reference list so the user can see what they could add a policy for.
 * The reference list is purely informational — the presenter's source
 * of truth is the config, not the live OpenCode skill registry.
 */

import { defineCommand } from 'citty';
import { readConfig } from '../../lib/config-safety';
import { readSkillPolicies } from '../../lib/skill-policies';
import { listAvailableSkills } from '../../lib/skill-discovery';
import { buildSkillSummary } from './presenter';
import { NAS_AGENTS } from '../agents/presenter';

export default defineCommand({
  meta: {
    name: 'list',
    description: 'Show `permission.skill` rules — global and per NAS agent',
  },
  args: {
    plain: {
      type: 'boolean',
      default: false,
      description:
        'Disable ANSI color (also auto-disabled on non-TTY or when NO_COLOR is set)',
    },
    'skip-discovery': {
      type: 'boolean',
      default: false,
      description:
        'Skip the "Available skills" reference list (useful in CI / piped scripts)',
    },
  },
  run({ args }) {
    try {
      const config = readConfig();
      const view = readSkillPolicies(config);
      const plain = Boolean(args.plain);
      // Citty converts `--skip-discovery` → `skipDiscovery`
      const skipDiscovery = Boolean(
        (args as Record<string, unknown>).skipDiscovery,
      );

      const summary = buildSkillSummary(view, { plain });
      const out: string[] = [summary];

      // Surface the canonical NAS agent list once at the bottom so users
      // can copy/paste it into `nas skills add --agent <name>`.
      out.push(
        '',
        `NAS agents: ${NAS_AGENTS.join(', ')}`,
      );

      // Optional: include the live OpenCode skill registry. This is
      // reference info only; we never edit config based on it. Failures
      // here must not break the read-only surface.
      if (!skipDiscovery) {
        try {
          const available = listAvailableSkills();
          if (available.length > 0) {
            out.push('', `Available skills (via \`opencode debug skill\`): ${available.join(', ')}`);
          } else {
            out.push('', 'Available skills: (none reported by `opencode debug skill`)');
          }
        } catch {
          out.push('', 'Available skills: (could not run `opencode debug skill`)');
        }
      }

      console.log(out.join('\n'));
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});
