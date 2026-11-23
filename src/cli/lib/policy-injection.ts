import { findPermissionsBlock } from './skill-injection';
import { loadOrMigratePolicyStore } from './policy-migration';

let warnedLegacy = false;

/** Append tool denials to native V2 permissions, preserving last-match-wins. */
export function injectToolDenies(content: string, tools: string[]): string {
  if (tools.length === 0) return content;
  const block = findPermissionsBlock(content);
  if (!block) {
    if (/^permission:\s*$/m.test(content) && !warnedLegacy) {
      warnedLegacy = true;
      console.warn('Skipping tool policy injection for a V1 permission block; rebuild the agent with V2 permissions.');
    }
    return content;
  }

  const lines = content.split('\n');
  const existingDenies = new Set<string>();
  for (let i = block.firstChildLine; i <= block.lastChildLine; i++) {
    const action = /^  - action:\s*(.*?)\s*$/.exec(lines[i]!);
    if (!action) continue;
    const itemStart = i;
    let end = i + 1;
    while (end <= block.lastChildLine && !/^  - action:\s*/.test(lines[end]!)) end++;
    const item = lines.slice(itemStart, end).join('\n');
    const value = action[1]!.trim().replace(/^['"]|['"]$/g, '');
    const globalDeny = /^    resource:\s*["']?\*["']?\s*$/m.test(item) && /^    effect:\s*deny\s*$/m.test(item);
    const laterAllow = /^    effect:\s*allow\s*$/m.test(item);
    if (globalDeny) existingDenies.add(value);
    if (laterAllow) existingDenies.delete(value);
    i = end - 1;
  }

  const additions = [...new Set(tools)].filter((tool) => !existingDenies.has(tool)).flatMap((tool) => [
    `  - action: ${tool}`,
    '    resource: "*"',
    '    effect: deny',
  ]);
  if (!additions.length) return content;
  return [...lines.slice(0, block.endLine), ...additions, ...lines.slice(block.endLine)].join('\n');
}

/** Load the PAS store and inject one agent's stored tool denials. */
export function injectToolPoliciesFromStore(agentName: string, content: string, configPathOverride?: string): string {
  const prior = process.env.PAS_OPENCODE_CONFIG_PATH;
  if (configPathOverride) process.env.PAS_OPENCODE_CONFIG_PATH = configPathOverride;
  try {
    return injectToolDenies(content, loadOrMigratePolicyStore().store?.agents[agentName]?.tools ?? []);
  } finally {
    if (prior === undefined) delete process.env.PAS_OPENCODE_CONFIG_PATH;
    else process.env.PAS_OPENCODE_CONFIG_PATH = prior;
  }
}
