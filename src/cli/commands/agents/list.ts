/**
 * Read-only summary printer for the configured models of every PAS agent.
 *
 * Reuses `buildAgentSummary` from `./presenter` so that the bare `pas agents`
 * command path and the explicit `pas agents list` subcommand produce
 * byte-identical output. The presenter decides whether to emit ANSI color
 * based on TTY state, the NO_COLOR env var, and the explicit `--plain`
 * flag.
 */

import { defineCommand } from 'citty';
import { readConfig } from '../../lib/config-safety';
import { buildAgentSummary } from './presenter';

export default defineCommand({
  meta: {
    name: 'list',
    description: 'Show configured models for all PAS agents',
  },
  args: {
    plain: {
      type: 'boolean',
      default: false,
      description: 'Disable ANSI color (also auto-disabled on non-TTY or when NO_COLOR is set)',
    },
  },
  run({ args }) {
    try {
      const config = readConfig();
      // When bare `pas agents --plain` is used, citty forwards the full
      // rawArgs (including `--plain`) to this default subcommand, so the
      // arg is available here in both `pas agents list --plain` and
      // `pas agents --plain` invocations.
      const plain = Boolean(args.plain);
      console.log(buildAgentSummary(config, { plain }));
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});
