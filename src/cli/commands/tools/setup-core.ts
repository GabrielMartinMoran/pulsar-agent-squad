/**
 * Pure wizard logic for `pas tools setup`.
 *
 * The CLI shell (`./command.ts`) wires the real `@inquirer/prompts`, the
 * PAS-owned policy store, and console output into this function. Keeping the
 * loop here lets the unit tests prove the write rules without a terminal:
 *
 *   1. A confirmed block / unblock / clear mutates the in-memory store and
 *      calls `save` exactly once for that action.
 *   2. Escape at the main menu exits cleanly and writes nothing.
 *   3. Escape at an inner step returns to the main menu without writing.
 *   4. Declining the confirmation returns to the main menu without writing.
 *   5. Real (non-abort) prompt errors propagate to the caller.
 */

import { AbortPromptError } from '@inquirer/core';
import type { ToolPolicyStore } from '../../lib/policy-store';
import type { ToolScope } from '../../lib/tool-policies';

/** Action the user picks on the main menu. */
export type ToolsAction = 'block' | 'unblock' | 'clear' | 'cancel';

/** A mutation action: everything except leaving the menu. */
export type ToolsMutation = Exclude<ToolsAction, 'cancel'>;

/**
 * Documented OpenCode actions offered by the wizard, in a stable order. The
 * store layer validates injectability; this list only drives the picker so a
 * user starts from names the CLI can actually inject.
 */
export const DEFAULT_TOOL_CHOICES: readonly string[] = [
  'shell',
  'subagent',
  'edit',
  'read',
  'glob',
  'grep',
  'webfetch',
  'websearch',
  'question',
  'todowrite',
] as const;

/** Prompt functions, all of which honour an AbortSignal for Escape. */
export interface ToolsPrompts {
  /** Main menu: block / unblock / clear / cancel. */
  action: (signal: AbortSignal) => Promise<ToolsAction>;
  /** Pick scope: every PAS agent or one named agent. */
  scope: (signal: AbortSignal) => Promise<ToolScope>;
  /** Pick an agent by name. Only invoked when scope=agent. */
  agent: (signal: AbortSignal) => Promise<string>;
  /** Pick a tool identifier from the suggested choices. */
  tool: (signal: AbortSignal, choices: readonly string[]) => Promise<string>;
  /** Confirm the pending change. */
  confirm: (preview: string, signal: AbortSignal) => Promise<boolean>;
}

/** A scoped AbortSignal for a single prompt invocation. */
export interface PromptSignalSession {
  signal: AbortSignal;
  dispose: () => void;
}

/** Applies one confirmed action to the current store. */
export type ToolsMutate = (
  store: ToolPolicyStore,
  action: ToolsMutation,
  scope: ToolScope,
  agent: string | undefined,
  tool: string | undefined,
) => ToolPolicyStore;

/** All dependencies the wizard needs; every side effect is injected. */
export interface ToolsSetupDeps {
  /** Store snapshot loaded before the wizard opens. */
  initial: ToolPolicyStore;
  prompts: ToolsPrompts;
  mutate: ToolsMutate;
  /** Persist one applied store. Never called when nothing was applied. */
  save: (store: ToolPolicyStore) => void;
  /** Tool names offered by the picker. */
  toolChoices?: readonly string[];
  /** Fresh Escape-aware signal per prompt; defaults to a no-op signal. */
  createPromptSignal?: () => PromptSignalSession;
  /** Classify the prompt library's Escape error. */
  isAbortPromptError?: (err: unknown) => boolean;
}

/** Final state of the wizard. */
export interface ToolsSetupResult {
  /** Number of confirmed actions saved. */
  applied: number;
  /** Latest in-memory store (unchanged when `applied` is 0). */
  store: ToolPolicyStore;
}

/** Default predicate matching @inquirer/core's `AbortPromptError`. */
export function isAbortPromptError(err: unknown): boolean {
  return err instanceof AbortPromptError;
}

/** Default signal factory: a never-aborting signal per prompt. */
function defaultCreatePromptSignal(): PromptSignalSession {
  const ctrl = new AbortController();
  return { signal: ctrl.signal, dispose: () => {} };
}

type PromptOutcome<T> = { kind: 'value'; value: T } | { kind: 'escape' };

async function runPrompt<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  createSignal: () => PromptSignalSession,
  classifyAbort: (err: unknown) => boolean,
): Promise<PromptOutcome<T>> {
  const session = createSignal();
  try {
    const value = await fn(session.signal);
    return { kind: 'value', value };
  } catch (err) {
    if (classifyAbort(err)) return { kind: 'escape' };
    throw err;
  } finally {
    session.dispose();
  }
}

function describeScope(scope: ToolScope, agent?: string): string {
  return scope === 'agent' ? `agent "${agent ?? ''}"` : 'all PAS agents';
}

function formatPreview(
  action: ToolsMutation,
  scope: ToolScope,
  agent?: string,
  tool?: string,
): string {
  const target = describeScope(scope, agent);
  if (action === 'clear') {
    return `  action:  clear every blocked tool\n  scope:   ${target}`;
  }
  return `  action:  ${action}\n  scope:   ${target}\n  tool:    ${tool ?? ''}`;
}

/**
 * Run the tools-setup loop until the user cancels or escapes the main menu.
 * See the module docstring for the write contract.
 */
export async function runToolsSetup(
  deps: ToolsSetupDeps,
): Promise<ToolsSetupResult> {
  let current = deps.initial;
  let applied = 0;

  const createSignal = deps.createPromptSignal ?? defaultCreatePromptSignal;
  const classifyAbort = deps.isAbortPromptError ?? isAbortPromptError;
  const toolChoices = deps.toolChoices ?? DEFAULT_TOOL_CHOICES;

  while (true) {
    const actionOutcome = await runPrompt(
      deps.prompts.action,
      createSignal,
      classifyAbort,
    );
    if (actionOutcome.kind === 'escape') break;

    const action = actionOutcome.value;
    if (action === 'cancel') break;

    const scopeOutcome = await runPrompt(
      deps.prompts.scope,
      createSignal,
      classifyAbort,
    );
    if (scopeOutcome.kind === 'escape') continue;
    const scope = scopeOutcome.value;

    let agent: string | undefined;
    if (scope === 'agent') {
      const agentOutcome = await runPrompt(
        deps.prompts.agent,
        createSignal,
        classifyAbort,
      );
      if (agentOutcome.kind === 'escape') continue;
      agent = agentOutcome.value;
    }

    let tool: string | undefined;
    if (action !== 'clear') {
      const toolOutcome = await runPrompt(
        (signal) => deps.prompts.tool(signal, toolChoices),
        createSignal,
        classifyAbort,
      );
      if (toolOutcome.kind === 'escape') continue;
      tool = toolOutcome.value;
    }

    const preview = formatPreview(action, scope, agent, tool);
    const confirmOutcome = await runPrompt(
      (signal) => deps.prompts.confirm(preview, signal),
      createSignal,
      classifyAbort,
    );
    if (confirmOutcome.kind === 'escape') continue;
    if (!confirmOutcome.value) continue;

    current = deps.mutate(current, action, scope, agent, tool);
    deps.save(current);
    applied += 1;
  }

  return { applied, store: current };
}
