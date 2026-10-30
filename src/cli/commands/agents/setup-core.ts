/**
 * Pure wizard logic for `pas agents setup`.
 *
 * Extracted from `setup.ts` so the loop / escape / cache contract can be
 * exercised against injected prompts and dependency functions. The CLI
 * command (`setup.ts`) wires the real @inquirer/prompts and config
 * helpers into this function.
 *
 * Approved contract this module implements:
 *
 *   1. After configuring an agent, return to the main agent list so
 *      another can be configured in the same run.
 *   2. Escape on the main agent list exits cleanly without error.
 *   3. Escape on inner steps goes back exactly one step.
 *   4. Cache the target's model list in memory after the first
 *      successful load during the current wizard run.
 *      (Implemented by the target adapter; this module just calls
 *      `deps.discoverModels()`.)
 */

import { AbortPromptError } from '@inquirer/core';
import type { OpenCodeConfig } from '../../lib/config-safety';
import type { Model } from '../../lib/model-discovery';

/** Action the user picks on the "what do you want to do" step. */
export type Action = 'change_model' | 'inherit_default' | 'cancel';

/** Prompt functions, all of which honour an AbortSignal for Escape. */
export interface SetupPrompts {
  selectAgent: (config: OpenCodeConfig, signal: AbortSignal) => Promise<string>;
  chooseAction: (agentName: string, signal: AbortSignal) => Promise<Action>;
  searchModel: (models: Model[], signal: AbortSignal) => Promise<Model>;
  chooseVariant: (modelId: string, variants: string[], signal: AbortSignal) => Promise<string>;
  /** Choose a thinking level for a model that reports thinking support. */
  selectThinking?: (levels: readonly string[], signal: AbortSignal) => Promise<string>;
  /** Manual model entry when discovery returns nothing. */
  inputModel?: (agentName: string, signal: AbortSignal) => Promise<string>;
  confirmApply: (preview: string, signal: AbortSignal) => Promise<boolean>;
}

/**
 * A scoped AbortSignal for a single prompt invocation. The wizard calls
 * `createPromptSignal()` before each prompt and `dispose()` in the
 * matching `finally` block so per-prompt listeners (e.g. the Escape
 * keypress listener) are torn down cleanly even when the prompt
 * aborts.
 */
export interface PromptSignalSession {
  signal: AbortSignal;
  dispose: () => void;
}

/** All side-effecting dependencies the wizard needs. */
export interface SetupWizardDeps {
  /**
   * Optional target pre-configure step (for example, installing missing Pi
   * packages). Runs after preflight and before the first wizard prompt.
   * Returns a summary line/block to print.
   */
  prepare?: () => Promise<string | undefined>;
  /**
   * Re-read the target config after `prepare`. Targets whose pre-configure
   * step rewrites the config file (Pi's `install`) must supply this so the
   * model merge starts from the post-install file.
   */
  reloadConfig?: () => OpenCodeConfig;
  prompts: SetupPrompts;
  discoverModels: () => Promise<Model[]>;
  populateVariantsFromModelList: () => Promise<void>;
  discoverVariants: (modelId: string) => string[];
  setAgentModel: (
    config: OpenCodeConfig,
    agentName: string,
    modelId: string,
    variant?: string,
    thinking?: string,
    provider?: string,
  ) => OpenCodeConfig;
  removeAgentOverride: (config: OpenCodeConfig, agentName: string) => OpenCodeConfig;
  createBackup: () => string;
  writeConfig: (config: OpenCodeConfig) => void;
  formatOutput: (
    agentName: string,
    modelId?: string,
    variant?: string,
    thinking?: string,
    provider?: string,
  ) => string;
  /** Closing message after a successful write (target-owned, e.g. reload hint). */
  reloadHint?: string;
  /** Message shown when model discovery returns nothing (target-owned). */
  noModelsHint?: string;
  /** Whether the target supports the variant step. Defaults to enabled. */
  supportsVariants?: boolean;
  /** Whether the target supports a thinking-level step. */
  supportsThinking?: boolean;
  /** Thinking levels offered, in display order. */
  thinkingLevels?: readonly string[];
  /** Whether discovery falls back to manual model entry. */
  supportsManualModelInput?: boolean;
  /** Whether a discovered model reports thinking support. */
  modelSupportsThinking?: (model: Model) => boolean;
  output: (line: string) => void;
  /** Recognise AbortPromptError (or whatever the prompt library throws on escape). */
  isAbortPromptError: (err: unknown) => boolean;
  /** Called once when the outer select-agent prompt is escaped. */
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
export type WizardExitReason = 'outer_escape';

/** Final state of the wizard. */
export interface WizardResult {
  exitReason: WizardExitReason;
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

type ConfirmOutcome =
  | { kind: 'applied'; config: OpenCodeConfig }
  | { kind: 'decline' }
  | { kind: 'escape' };

/**
 * Run the confirm step. Returns one of:
 *   - `applied`   : user confirmed, writeConfig done, config is the new one
 *   - `decline`   : user said no, go back to action step
 *   - `escape`    : user pressed Escape, caller decides where to go
 *
 * The caller decides the escape target (variant or search_model) by
 * inspecting whether `variant` was set when this function returned.
 */
async function runConfirmStep(
  agentName: string,
  model: Model,
  variant: string | undefined,
  thinking: string | undefined,
  currentConfig: OpenCodeConfig,
  deps: SetupWizardDeps,
  createSignal: () => PromptSignalSession,
): Promise<ConfirmOutcome> {
  const preview = deps.formatOutput(agentName, model.id, variant, thinking, model.provider);
  const session = createSignal();
  let confirmed: boolean;
  try {
    confirmed = await deps.prompts.confirmApply(preview, session.signal);
  } catch (err) {
    if (deps.isAbortPromptError(err)) {
      return { kind: 'escape' };
    }
    throw err;
  } finally {
    session.dispose();
  }

  if (!confirmed) {
    return { kind: 'decline' };
  }

  const modified = deps.setAgentModel(
    currentConfig,
    agentName,
    model.id,
    variant,
    thinking,
    model.provider,
  );
  deps.createBackup();
  deps.writeConfig(modified);
  deps.output(deps.formatOutput(agentName, model.id, variant, thinking, model.provider));
  if (deps.reloadHint) deps.output(deps.reloadHint);
  return { kind: 'applied', config: modified };
}

/**
 * Run the full agent-configuration wizard loop.
 *
 * Contract: see the module docstring. The function never throws on a
 * prompt Escape — outer Escape exits cleanly, inner Escape unwinds one
 * step. Genuine (non-prompt) errors propagate to the caller.
 */
export async function runSetupWizard(
  initialConfig: OpenCodeConfig,
  deps: SetupWizardDeps,
): Promise<WizardResult> {
  let currentConfig = initialConfig;
  let appliedChanges = 0;

  const createSignal = deps.createPromptSignal ?? defaultCreatePromptSignal;

  // Pre-configure step (e.g. Pi packages) runs before the first prompt and
  // before any model merge. A target that rewrites its config on install
  // supplies `reloadConfig` so the merge starts from the post-install file.
  if (deps.prepare) {
    const summary = await deps.prepare();
    if (summary) deps.output(summary);
    if (deps.reloadConfig) currentConfig = deps.reloadConfig();
  }

  outerLoop: while (true) {
    // STEP 1: select_agent (outer). Escape here exits cleanly.
    const outerSession = createSignal();
    let agentName: string;
    try {
      agentName = await deps.prompts.selectAgent(currentConfig, outerSession.signal);
    } catch (err) {
      if (deps.isAbortPromptError(err)) {
        deps.onEscapeExit();
        return {
          exitReason: 'outer_escape',
          appliedChanges,
          finalConfig: currentConfig,
        };
      }
      throw err;
    } finally {
      outerSession.dispose();
    }

    // INNER: configure_agent
    actionLoop: while (true) {
      // STEP 2: choose_action. Escape → back to select_agent.
      const actionSession = createSignal();
      let action: Action;
      try {
        action = await deps.prompts.chooseAction(agentName, actionSession.signal);
      } catch (err) {
        if (deps.isAbortPromptError(err)) {
          continue outerLoop;
        }
        throw err;
      } finally {
        actionSession.dispose();
      }

      if (action === 'cancel') {
        continue outerLoop;
      }

      if (action === 'inherit_default') {
        const modified = deps.removeAgentOverride(currentConfig, agentName);
        deps.createBackup();
        deps.writeConfig(modified);
        deps.output(deps.formatOutput(agentName, undefined));
        if (deps.reloadHint) deps.output(deps.reloadHint);
        currentConfig = modified;
        appliedChanges++;
        continue outerLoop;
      }

      // action === 'change_model'
      // STEP 3 (passive): discover models.
      const allModels = await deps.discoverModels();

      if (allModels.length > 0) {
        await deps.populateVariantsFromModelList();
      } else if (!deps.supportsManualModelInput || !deps.prompts.inputModel) {
        // Preserve the historical OpenCode behavior: hint and go back.
        if (deps.noModelsHint) deps.output(deps.noModelsHint);
        continue outerLoop;
      } else if (deps.noModelsHint) {
        deps.output(deps.noModelsHint);
      }

      searchLoop: while (true) {
        // STEP 4: search_model (or manual entry when discovery was empty).
        // Escape → back to choose_action.
        const searchSession = createSignal();
        let model: Model;
        try {
          if (allModels.length > 0) {
            model = await deps.prompts.searchModel(allModels, searchSession.signal);
          } else {
            const entered = await deps.prompts.inputModel!(agentName, searchSession.signal);
            const trimmed = entered.trim();
            if (!trimmed) {
              continue searchLoop;
            }
            model = { id: trimmed, provider: '', name: trimmed };
          }
        } catch (err) {
          if (deps.isAbortPromptError(err)) {
            continue actionLoop;
          }
          throw err;
        } finally {
          searchSession.dispose();
        }

        const thinkingOffered =
          deps.supportsThinking === true &&
          deps.modelSupportsThinking?.(model) === true &&
          deps.prompts.selectThinking !== undefined;

        if (thinkingOffered) {
          thinkingLoop: while (true) {
            const thinkingSession = createSignal();
            let thinking: string;
            try {
              thinking = await deps.prompts.selectThinking!(
                deps.thinkingLevels ?? [],
                thinkingSession.signal,
              );
            } catch (err) {
              if (deps.isAbortPromptError(err)) {
                continue searchLoop;
              }
              throw err;
            } finally {
              thinkingSession.dispose();
            }

            // Confirm → escape goes back to the thinking step.
            const outcome = await runConfirmStep(
              agentName,
              model,
              undefined,
              thinking,
              currentConfig,
              deps,
              createSignal,
            );
            if (outcome.kind === 'applied') {
              currentConfig = outcome.config;
              appliedChanges++;
              continue outerLoop;
            }
            if (outcome.kind === 'escape') {
              continue thinkingLoop;
            }
            // decline → back to action
            continue actionLoop;
          }
        }

        const variants = deps.supportsVariants === false ? [] : deps.discoverVariants(model.id);

        if (variants.length === 0) {
          // No option step. Confirm → escape goes back to search_model.
          const outcome = await runConfirmStep(
            agentName,
            model,
            undefined,
            undefined,
            currentConfig,
            deps,
            createSignal,
          );
          if (outcome.kind === 'applied') {
            currentConfig = outcome.config;
            appliedChanges++;
            continue outerLoop;
          }
          if (outcome.kind === 'escape') {
            continue searchLoop;
          }
          // decline → back to action
          continue actionLoop;
        }

        // Variants exist → show variant step.
        variantLoop: while (true) {
          const variantSession = createSignal();
          let variant: string;
          try {
            variant = await deps.prompts.chooseVariant(model.id, variants, variantSession.signal);
          } catch (err) {
            if (deps.isAbortPromptError(err)) {
              continue searchLoop;
            }
            throw err;
          } finally {
            variantSession.dispose();
          }

          // Confirm → escape goes back to variant step.
          const outcome = await runConfirmStep(
            agentName,
            model,
            variant,
            undefined,
            currentConfig,
            deps,
            createSignal,
          );
          if (outcome.kind === 'applied') {
            currentConfig = outcome.config;
            appliedChanges++;
            continue outerLoop;
          }
          if (outcome.kind === 'escape') {
            continue variantLoop;
          }
          // decline → back to action
          continue actionLoop;
        }
      }
    }
  }
}
