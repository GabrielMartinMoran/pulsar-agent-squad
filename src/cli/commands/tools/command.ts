/**
 * `pas tools` — deny-only tool policies for PAS agents.
 *
 * Every command reads and writes one PAS-owned document (see
 * `lib/policy-store.ts`) and never edits `opencode.json(c)`. Rules become
 * effective only after `pas build` regenerates agent files and `pas install`
 * copies them into place; the CLI states that instead of pretending a live
 * session changed.
 *
 *   list     read-only summary, never creates the store
 *   block    add one deny (all PAS agents or one agent)
 *   unblock  remove one deny from the selected scope
 *   clear    remove every deny from the selected scope
 *   setup    interactive wizard over the same operations
 *
 * All mutating commands support `--dry-run`, which prints the would-be store
 * and writes nothing. Escape aborts the wizard without writing.
 */

import { defineCommand } from 'citty';
import select from '@inquirer/select';
import confirm from '@inquirer/confirm';
import {
  loadToolPolicyStore,
  resolvePolicyPath,
  saveToolPolicyStore,
  type ToolPolicyStore,
} from '../../lib/policy-store';
import {
  blockTool,
  buildToolsSummary,
  canonicalToolIdentifier,
  clearBlockedTools,
  criticalToolWarnings,
  normalizeTool,
  unblockTool,
  type ClearToolScope,
  type ToolScope,
} from '../../lib/tool-policies';
import { createEscapeController } from '../../lib/prompt-escape';
import { PAS_AGENTS } from '../agents/presenter';
import {
  DEFAULT_TOOL_CHOICES,
  isAbortPromptError,
  runToolsSetup,
  type PromptSignalSession,
  type ToolsAction,
  type ToolsPrompts,
} from './setup-core';

function fail(message: string, code = 1): never {
  console.error('Error:', message);
  process.exit(code);
}

/** Every mutation is persisted only; effective after build + install + restart. */
const PROPAGATION_NOTE =
  'Run `pas build --target=opencode && pas install --target=opencode` to propagate the change into the generated and installed agent files, then start a fresh OpenCode session.';

function emptyStore(): ToolPolicyStore {
  return { version: 1, agents: {} };
}

/** Read the store, treating a missing file as the empty state. */
function loadStore(path: string): ToolPolicyStore {
  return loadToolPolicyStore(path) ?? emptyStore();
}

function parseScope(value: unknown, allowAll: boolean): ClearToolScope {
  const scope = String(value ?? (allowAll ? 'all' : 'all-pas')).trim();
  if (scope === 'all' && allowAll) return 'all';
  if (scope === 'all-pas' || scope === 'agent') return scope;
  throw new Error(
    `Scope must be one of: ${allowAll ? 'all-pas, agent, all' : 'all-pas, agent'}. Got: "${scope}".`,
  );
}

function requireAgent(scope: ClearToolScope, value: unknown): string | undefined {
  const agent = value ? String(value).trim() : undefined;
  if (scope !== 'agent') return undefined;
  if (!agent) throw new Error('Scope "agent" requires --agent <name>.');
  return agent;
}

function isDryRun(args: unknown): boolean {
  return Boolean((args as Record<string, unknown>)['dry-run']);
}

function printStore(store: ToolPolicyStore): void {
  console.log(JSON.stringify(store, null, 2));
}

/** Print non-blocking warnings for denies PAS cannot inject or that break a role. */
function warnAboutStore(store: ToolPolicyStore): void {
  for (const [agent, entry] of Object.entries(store.agents)) {
    for (const tool of entry.tools) {
      const warning = normalizeTool(tool).warning;
      if (warning) console.log(`Warning: ${agent}: ${warning}`);
    }
  }
  for (const warning of criticalToolWarnings(store)) console.log(warning);
}

function scopeLabel(scope: ClearToolScope, agent?: string): string {
  return scope === 'agent' ? `agent "${agent ?? ''}"` : 'all PAS agents';
}

const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'Show blocked tools per PAS agent (read-only)',
  },
  args: {
    plain: {
      type: 'boolean',
      default: false,
      description:
        'Disable ANSI color (also auto-disabled on non-TTY or when NO_COLOR is set)',
    },
  },
  run({ args }) {
    try {
      const path = resolvePolicyPath();
      const store = loadStore(path);
      process.stdout.write(
        buildToolsSummary(store, { plain: Boolean(args.plain) }),
      );
      warnAboutStore(store);
      console.log(`Store: ${path}`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});

const blockCommand = defineCommand({
  meta: {
    name: 'block',
    description: 'Block (deny) a tool for all PAS agents or one agent',
  },
  args: {
    tool: {
      type: 'positional',
      required: true,
      description: 'OpenCode action name (aliases: bash→shell, write/patch→edit, task→subagent)',
    },
    effect: {
      type: 'string',
      default: 'deny',
      description: 'Only `deny` is supported; allow/ask are rejected',
    },
    scope: {
      type: 'string',
      default: 'all-pas',
      description: 'Scope: all-pas | agent',
    },
    agent: {
      type: 'string',
      description: 'Agent name (required when --scope agent)',
    },
    'dry-run': {
      type: 'boolean',
      default: false,
      description: 'Print the resulting store without writing',
    },
  },
  run({ args }) {
    try {
      const effect = String(args.effect ?? 'deny').trim();
      if (effect !== 'deny') {
        throw new Error(
          'Tools are deny-only: allow and ask are rejected. Edit the role prompts to change base permissions.',
        );
      }
      const scope = parseScope(args.scope, false) as ToolScope;
      const agent = requireAgent(scope, args.agent);
      const normalized = normalizeTool(String(args.tool ?? '').trim());
      const path = resolvePolicyPath();
      const next = blockTool(loadStore(path), normalized.tool, scope, agent);

      if (isDryRun(args)) {
        printStore(next);
        return;
      }

      saveToolPolicyStore(next, path);
      const alias = normalized.normalizedFrom
        ? ` (alias of "${normalized.normalizedFrom}")`
        : '';
      console.log(
        `Blocked ${normalized.tool}${alias} for ${scopeLabel(scope, agent)}.`,
      );
      warnAboutStore(next);
      console.log(PROPAGATION_NOTE);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});

const unblockCommand = defineCommand({
  meta: {
    name: 'unblock',
    description: 'Remove a tool deny from all PAS agents or one agent',
  },
  args: {
    tool: {
      type: 'positional',
      required: true,
      description: 'OpenCode action name (aliases resolve to the canonical action)',
    },
    scope: {
      type: 'string',
      default: 'all-pas',
      description: 'Scope: all-pas | agent',
    },
    agent: {
      type: 'string',
      description: 'Agent name (required when --scope agent)',
    },
    'dry-run': {
      type: 'boolean',
      default: false,
      description: 'Print the resulting store without writing',
    },
  },
  run({ args }) {
    try {
      const scope = parseScope(args.scope, false) as ToolScope;
      const agent = requireAgent(scope, args.agent);
      const { tool } = canonicalToolIdentifier(String(args.tool ?? '').trim());
      const path = resolvePolicyPath();
      const next = unblockTool(loadStore(path), tool, scope, agent);

      if (isDryRun(args)) {
        printStore(next);
        return;
      }

      saveToolPolicyStore(next, path);
      console.log(`Unblocked ${tool} for ${scopeLabel(scope, agent)}.`);
      console.log(PROPAGATION_NOTE);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});

const clearCommand = defineCommand({
  meta: {
    name: 'clear',
    description: 'Clear tool denies (default: all PAS agents)',
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
      description: 'Print the resulting store without writing',
    },
  },
  run({ args }) {
    try {
      const scope = parseScope(args.scope, true);
      const agent = requireAgent(scope, args.agent);
      const path = resolvePolicyPath();
      const next = clearBlockedTools(loadStore(path), scope, agent);

      if (isDryRun(args)) {
        printStore(next);
        return;
      }

      saveToolPolicyStore(next, path);
      console.log(`Cleared tool denies for ${scopeLabel(scope, agent)}.`);
      console.log(PROPAGATION_NOTE);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});

function escapeSession(): PromptSignalSession {
  const escape = createEscapeController();
  return { signal: escape.signal, dispose: () => escape.dispose() };
}

const setupCommand = defineCommand({
  meta: {
    name: 'setup',
    description: 'Interactively edit PAS tool denies (Escape cancels without writing)',
  },
  async run() {
    try {
      const path = resolvePolicyPath();
      const initial = loadStore(path);

      const prompts: ToolsPrompts = {
        action: (signal) =>
          select<ToolsAction>(
            {
              message: 'What do you want to do?',
              choices: [
                { value: 'block', name: 'Block a tool', description: 'Add a deny' },
                { value: 'unblock', name: 'Unblock a tool', description: 'Remove a deny' },
                { value: 'clear', name: 'Clear', description: 'Remove every deny in scope' },
                { value: 'cancel', name: 'Cancel', description: 'Exit without changes' },
              ],
            },
            { signal, clearPromptOnDone: true },
          ),
        scope: (signal) =>
          select<ToolScope>(
            {
              message: 'Scope?',
              choices: [
                {
                  value: 'all-pas',
                  name: 'All PAS agents',
                  description: 'Apply to every canonical PAS agent',
                },
                {
                  value: 'agent',
                  name: 'One specific agent',
                  description: 'Apply to a single PAS agent',
                },
              ],
            },
            { signal, clearPromptOnDone: true },
          ),
        agent: (signal) =>
          select<string>(
            {
              message: 'Which agent?',
              choices: PAS_AGENTS.map((name) => ({ value: name, name })),
            },
            { signal, clearPromptOnDone: true },
          ),
        tool: (signal, choices) =>
          select<string>(
            {
              message: 'Which tool?',
              choices: choices.map((name) => ({ value: name, name })),
            },
            { signal, clearPromptOnDone: true },
          ),
        confirm: (preview, signal) =>
          confirm(
            {
              message: `Apply this change?\n\n${preview}`,
              default: true,
            },
            { signal, clearPromptOnDone: true },
          ),
      };

      const result = await runToolsSetup({
        initial,
        prompts,
        toolChoices: DEFAULT_TOOL_CHOICES,
        createPromptSignal: escapeSession,
        mutate: (store, action, scope, agent, tool) => {
          if (action === 'block') return blockTool(store, tool ?? '', scope, agent);
          if (action === 'unblock') return unblockTool(store, tool ?? '', scope, agent);
          return clearBlockedTools(store, scope, agent);
        },
        save: (store) => {
          saveToolPolicyStore(store, path);
        },
      });

      if (result.applied === 0) {
        console.log('No changes made.');
        return;
      }

      console.log(`Applied ${result.applied} change(s) to ${path}.`);
      warnAboutStore(result.store);
      console.log(PROPAGATION_NOTE);
    } catch (err) {
      if (isAbortPromptError(err)) return;
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});

export const toolsCommand = defineCommand({
  meta: {
    name: 'tools',
    description: 'Manage deny-only tool policies for PAS agents',
  },
  // Read-only default: bare `pas tools` prints the same view as `pas tools list`.
  default: 'list',
  subCommands: {
    list: () => Promise.resolve(listCommand),
    setup: () => Promise.resolve(setupCommand),
    block: () => Promise.resolve(blockCommand),
    unblock: () => Promise.resolve(unblockCommand),
    clear: () => Promise.resolve(clearCommand),
  },
});
