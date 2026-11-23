import { ANSI, shouldColorize, colorize, type ColorEnv, type ColorOptions } from '../commands/agents/presenter';
import type { PolicyStore } from './policy-store';
import { PAS_AGENTS } from '../commands/agents/presenter';

export function buildToolsSummary(store: PolicyStore, options: ColorOptions = {}, env?: ColorEnv): string {
  const colored = shouldColorize(options, env);
  const title = colorize('OpenCode blocked tools — PAS agents', ANSI.BOLD, colored);
  return [title, ...PAS_AGENTS.map((name) => {
    const tools = store.agents[name]?.tools ?? [];
    const marker = colorize(tools.length ? '●' : '○', tools.length ? ANSI.GREEN : ANSI.GRAY, colored);
    const label = colorize(name, ANSI.BOLD + ANSI.CYAN, colored);
    return `${marker} ${label} · ${tools.length ? 'override' : 'default'}\n  Tools: ${tools.length ? tools.join(', ') : '(none)'}`;
  })].join('\n\n');
}
