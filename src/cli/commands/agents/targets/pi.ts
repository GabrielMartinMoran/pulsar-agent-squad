/**
 * Pi setup target adapter.
 *
 * Delegates persistence to `./pi-settings` (which owns read/merge/backup/write
 * of `~/.pi/agent/settings.json`) and model discovery to the fixed-width
 * `pi --list-models` parser. Pi keeps provider and model as separate fields,
 * so the adapter writes `subagents.agentOverrides.<agent>` with `model`,
 * `defaultProvider` and an optional `thinking` level.
 *
 * Pi exposes no model variants; reasoning effort is expressed as `thinking`.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawnSync } from 'bun';
import type { Model } from '../../../lib/model-discovery';
import { parsePiModelList } from '../../../lib/pi-model-list';
import {
  barePackageName,
  installPiPackage,
  isVersionAtLeast,
  missingPackages,
  parsePiInstalledPackages,
  parsePiVersion,
  piAvailable,
  piSpawnOptions,
  type PiSpawnEnv,
} from '../../../lib/pi-plugins';
import { readPiPackages } from '../../../lib/pi-packages';
import type { SetupAgent, SetupPrepareContext, SetupTargetAdapter } from './adapter';
import {
  defaultPiSettingsPath,
  piAgentDirExists,
  readPiSettings,
  removeAgentOverride as removePiAgentOverride,
  setAgentOverride,
  writePiSettings,
  type PiAgentOverride,
  type PiSettings,
} from './pi-settings';

/**
 * Pi's configurable subagents. Pi's leads are skills, not subagents, so they
 * are not offered as model targets. All three workers are light-model agents.
 */
export const PI_AGENTS: readonly SetupAgent[] = [
  { name: 'pas_researcher', guidance: 'lighter model sufficient' },
  { name: 'pas_developer', guidance: 'lighter model sufficient' },
  { name: 'pas_qa', guidance: 'lighter model sufficient' },
];

/** Thinking levels Pi documents, in ascending order. */
export const PI_THINKING_LEVELS: readonly string[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Discovered Pi model: `id` is the model id, `name` mirrors it for display. */
interface PiDiscoveredModel extends Model {
  thinking?: boolean;
}

function resolveHome(): string {
  // Prefer HOME so tests can point the adapter at a temporary home. Fall back
  // to the OS home when it is not set (matching os.homedir()).
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function piSettingsPath(): string {
  return defaultPiSettingsPath(resolveHome());
}

/** Read the installed package specs from `pi list`; `null` when it fails. */
function readInstalledPackages(env?: PiSpawnEnv): string[] | null {
  try {
    const result = spawnSync(['pi', 'list'], piSpawnOptions(env));
    if (result.exitCode !== 0) return null;
    return parsePiInstalledPackages(result.stdout.toString());
  } catch {
    return null;
  }
}

/** Read `pi --version` text; `null` when it cannot be read. */
function readPiVersionText(env?: PiSpawnEnv): string | null {
  try {
    const result = spawnSync(['pi', '--version'], piSpawnOptions(env));
    if (result.exitCode !== 0) return null;
    return result.stdout.toString().trim();
  } catch {
    return null;
  }
}

/** Options for the Pi pre-configure (plugin) step. */
export type PiPrepareOptions = SetupPrepareContext;

/** Pre-configure hook: install missing configured packages, never remove. */
export type PiPrepare = (options?: PiPrepareOptions) => Promise<string | undefined>;

const PI_SUBAGENTS = 'pi-subagents';
const PI_SUBAGENTS_MIN_VERSION: readonly [number, number, number] = [1, 2, 0];

/**
 * Compare the configured Pi packages against `pi list` and offer to install
 * the missing ones, in configured order. Never removes packages. When
 * `pi-subagents` is missing and Pi is older than 1.2.0 it is skipped with a
 * warning while the remaining packages still install. Returns a summary for
 * the wizard to print.
 */
async function preparePiPackages(options: PiPrepareOptions = {}): Promise<string | undefined> {
  const configured = readPiPackages();
  const installed = readInstalledPackages(options.env);

  if (installed === null) {
    return 'Could not read installed Pi packages (`pi list` failed). Skipping package installation.';
  }

  const missing = missingPackages(configured, installed);
  if (missing.length === 0) {
    return 'All configured Pi packages are installed.';
  }

  const lines = ['Missing Pi packages:', ...missing.map((source) => `  - ${source}`)];
  const message = [...lines, '', 'Install missing Pi packages now?'].join('\n');
  const approved = options.confirm ? await options.confirm(message) : false;

  if (!approved) {
    lines.push('Skipped installing missing Pi packages.');
    return lines.join('\n');
  }

  const versionText = readPiVersionText(options.env);
  const version = versionText === null ? null : parsePiVersion(versionText);
  const installedNames = new Set(installed.flatMap((entry) => [entry, barePackageName(entry)]));

  for (const source of missing) {
    // Defensive: an earlier install in this same run may already cover it.
    if (installedNames.has(source) || installedNames.has(barePackageName(source))) {
      continue;
    }

    if (
      barePackageName(source) === PI_SUBAGENTS &&
      !isVersionAtLeast(version, PI_SUBAGENTS_MIN_VERSION)
    ) {
      lines.push(
        `Warning: ${source} requires Pi >= ${PI_SUBAGENTS_MIN_VERSION.join('.')} ` +
          `(found ${versionText ?? 'unknown'}). Skipping it.`,
      );
      continue;
    }

    installPiPackage(source, options.env, (line) => lines.push(line));
    installedNames.add(source);
    installedNames.add(barePackageName(source));
  }

  return lines.join('\n');
}

function assertAgentDir(): void {
  if (!piAgentDirExists(resolveHome())) {
    throw new Error(
      `Pi agent directory not found at ${join(resolveHome(), '.pi', 'agent')}. ` +
        'Run `pas install --target=pi` first.',
    );
  }
}

/** Preview one Pi override. Provider and thinking fall back to `default`. */
export function formatPiOutput(
  agentName: string,
  modelId?: string,
  _variant?: string,
  thinking?: string,
  provider?: string,
): string {
  return [
    `Agent: ${agentName}`,
    `Model: ${modelId ?? 'default'}`,
    `Provider: ${provider && provider.length > 0 ? provider : 'default'}`,
    `Thinking: ${thinking && thinking.length > 0 ? thinking : 'default'}`,
  ].join('\n');
}

export const piAdapter: SetupTargetAdapter<PiSettings> = {
  id: 'pi',
  label: 'Pi',
  agents: PI_AGENTS,
  reloadHint: 'Run /reload in Pi for changes to take effect.',
  noModelsHint:
    'No models were reported by `pi --list-models`. Enter a model id manually, ' +
    'or run `pas install --target=pi` first.',
  supportsVariants: false,
  supportsThinking: true,
  thinkingLevels: PI_THINKING_LEVELS,
  supportsManualModelInput: true,

  prepare: preparePiPackages,
  prepareReloadsConfig: true,

  preflight(env?: Record<string, string | undefined>): void {
    if (!piAvailable(env)) {
      throw new Error(
        'Pi binary not found on PATH. Install Pi, then run `pas install --target=pi`.',
      );
    }

    const marker = join(resolveHome(), '.pi', 'agent', 'agents', 'pas_researcher.md');
    if (!existsSync(marker)) {
      console.warn(
        'Warning: Pi agent artifacts are not installed. Run `pas install --target=pi` to install them.',
      );
    }
  },

  readConfig(): PiSettings {
    assertAgentDir();
    return readPiSettings(piSettingsPath());
  },

  writeConfig(config: PiSettings): void {
    assertAgentDir();
    writePiSettings(piSettingsPath(), config, { backup: true });
  },

  // Pi's writer backs up the previous bytes itself when the content changes.
  createBackup(): string {
    return '';
  },

  setAgentModel(
    config: PiSettings,
    agent: string,
    model: string,
    provider?: string,
    thinking?: string,
  ): PiSettings {
    const override: PiAgentOverride = { model };
    if (provider && provider.length > 0) override.defaultProvider = provider;
    if (thinking && thinking.length > 0) override.thinking = thinking;
    return setAgentOverride(config, agent, override);
  },

  removeAgentOverride(config: PiSettings, agent: string): PiSettings {
    return removePiAgentOverride(config, agent);
  },

  async discoverModels(env?: Record<string, string | undefined>): Promise<Model[]> {
    try {
      const result = spawnSync(['pi', '--list-models'], piSpawnOptions(env));
      if (result.exitCode !== 0) return [];

      return parsePiModelList(result.stdout.toString()).map((row): PiDiscoveredModel => ({
        id: row.model,
        provider: row.provider,
        name: row.model,
        thinking: row.thinking,
      }));
    } catch {
      return [];
    }
  },

  modelSupportsThinking(model: Model): boolean {
    return (model as PiDiscoveredModel).thinking === true;
  },

  async populateVariants(): Promise<void> {
    // Pi has no variants; thinking replaces them.
  },

  discoverVariants(): string[] {
    return [];
  },

  formatOutput(
    agentName: string,
    modelId?: string,
    variant?: string,
    thinking?: string,
    provider?: string,
  ): string {
    return formatPiOutput(agentName, modelId, variant, thinking, provider);
  },
};
