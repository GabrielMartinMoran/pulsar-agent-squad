/**
 * Interactive PAS agent model configuration wizard.
 *
 * Flow: Select agent → Choose action → (if change) Search model → Confirm → Apply
 *
 * After applying a change (or cancelling / escaping an inner step), the
 * wizard returns to the main agent list so another agent can be
 * configured in the same run. Escape on the main agent list exits the
 * wizard cleanly (exit code 0, no error log).
 *
 * Uses @inquirer/prompts for interactive search/select/confirm prompts.
 * The pure loop logic lives in `./setup-core`; this module is the
 * thin I/O wiring (real prompts, adapter-provided persistence and
 * discovery, console output).
 *
 * Target selection: `--target=<id>` chooses a registered setup adapter.
 * OpenCode is the default. Unsupported ids fail before any config read.
 */

import { defineCommand } from 'citty';
import search from '@inquirer/search';
import select from '@inquirer/select';
import confirm from '@inquirer/confirm';
import input from '@inquirer/input';
import {
  PAS_AGENTS as PRESENTER_PAS_AGENTS,
  getModelGuidance as presenterGetModelGuidance,
  getModelGuidanceLabel as presenterGetModelGuidanceLabel,
} from './presenter';
import type { AnySetupTargetAdapter, SetupTargetAdapter } from './targets/adapter';
import {
  getSetupTarget,
  resolveSetupTarget,
  supportedTargetIds,
} from './targets/adapter';
import { formatAgentOutput } from './targets/opencode';
import { runSetupWizard, isAbortPromptError, type Action } from './setup-core';
import type { Model } from '../../lib/model-discovery';
import { createEscapeController } from '../../lib/prompt-escape';

export { formatAgentOutput };
export const PAS_AGENTS = PRESENTER_PAS_AGENTS;

function currentModelLabel(config: Record<string, unknown> | undefined): string | undefined {
  return config?.model as string | undefined;
}

/**
 * Safely extract the persisted variant from a per-agent config entry.
 * Returns `undefined` when the value is missing, empty, or not a string
 * (no blind casts — objects/numbers are not printed).
 */
function currentVariantLabel(entry: Record<string, unknown> | undefined): string | undefined {
  if (!entry) return undefined;
  const v = entry.variant;
  return typeof v === 'string' ? v : undefined;
}

/**
 * Build the outer agent-selector choice description for the setup wizard.
 *
 * Format: `(model [variant]) · guidance`
 *
 * Variant normalisation rules:
 *   - `undefined`, empty string, or literal `"default"` → displayed as `[default]`
 *   - any other string (e.g. `"xhigh"`, `"none"`) → displayed as `[<value>]`
 *   - when no agent-level model exists, the entire model/variant group is omitted
 *   - when guidance is absent, no trailing `· guidance` is appended
 *
 * Accepts and types unknown values safely (no blind casts).
 */
export function buildAgentChoiceDescription(
  modelId: string | undefined,
  variant: string | undefined,
  guidance: string | undefined,
): string {
  const parts: string[] = [];

  if (modelId) {
    // Normalise variant display: undefined, empty, or literal "default" → "default"
    const displayVariant =
      variant === undefined || variant === '' || variant === 'default'
        ? 'default'
        : variant;
    parts.push(`(${modelId} [${displayVariant}])`);
  }

  if (guidance) {
    parts.push(guidance);
  }

  return parts.join(' · ');
}

/**
 * Returns the model-capability guidance kind for an agent
 * (`'light' | 'heavy' | undefined`). Used by the setup wizard and any
 * callers that need the structured kind, not the human-readable label.
 */
export function getModelGuidance(agentName: string) {
  return presenterGetModelGuidance(agentName);
}

/**
 * Returns the human-friendly model-capability guidance label for an agent
 * (e.g. "heavy model recommended"). Used by the list presenter and any
 * callers that want to display the wording directly.
 */
export function getModelGuidanceLabel(agentName: string) {
  return presenterGetModelGuidanceLabel(agentName);
}

/**
 * Prompt for the tool to configure. Choices come from the adapter registry,
 * not the manifest, so every offered option really has a setup adapter.
 * OpenCode is the default.
 */
async function selectTargetPrompt(signal: AbortSignal): Promise<string> {
  const choices = supportedTargetIds().map((id) => {
    const adapter = getSetupTarget(id)!;
    return {
      value: id,
      name: adapter.label,
      description: id === 'opencode' ? 'default' : id,
    };
  });

  return select<string>(
    {
      message: 'Which tool do you want to configure?',
      choices,
      default: 'opencode',
    },
    { signal, clearPromptOnDone: true },
  );
}

/** Registry seam for target resolution (injectable in tests). */
export interface SetupTargetRegistry {
  resolve(id: string): AnySetupTargetAdapter;
}

/** Options for `resolveSetupAdapter`. */
export interface ResolveSetupAdapterOptions {
  /** Explicit `--target` value; when present the selection prompt is skipped. */
  target?: string;
  prompts: {
    selectTarget: () => Promise<string>;
  };
  registry?: SetupTargetRegistry;
}

/**
 * Resolve the setup adapter for an explicit target or ask which tool to
 * configure exactly once. Kept separate from the command so the
 * no-prompt-when-explicit contract is testable without a TTY.
 */
export async function resolveSetupAdapter(
  options: ResolveSetupAdapterOptions,
): Promise<AnySetupTargetAdapter> {
  const registry = options.registry ?? { resolve: resolveSetupTarget };
  const targetId =
    options.target !== undefined && options.target.length > 0
      ? options.target
      : await options.prompts.selectTarget();
  return registry.resolve(targetId);
}

/**
 * Build a search prompt for an agent list, with the agent's current
 * model and capability guidance shown in the description. Shared by
 * the outer select_agent step and any future inner re-selection.
 */
async function selectAgentPrompt(
  config: Record<string, unknown>,
  signal: AbortSignal,
  adapter: SetupTargetAdapter,
): Promise<string> {
  const names = adapter.agents.map((agent) => agent.name);
  const guidanceByName = new Map(
    adapter.agents.map((agent) => [agent.name, agent.guidance] as const),
  );

  return search<string>(
    {
      message: 'Select agent to configure',
      source: async (term: string | undefined) => {
        const filtered = term
          ? names.filter((a) => a.toLowerCase().includes(term.toLowerCase()))
          : names;

        return filtered.map((name) => {
          const currentModel = currentModelLabel(config.agent?.[name as string]);
          const currentVariant = currentVariantLabel(config.agent?.[name as string]);
          const guidance = guidanceByName.get(name);
          return {
            value: name,
            name: name,
            description: buildAgentChoiceDescription(currentModel, currentVariant, guidance),
          };
        });
      },
    },
    { signal, clearPromptOnDone: true },
  );
}

export default defineCommand({
  meta: {
    name: 'setup',
    description: 'Interactively configure PAS agent models',
  },
  args: {
    target: {
      type: 'string',
      description: 'Setup target tool id (default: opencode)',
    },
  },
  async run(ctx) {
    const args = (ctx as { args?: Record<string, unknown> } | undefined)?.args ?? {};
    const explicitTarget =
      typeof args.target === 'string' && args.target.length > 0 ? args.target : undefined;

    try {
      // STEP 0: choose the tool, unless `--target` already named one. The
      // Escape controller exists only when the selection prompt can run.
      let esc: ReturnType<typeof createEscapeController> | undefined;
      let adapter: AnySetupTargetAdapter;
      try {
        // Resolve before reading config: an unsupported target must fail
        // without touching any file or starting an interaction.
        adapter = await resolveSetupAdapter({
          target: explicitTarget,
          prompts: {
            selectTarget: () => {
              esc = createEscapeController();
              return selectTargetPrompt(esc.signal);
            },
          },
        });
      } catch (err) {
        if (isAbortPromptError(err)) {
          // Escape on the target prompt exits cleanly, like outer escape.
          return;
        }
        throw err;
      } finally {
        esc?.dispose();
      }

      // Fail fast before any prompt or config read (e.g. missing `pi` binary).
      adapter.preflight?.();

      // Target-owned pre-configure step (Pi installs missing packages). It
      // runs inside the wizard, before the first prompt and any model merge.
      const prepare = adapter.prepare;

      // Read config first to detect malformed JSON before any interaction
      const config = adapter.readConfig();

      await runSetupWizard(config as Parameters<typeof runSetupWizard>[0], {
        prompts: {
          selectAgent: (config, signal) => selectAgentPrompt(config, signal, adapter),
          chooseAction: async (agentName, signal) =>
            select<Action>(
              {
                message: `What do you want to do with ${agentName}?`,
                choices: [
                  {
                    value: 'change_model',
                    name: 'Change model',
                    description: 'Set a specific model for this agent',
                  },
                  {
                    value: 'inherit_default',
                    name: 'Inherit default',
                    description: 'Remove override, use default model',
                  },
                  {
                    value: 'cancel',
                    name: 'Cancel',
                    description: 'Exit without changes',
                  },
                ],
              },
              { signal, clearPromptOnDone: true },
            ),
          searchModel: async (models, signal) =>
            search<Model>(
              {
                message: 'Search for a model',
                source: async (term: string | undefined) => {
                  const filtered = term
                    ? models.filter(
                        (m) =>
                          m.id.toLowerCase().includes(term.toLowerCase()) ||
                          m.name.toLowerCase().includes(term.toLowerCase()),
                      )
                    : models;

                  return filtered.map((m) => ({
                    value: m,
                    name: m.id,
                  }));
                },
              },
              { signal, clearPromptOnDone: true },
            ),
          chooseVariant: async (modelId, variants, signal) =>
            select<string>(
              {
                message: `Select variant for ${modelId}`,
                choices: [
                  { value: 'default', name: 'default (no variant)' },
                  ...variants.map((v) => ({ value: v, name: v })),
                ],
              },
              { signal, clearPromptOnDone: true },
            ),
          selectThinking: async (levels, signal) =>
            select<string>(
              {
                message: 'Select thinking level',
                choices: levels.map((level) => ({ value: level, name: level })),
              },
              { signal, clearPromptOnDone: true },
            ),
          inputModel: async (agentName, signal) =>
            input(
              {
                message: `Enter a model id for ${agentName}`,
              },
              { signal, clearPromptOnDone: true },
            ),
          confirmApply: async (preview, signal) =>
            confirm(
              { message: preview + '\n\n' + 'Apply this change?', default: true },
              { signal, clearPromptOnDone: true },
            ),
        },
        discoverModels: () => adapter.discoverModels(),
        populateVariantsFromModelList: () => adapter.populateVariants(),
        discoverVariants: (modelId) => adapter.discoverVariants(modelId),
        modelSupportsThinking: (model) => adapter.modelSupportsThinking?.(model) === true,
        setAgentModel: (c, agent, modelId, variant, thinking, provider) =>
          adapter.setAgentModel(
            c,
            agent,
            modelId,
            adapter.supportsThinking ? provider : variant,
            thinking,
          ),
        removeAgentOverride: (c, agent) => adapter.removeAgentOverride(c, agent),
        createBackup: () => adapter.createBackup(),
        writeConfig: (c) => adapter.writeConfig(c),
        formatOutput: (agentName, modelId, variant, thinking, provider) =>
          adapter.formatOutput(agentName, modelId, variant, thinking, provider),
        reloadHint: adapter.reloadHint,
        noModelsHint: adapter.noModelsHint,
        supportsVariants: adapter.supportsVariants,
        supportsThinking: adapter.supportsThinking === true,
        thinkingLevels: adapter.thinkingLevels ?? [],
        supportsManualModelInput: adapter.supportsManualModelInput === true,
        prepare: prepare
          ? () =>
              prepare({
                env: process.env,
                confirm: (message) =>
                  confirm({ message, default: true }, { clearPromptOnDone: true }),
              })
          : undefined,
        reloadConfig:
          prepare && adapter.prepareReloadsConfig
            ? () => adapter.readConfig() as Parameters<typeof runSetupWizard>[0]
            : undefined,
        output: (line) => console.log(line),
        isAbortPromptError,
        // Outer escape exits cleanly: no error log, no error exit code.
        onEscapeExit: () => {},
        // Wire the Escape key to per-prompt AbortSignals so the wizard
        // can react to Escape at any step (outer → exit, inner → back).
        createPromptSignal: () => {
          const esc = createEscapeController();
          return { signal: esc.signal, dispose: () => esc.dispose() };
        },
      });
    } catch (err) {
      // Outer escape is handled inside runSetupWizard; anything reaching
      // here is a genuine failure (unsupported target, malformed config,
      // missing target binary, file I/O error, unhandled exception in a
      // prompt). Preserve existing error semantics for those.
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});
