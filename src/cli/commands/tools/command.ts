import { defineCommand } from 'citty';
import { loadOrMigratePolicyStore } from '../../lib/policy-migration';
import { savePolicyStore, type PolicyStore } from '../../lib/policy-store';
import { blockTool, clearBlockedTools, criticalToolWarnings, normalizeTool, unblockTool, type ToolScope } from '../../lib/tool-policies';
import { PAS_AGENTS } from '../agents/presenter';
import select from '@inquirer/select';
import search from '@inquirer/search';
import confirm from '@inquirer/confirm';
import { createEscapeController } from '../../lib/prompt-escape';
import { isAbortPromptError } from '../skills/setup-core';
import { buildToolsSummary } from '../../lib/policy-presenter';
import { runToolsSetup } from './setup-core';

function current(): PolicyStore { return loadOrMigratePolicyStore().store ?? { version: 1, agents: {} }; }
function persist(store: PolicyStore, dry: boolean): void {
  if (dry) {
    console.log(JSON.stringify(store, null, 2));
    for (const warning of criticalToolWarnings(store)) console.warn(warning);
  }
  else {
    savePolicyStore(process.env.HOME || process.env.USERPROFILE || '/tmp', store);
    for (const warning of criticalToolWarnings(store)) console.warn(warning);
    console.log('Run `pas install --target=opencode` to rebuild and install, then restart OpenCode.');
  }
}
const args = { scope: { type: 'string' as const, default: 'all-pas', description: 'Scope: all-pas | agent' }, agent: { type: 'string' as const, description: 'Agent name (required for agent scope)' }, 'dry-run': { type: 'boolean' as const, default: false, description: 'Print without writing' } };
const toolArg = { tool: { type: 'positional' as const, required: true, description: 'OpenCode tool identifier' } };

export const listToolsCommand = defineCommand({ meta: { name: 'list', description: 'Show blocked tools per PAS agent' }, args: { plain: { type: 'boolean', default: false } }, run({ args }) {
  const store = current();
  console.log(buildToolsSummary(store, { plain: Boolean(args.plain) }));
} });
export const blockToolsCommand = defineCommand({ meta: { name: 'block', description: 'Block a tool (deny-only)' }, args: { ...toolArg, ...args }, run({ args }) {
  const normalized = normalizeTool(String(args.tool));
  if (normalized.normalizedFrom) console.log(`Normalized ${normalized.normalizedFrom} → ${normalized.tool}.`);
  if (normalized.warning) console.warn(normalized.warning);
  const scope = String(args.scope) as ToolScope;
  if (scope !== 'all-pas' && scope !== 'agent') throw new Error('Scope must be all-pas or agent.');
  persist(blockTool(current(), normalized.tool, scope, args.agent ? String(args.agent) : undefined), Boolean(args['dry-run']));
} });
export const unblockToolsCommand = defineCommand({ meta: { name: 'unblock', description: 'Unblock a tool' }, args: { ...toolArg, ...args }, run({ args }) {
  const tool = normalizeTool(String(args.tool)).tool;
  const scope = String(args.scope) as ToolScope;
  if (scope !== 'all-pas' && scope !== 'agent') throw new Error('Scope must be all-pas or agent.');
  persist(unblockTool(current(), tool, scope, args.agent ? String(args.agent) : undefined), Boolean(args['dry-run']));
} });
export const clearToolsCommand = defineCommand({ meta: { name: 'clear', description: 'Clear blocked tools' }, args: { ...args, scope: { ...args.scope, default: 'all' } }, run({ args }) {
  const scope = String(args.scope);
  if (!['all', 'all-pas', 'agent'].includes(scope)) throw new Error('Scope must be all, all-pas, or agent.');
  persist(clearBlockedTools(current(), scope as ToolScope | 'all', args.agent ? String(args.agent) : undefined), Boolean(args['dry-run']));
} });
export const setupToolsCommand = defineCommand({ meta: { name: 'setup', description: 'Interactively manage blocked tools' }, async run() {
  await runToolsSetup({ initial: current(), prompts: {
    action: (signal) => select({ message: 'Manage blocked tools', choices: [{ value: 'block', name: 'Block a tool' }, { value: 'unblock', name: 'Unblock a tool' }, { value: 'clear', name: 'Clear' }, { value: 'cancel', name: 'Cancel' }] }, { signal, clearPromptOnDone: true }),
    scope: (signal) => select({ message: 'Scope?', choices: [{ value: 'all-pas', name: 'All PAS agents' }, { value: 'agent', name: 'One agent' }] }, { signal, clearPromptOnDone: true }),
    agent: (signal) => select({ message: 'Which agent?', choices: PAS_AGENTS.map((name) => ({ value: name, name })) }, { signal, clearPromptOnDone: true }),
    tool: (signal, choices) => search({ message: 'Tool identifier', source: (term) => { const filtered = choices.filter((item) => item.toLowerCase().includes((term ?? '').toLowerCase())); if (term && !choices.includes(term)) filtered.unshift(term); return filtered.map((value) => ({ value, name: value })); } }, { signal, clearPromptOnDone: true }),
    confirm: (signal, message) => confirm({ message: `${message} Confirm?`, default: true }, { signal, clearPromptOnDone: true }),
  }, mutate: (state, action, scope, agent, tool) => action === 'clear' ? clearBlockedTools(state, scope, agent) : action === 'block' ? blockTool(state, tool!, scope, agent) : unblockTool(state, tool!, scope, agent), save: (state) => savePolicyStore(process.env.HOME || '/tmp', state), isAbort: isAbortPromptError, signal: () => { const esc = createEscapeController(); return { signal: esc.signal, dispose: () => esc.dispose() }; } });
} });
export const toolsCommand = defineCommand({ meta: { name: 'tools', description: 'Manage blocked tools for PAS agents' }, default: 'list', subCommands: {
  list: () => Promise.resolve(listToolsCommand), setup: () => Promise.resolve(setupToolsCommand), block: () => Promise.resolve(blockToolsCommand), unblock: () => Promise.resolve(unblockToolsCommand), clear: () => Promise.resolve(clearToolsCommand),
} });
