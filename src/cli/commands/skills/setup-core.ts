/**
 * Pure wizard logic for `pas skills setup`.
 *
 * Extracted from `setup.ts` so the loop / escape / back-navigation
 * contract can be exercised against injected prompts and dependency
 * functions. The CLI command (`setup.ts`) wires the real
 * `@inquirer/prompts` and config helpers into this function.
 *
 * Approved contract this module implements:
 *
 *   1. After a successful add / remove / clear, return to the main
 *      menu so the user can run another action in the same wizard
 *      session.
 *   2. Escape on the main menu exits cleanly with no error and no
 *      config changes.
 *   3. The "Cancel" option on the main menu exits cleanly (no error,
 *      no config changes).
 *   4. Escape on an inner step goes back exactly one step in the
 *      navigation flow.
 *   5. Real (non-AbortPromptError) errors propagate to the caller.
 */

import { AbortPromptError } from '@inquirer/core';
import type { OpenCodeConfig } from '../../lib/config-safety';
import type {
  PermissionAction,
  SkillPolicyView,
  SkillRule,
  WriteScope,
} from '../../lib/skill-policies';

/** Action the user picks on the main menu. */
export type SkillsAction = 'add' | 'remove' | 'clear' | 'cancel';

/** Prompt functions, all of which honour an AbortSignal for Escape. */
export interface SkillsPrompts {
  /** Main menu: pick Add / Remove / Clear / Cancel. */
  chooseAction: (signal: AbortSignal) => Promise<SkillsAction>;
  /** Pick scope: all-pas or one specific agent. */
  chooseScope: (signal: AbortSignal) => Promise<WriteScope>;
  /** Pick an agent by name. Only invoked when scope=agent. */
  chooseAgent: (signal: AbortSignal) => Promise<string>;
  /** Pick or type a pattern for an add rule. */
  searchAddPattern: (suggestions: string[], signal: AbortSignal) => Promise<string>;
  /** Pick allow / deny / ask for a new rule. */
  chooseRuleAction: (signal: AbortSignal) => Promise<PermissionAction>;
  /** Confirm the pending add rule. */
  confirmAdd: (preview: string, signal: AbortSignal) => Promise<boolean>;
  /** Pick an existing pattern to remove. */
  searchRemovePattern: (rules: SkillRule[], signal: AbortSignal) => Promise<string>;
  /** Confirm the pending remove. */
  confirmRemove: (preview: string, signal: AbortSignal) => Promise<boolean>;
  /** Confirm the clear action. */
  confirmClear: (signal: AbortSignal) => Promise<boolean>;
}

/**
 * A scoped AbortSignal for a single prompt invocation. The wizard calls
 * `createPromptSignal()` before each prompt and `dispose()` in the
 * matching `finally` block so per-prompt listeners (e.g. the Escape
 * keypress listener) are torn down cleanly even when the prompt aborts.
 */
export interface PromptSignalSession {
  signal: AbortSignal;
  dispose: () => void;
}

/** All side-effecting dependencies the wizard needs. */
export interface SkillsWizardDeps {
  /** The initial config; replaced as changes are applied. */
  initialConfig: OpenCodeConfig;
  /** Snapshot of the existing skill policies (used for Remove suggestions). */
  initialView: SkillPolicyView;
  prompts: SkillsPrompts;
  /** Returns pattern suggestions (live OpenCode skills + existing rules). */
  discoverSkills: () => string[];
  addSkillPolicy: (
    config: OpenCodeConfig,
    scope: WriteScope,
    pattern: string,
    action: PermissionAction,
    agentName?: string,
  ) => OpenCodeConfig;
  removeSkillPolicy: (
    config: OpenCodeConfig,
    scope: WriteScope,
    pattern: string,
    agentName?: string,
  ) => OpenCodeConfig;
  clearSkillPolicies: (config: OpenCodeConfig, scope: 'all-pas' | 'agent' | 'all', agentName?: string) => OpenCodeConfig;
  createBackup: () => string;
  writeConfig: (config: OpenCodeConfig) => void;
  output: (line: string) => void;
  /** Recognise AbortPromptError (or whatever the prompt library throws on escape). */
  isAbortPromptError: (err: unknown) => boolean;
  /** Called once when the main-menu prompt is escaped. */
  onEscapeExit: () => void;
  /**
   * Create a fresh per-prompt AbortSignal session. The returned
   * `dispose` callback is invoked in a `finally` block after every
   * prompt, regardless of success, escape, or error. The default
   * returns a non-aborting signal — production wiring overrides this
   * with the Escape keypress listener (see `prompt-escape.ts`).
   */
  createPromptSignal?: () => PromptSignalSession;
}

/** Why the wizard returned. */
export type SkillsExitReason = 'outer_escape' | 'main_menu_cancel';

/** Final state of the wizard. */
export interface SkillsWizardResult {
  exitReason: SkillsExitReason;
  appliedChanges: number;
  finalConfig: OpenCodeConfig;
}

/** Convenience: re-export of @inquirer/core's escape error. */
export { AbortPromptError };

/**
 * Default predicate matching @inquirer/core's AbortPromptError. Wired
 * into the CLI command so the production code path uses the same
 * classification logic the tests do.
 */
export function isAbortPromptError(err: unknown): boolean {
  return err instanceof AbortPromptError;
}

/** Default signal factory: a never-aborting signal per prompt. */
function defaultCreatePromptSignal(): PromptSignalSession {
  const ctrl = new AbortController();
  return { signal: ctrl.signal, dispose: () => {} };
}

/**
 * Helper: run a prompt with a fresh signal session. Translates
 * AbortPromptError into a discriminated union the caller can act on.
 */
type PromptOutcome<T> = { kind: 'value'; value: T } | { kind: 'escape' };

async function runPrompt<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  createSignal: () => PromptSignalSession,
  isAbortPromptError: (err: unknown) => boolean,
): Promise<PromptOutcome<T>> {
  const session = createSignal();
  try {
    const value = await fn(session.signal);
    return { kind: 'value', value };
  } catch (err) {
    if (isAbortPromptError(err)) {
      return { kind: 'escape' };
    }
    throw err;
  } finally {
    session.dispose();
  }
}

/**
 * Format the human-readable preview shown on the add confirm step.
 */
function formatAddPreview(
  scope: WriteScope,
  pattern: string,
  action: PermissionAction,
  agentName?: string,
): string {
  const scopeLabel = scope === 'agent' ? `one specific agent (${agentName ?? ''})` : 'all PAS agents';
  return `  scope:    ${scopeLabel}\n  pattern:  ${pattern}\n  action:   ${action}`;
}

/**
 * Format the human-readable preview shown on the remove confirm step.
 */
function formatRemovePreview(
  scope: WriteScope,
  pattern: string,
  agentName?: string,
): string {
  const scopeLabel = scope === 'agent' ? `one specific agent (${agentName ?? ''})` : 'all PAS agents';
  return `  scope:    ${scopeLabel}\n  pattern:  ${pattern}`;
}

/**
 * Union of every PAS agent per-agent rule, in stable PAS_AGENTS order.
 * Mirrors the helper in `setup.ts` so the wizard can show one row per
 * pattern at `scope=all-pas`. Exported so the CLI wiring can reuse it
 * for non-interactive surfaces if needed.
 */
export function mergePasAgentRules(view: SkillPolicyView): SkillRule[] {
  // Stable order is maintained by the caller passing the agent list;
  // this signature stays open for future extraction.
  const seen = new Set<string>();
  const out: SkillRule[] = [];
  for (const list of Object.values(view.perAgent)) {
    for (const r of list) {
      if (seen.has(r.pattern)) continue;
      seen.add(r.pattern);
      out.push(r);
    }
  }
  return out;
}

/**
 * Build the union-of-PAS-agents rules list, preserving the canonical
 * agent order. Used by the Remove wizard at scope=all-pas.
 */
function rulesForScope(
  view: SkillPolicyView,
  scope: WriteScope,
  agentName: string | undefined,
  agentOrder: readonly string[],
): SkillRule[] {
  if (scope === 'agent') {
    return view.perAgent[agentName as string] ?? [];
  }
  // scope === 'all-pas'
  const seen = new Set<string>();
  const out: SkillRule[] = [];
  for (const name of agentOrder) {
    for (const r of view.perAgent[name] ?? []) {
      if (seen.has(r.pattern)) continue;
      seen.add(r.pattern);
      out.push(r);
    }
  }
  return out;
}

/**
 * Run the full skills-setup wizard loop.
 *
 * Contract: see the module docstring. The function never throws on a
 * prompt Escape — outer Escape exits cleanly, inner Escape unwinds one
 * step. Genuine (non-prompt) errors propagate to the caller.
 */
export async function runSkillsSetupWizard(
  deps: SkillsWizardDeps,
): Promise<SkillsWizardResult> {
  let currentConfig = deps.initialConfig;
  let appliedChanges = 0;

  const createSignal = deps.createPromptSignal ?? defaultCreatePromptSignal;
  // The agent list comes from `presenter.ts` indirectly — to keep the
  // core module free of I/O, accept the agent order via the prompt
  // itself (chooseAgent returns a string). For `scope=all-pas` rule
  // merging, fall back to the keys present in `initialView.perAgent`.
  const agentOrder = Object.keys(deps.initialView.perAgent);

  outerLoop: while (true) {
    // STEP 1: chooseAction (main menu). Escape → exit. Cancel → exit.
    const mainOutcome = await runPrompt(deps.prompts.chooseAction, createSignal, deps.isAbortPromptError);
    if (mainOutcome.kind === 'escape') {
      deps.onEscapeExit();
      return {
        exitReason: 'outer_escape',
        appliedChanges,
        finalConfig: currentConfig,
      };
    }
    const action: SkillsAction = mainOutcome.value;
    if (action === 'cancel') {
      return {
        exitReason: 'main_menu_cancel',
        appliedChanges,
        finalConfig: currentConfig,
      };
    }

    if (action === 'add') {
      // ADD flow.
      const result = await runAddFlow(currentConfig, deps, createSignal, agentOrder);
      if (result.kind === 'applied') {
        currentConfig = result.config;
        appliedChanges += 1;
        continue outerLoop;
      }
      // escape → loop back to main menu
      continue outerLoop;
    }

    if (action === 'remove') {
      // REMOVE flow.
      const result = await runRemoveFlow(currentConfig, deps, createSignal, agentOrder);
      if (result.kind === 'applied') {
        currentConfig = result.config;
        appliedChanges += 1;
        continue outerLoop;
      }
      // escape → loop back to main menu
      continue outerLoop;
    }

    // action === 'clear'
    {
      const result = await runClearFlow(currentConfig, deps, createSignal);
      if (result.kind === 'applied') {
        currentConfig = result.config;
        appliedChanges += 1;
      }
      // Either applied or escaped → loop back to main menu.
      continue outerLoop;
    }
  }
}

// ---------------------------------------------------------------------------
// Add flow
// ---------------------------------------------------------------------------

type FlowResult = { kind: 'applied'; config: OpenCodeConfig } | { kind: 'escape' };

async function runAddFlow(
  currentConfig: OpenCodeConfig,
  deps: SkillsWizardDeps,
  createSignal: () => PromptSignalSession,
  agentOrder: readonly string[],
): Promise<FlowResult> {
  // ADD SCOPE LOOP: re-enter on inner Escape.
  addScopeLoop: while (true) {
    const scopeOutcome = await runPrompt(deps.prompts.chooseScope, createSignal, deps.isAbortPromptError);
    if (scopeOutcome.kind === 'escape') {
      return { kind: 'escape' };
    }
    const scope: WriteScope = scopeOutcome.value;

    // Agent pick (only when scope=agent). Escape → back to scope.
    let agentName: string | undefined;
    if (scope === 'agent') {
      const agentOutcome = await runPrompt(deps.prompts.chooseAgent, createSignal, deps.isAbortPromptError);
      if (agentOutcome.kind === 'escape') {
        continue addScopeLoop;
      }
      agentName = agentOutcome.value;
    }

    // Build the pattern suggestion list: live OpenCode skills + existing
    // rule patterns across all PAS agents.
    let available: string[];
    try {
      available = deps.discoverSkills();
    } catch {
      available = [];
    }
    const existing: string[] = [];
    for (const list of Object.values(deps.initialView.perAgent)) {
      for (const r of list) existing.push(r.pattern);
    }
    const suggestions = Array.from(new Set([...available, ...existing])).sort();

    // PATTERN LOOP: re-enter on inner Escape (e.g. action step).
    addPatternLoop: while (true) {
      const patternOutcome = await runPrompt(
        (signal) => deps.prompts.searchAddPattern(suggestions, signal),
        createSignal,
        deps.isAbortPromptError,
      );
      if (patternOutcome.kind === 'escape') {
        // Back to scope (skip agent pick — user might want to change scope).
        continue addScopeLoop;
      }
      const pattern: string = patternOutcome.value;

      // ACTION LOOP: re-enter on inner Escape (e.g. confirm step).
      addActionLoop: while (true) {
        const actionOutcome = await runPrompt(deps.prompts.chooseRuleAction, createSignal, deps.isAbortPromptError);
        if (actionOutcome.kind === 'escape') {
          continue addPatternLoop;
        }
        const ruleAction: PermissionAction = actionOutcome.value;

        // Confirm step. Escape → back to action step.
        const preview = formatAddPreview(scope, pattern, ruleAction, agentName);
        const confirmOutcome = await runPrompt(
          (signal) => deps.prompts.confirmAdd(preview, signal),
          createSignal,
          deps.isAbortPromptError,
        );
        if (confirmOutcome.kind === 'escape') {
          continue addActionLoop;
        }
        const apply = confirmOutcome.value;
        if (!apply) {
          // Decline → back to main menu (consistent with the original
          // setup.ts behaviour for "Cancelled. No changes made.").
          return { kind: 'escape' };
        }

        // Apply.
        const modified = deps.addSkillPolicy(currentConfig, scope, pattern, ruleAction, agentName);
        deps.createBackup();
        deps.writeConfig(modified);
        deps.output(
          `Added ${scope === 'agent' ? `agent "${agentName}" ` : 'all PAS agents '}rule: ${pattern} → ${ruleAction}`,
        );
        deps.output(
          'Run `pas build --target=opencode && pas install --target=opencode` to propagate the rule into the dist + installed agent files, then restart OpenCode for the change to take effect at runtime.',
        );
        return { kind: 'applied', config: modified };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Remove flow
// ---------------------------------------------------------------------------

async function runRemoveFlow(
  currentConfig: OpenCodeConfig,
  deps: SkillsWizardDeps,
  createSignal: () => PromptSignalSession,
  agentOrder: readonly string[],
): Promise<FlowResult> {
  removeScopeLoop: while (true) {
    const scopeOutcome = await runPrompt(deps.prompts.chooseScope, createSignal, deps.isAbortPromptError);
    if (scopeOutcome.kind === 'escape') {
      return { kind: 'escape' };
    }
    const scope: WriteScope = scopeOutcome.value;

    let agentName: string | undefined;
    if (scope === 'agent') {
      const agentOutcome = await runPrompt(deps.prompts.chooseAgent, createSignal, deps.isAbortPromptError);
      if (agentOutcome.kind === 'escape') {
        continue removeScopeLoop;
      }
      agentName = agentOutcome.value;
    }

    const rules = rulesForScope(deps.initialView, scope, agentName, agentOrder);

    if (rules.length === 0) {
      // Nothing to remove — short-circuit back to main menu. The CLI
      // wiring will print the explanatory message; here we just exit.
      return { kind: 'escape' };
    }

    // PATTERN LOOP: re-enter on inner Escape (e.g. confirm step).
    removePatternLoop: while (true) {
      const patternOutcome = await runPrompt(
        (signal) => deps.prompts.searchRemovePattern(rules, signal),
        createSignal,
        deps.isAbortPromptError,
      );
      if (patternOutcome.kind === 'escape') {
        // Back to main menu (per the design asymmetry: Remove's pattern
        // step goes back to the main menu, not to scope).
        return { kind: 'escape' };
      }
      const pattern: string = patternOutcome.value;

      const preview = formatRemovePreview(scope, pattern, agentName);
      const confirmOutcome = await runPrompt(
        (signal) => deps.prompts.confirmRemove(preview, signal),
        createSignal,
        deps.isAbortPromptError,
      );
      if (confirmOutcome.kind === 'escape') {
        continue removePatternLoop;
      }
      const apply = confirmOutcome.value;
      if (!apply) {
        return { kind: 'escape' };
      }

      const modified = deps.removeSkillPolicy(currentConfig, scope, pattern, agentName);
      deps.createBackup();
      deps.writeConfig(modified);
      deps.output(
        `Removed ${scope === 'agent' ? `agent "${agentName}" ` : 'all PAS agents '}rule: ${pattern}`,
      );
      deps.output(
        'Run `pas build --target=opencode && pas install --target=opencode` to propagate the change into the dist + installed agent files, then restart OpenCode for the change to take effect at runtime.',
      );
      return { kind: 'applied', config: modified };
    }
  }
}

// ---------------------------------------------------------------------------
// Clear flow
// ---------------------------------------------------------------------------

async function runClearFlow(
  currentConfig: OpenCodeConfig,
  deps: SkillsWizardDeps,
  createSignal: () => PromptSignalSession,
): Promise<FlowResult> {
  const confirmOutcome = await runPrompt(deps.prompts.confirmClear, createSignal, deps.isAbortPromptError);
  if (confirmOutcome.kind === 'escape') {
    return { kind: 'escape' };
  }
  const apply = confirmOutcome.value;
  if (!apply) {
    return { kind: 'escape' };
  }

  const modified = deps.clearSkillPolicies(currentConfig, 'all');
  deps.createBackup();
  deps.writeConfig(modified);
  deps.output('Cleared all PAS agent skill policies.');
  deps.output(
    'Run `pas build --target=opencode && pas install --target=opencode` to propagate the change into the dist + installed agent files, then restart OpenCode for the change to take effect at runtime.',
  );
  return { kind: 'applied', config: modified };
}
