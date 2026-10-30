/**
 * OpenCode setup target adapter.
 *
 * Delegates persistence to `src/cli/lib/config-safety.ts` and model/variant
 * discovery to `src/cli/lib/model-discovery.ts`, preserving the existing
 * `pas agents setup` behavior exactly. The roster and guidance strings are
 * reused from the shared presenter so there is a single source of truth.
 */

import type { OpenCodeConfig } from '../../../lib/config-safety';
import {
  readConfig,
  writeConfig,
  createBackup,
  setAgentModel,
  removeAgentOverride,
} from '../../../lib/config-safety';
import type { Model } from '../../../lib/model-discovery';
import {
  discoverModels,
  discoverVariants,
  populateVariantsFromModelList,
} from '../../../lib/model-discovery';
import { PAS_AGENTS, getModelGuidanceLabel } from '../presenter';
import type { SetupAgent, SetupTargetAdapter } from './adapter';

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

/** OpenCode roster with the same per-agent guidance used by the presenter. */
const OPENCODE_AGENTS: readonly SetupAgent[] = PAS_AGENTS.map((name) => ({
  name,
  guidance: getModelGuidanceLabel(name),
}));

export const opencodeAdapter: SetupTargetAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  agents: OPENCODE_AGENTS,
  reloadHint: 'Restart OpenCode for changes to take effect.',
  noModelsHint: 'No models discovered. Is opencode installed and working?',
  supportsVariants: true,
  supportsThinking: false,
  supportsManualModelInput: false,

  readConfig(): OpenCodeConfig {
    return readConfig();
  },

  writeConfig(config: OpenCodeConfig): void {
    writeConfig(config);
  },

  createBackup(): string {
    return createBackup();
  },

  setAgentModel(
    config: OpenCodeConfig,
    agent: string,
    model: string,
    variant?: string,
    _thinking?: string,
  ): OpenCodeConfig {
    return setAgentModel(config, agent, model, variant);
  },

  removeAgentOverride(config: OpenCodeConfig, agent: string): OpenCodeConfig {
    return removeAgentOverride(config, agent);
  },

  discoverModels(): Promise<Model[]> {
    return discoverModels();
  },

  populateVariants(): Promise<void> {
    return populateVariantsFromModelList();
  },

  discoverVariants(modelId: string): string[] {
    return discoverVariants(modelId);
  },

  formatOutput(agentName: string, modelId?: string, variant?: string): string {
    return formatAgentOutput(agentName, modelId, variant);
  },
};
