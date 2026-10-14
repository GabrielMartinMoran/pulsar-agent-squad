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
 * thin I/O wiring (real prompts, real config helpers, console output).
 */

import { defineCommand } from 'citty';
import search from '@inquirer/search';
import select from '@inquirer/select';
import confirm from '@inquirer/confirm';
import {
  readConfig,
  createBackup,
  setAgentModel,
  removeAgentOverride,
  writeConfig,
} from '../../lib/config-safety';
import {
  discoverModels,
  discoverVariants,
  populateVariantsFromModelList,
  type Model,
} from '../../lib/model-discovery';
import {
  PAS_AGENTS as PRESENTER_PAS_AGENTS,
  getModelGuidance as presenterGetModelGuidance,
  getModelGuidanceLabel as presenterGetModelGuidanceLabel,
} from './presenter';
import { runSetupWizard, isAbortPromptError } from './setup-core';
import { createEscapeController } from '../../lib/prompt-escape';

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
 * Format a human-friendly summary line for an agent's model configuration.
 * Shows "default" when no model override is set. Used by the setup wizard
 * preview only — the list surface uses the richer card view from
 * `./presenter`.
 */
export function formatAgentOutput(
  agentName: string,
  modelId: string | undefined,
  variant?: string,
): string {
  const lines: string[] = [];
  lines.push(`Agent: ${agentName}`);
  lines.push(`Model: ${modelId ?? 'default'}`);
  lines.push(`Variant: ${variant && variant !== 'default' ? variant : 'default'}`);
  return lines.join('\n');
}

/**
 * Build a search prompt for an agent list, with the agent's current
 * model and capability guidance shown in the description. Shared by
 * the outer select_agent step and any future inner re-selection.
 */
async function selectAgentPrompt(
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  return search<string>(
    {
      message: 'Select agent to configure',
      source: async (term: string | undefined) => {
        const filtered = term
          ? PAS_AGENTS.filter((a) => a.toLowerCase().includes(term.toLowerCase()))
          : PAS_AGENTS;

        return filtered.map((name) => {
          const currentModel = currentModelLabel(config.agent?.[name as string]);
          const currentVariant = currentVariantLabel(config.agent?.[name as string]);
          const guidance = presenterGetModelGuidanceLabel(name);
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
  async run() {
    try {
      // Read config first to detect malformed JSON before any interaction
      const config = readConfig();

      await runSetupWizard(config as Parameters<typeof runSetupWizard>[0], {
        prompts: {
          selectAgent: selectAgentPrompt,
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
          confirmApply: async (preview, signal) =>
            confirm(
              { message: preview + '\n\n' + 'Apply this change?', default: true },
              { signal, clearPromptOnDone: true },
            ),
        },
        discoverModels,
        populateVariantsFromModelList,
        discoverVariants,
        setAgentModel: (c, agent, model, variant) => setAgentModel(c, agent, model, variant),
        removeAgentOverride,
        createBackup,
        writeConfig,
        formatOutput: formatAgentOutput,
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
      // here is a genuine failure (malformed config, file I/O error,
      // unhandled exception in a prompt). Preserve existing error
      // semantics for those.
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});
