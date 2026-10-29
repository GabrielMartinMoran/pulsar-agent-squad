/**
 * Setup target seam for `pas agents setup`.
 *
 * The wizard logic (`../setup-core`) and the CLI wiring (`../setup`) talk to a
 * `SetupTargetAdapter` instead of importing tool modules directly. Each
 * adapter owns the target-specific pieces: config path and persistence, the
 * agent roster and its guidance, model/variant/thinking discovery, the preview
 * format, preflight checks, and the closing reload hint.
 *
 * The contract is data and behavior only. Prompt objects and terminal I/O
 * stay in the CLI wiring so adapters remain easy to test.
 */

import type { OpenCodeConfig } from '../../../lib/config-safety';
import type { Model } from '../../../lib/model-discovery';
import { opencodeAdapter } from './opencode';
import { piAdapter } from './pi';

/** One configurable agent in a target's roster. */
export interface SetupAgent {
  readonly name: string;
  /** Human-readable model-capability guidance, when the target has one. */
  readonly guidance?: string;
}

/**
 * Context passed to a target's optional pre-configure step. Adapters only
 * need the prompt confirm callback and, for testability, an isolated spawn
 * environment; prompt objects stay in the CLI wiring.
 */
export interface SetupPrepareContext {
  /** Isolated environment for the target binary; omitted inherits the process env. */
  env?: Record<string, string | undefined>;
  /** Reuse of the setup confirm prompt, injected by the CLI wiring. */
  confirm?: (message: string) => Promise<boolean>;
}

/** Everything the setup wizard needs from a target tool. */
export interface SetupTargetAdapter<C = OpenCodeConfig> {
  /** Stable id used by `--target=<id>`. */
  readonly id: string;
  /** Human-readable target name. */
  readonly label: string;
  /** Configurable agents in display order. */
  readonly agents: readonly SetupAgent[];
  /** Closing message after a successful write. */
  readonly reloadHint: string;
  /** Message when model discovery returns nothing. */
  readonly noModelsHint: string;
  /** Whether the variant step applies to this target. */
  readonly supportsVariants: boolean;
  /** Whether the thinking-level step applies to this target. */
  readonly supportsThinking?: boolean;
  /** Thinking levels offered when the chosen model supports thinking. */
  readonly thinkingLevels?: readonly string[];
  /** Whether model discovery falls back to manual model entry. */
  readonly supportsManualModelInput?: boolean;

  /**
   * Fail-fast checks run before the first config read. Must throw a clear
   * error when the target cannot be configured at all.
   */
  preflight?(env?: Record<string, string | undefined>): void;
  /**
   * Optional target pre-configure step (for example, installing missing Pi
   * packages). Runs after preflight, before the first wizard prompt and before
   * any model merge. Returns a summary block to print.
   */
  prepare?(context?: SetupPrepareContext): Promise<string | undefined>;
  /**
   * Whether `prepare` may rewrite the config file. When true the wizard
   * re-reads the config through `readConfig()` before merging.
   */
  readonly prepareReloadsConfig?: boolean;
  /** Read and parse the target config; fail fast on malformed input. */
  readConfig(): C;
  /** Persist the config. Adapters own backup semantics. */
  writeConfig(config: C): void;
  /** Create a timestamped backup and return its path (may be a no-op). */
  createBackup(): string;
  /**
   * Set an agent model override.
   *
   * `variantOrProvider` carries the run variant for targets that have
   * variants (OpenCode) or the provider for targets that split model and
   * provider (Pi). `thinking` is only honoured by thinking-capable targets.
   */
  setAgentModel(
    config: C,
    agent: string,
    model: string,
    variantOrProvider?: string,
    thinking?: string,
  ): C;
  /** Remove an agent model override so it inherits the default. */
  removeAgentOverride(config: C, agent: string): C;
  /** Discover available models. */
  discoverModels(env?: Record<string, string | undefined>): Promise<Model[]>;
  /** Whether a discovered model reports thinking support. */
  modelSupportsThinking?(model: Model): boolean;
  /** Populate any variant registry the target exposes. May be a no-op. */
  populateVariants(): Promise<void>;
  /** Discover variants for a model id. */
  discoverVariants(modelId: string): string[];
  /**
   * Render the confirmation preview.
   *
   * `provider` is supplied by targets that keep model and provider separate
   * (Pi). Targets that ignore it may ignore the extra arguments.
   */
  formatOutput(
    agentName: string,
    modelId?: string,
    variant?: string,
    thinking?: string,
    provider?: string,
  ): string;
}

/** Erased adapter type used by the registry (each keeps its own config type). */
export type AnySetupTargetAdapter = SetupTargetAdapter<any>;

/**
 * Registered setup adapters, keyed by target id. Only tools with an adapter
 * are offered; file-copy-only manifest targets are not registered here.
 */
const SETUP_TARGETS: Readonly<Record<string, AnySetupTargetAdapter>> = {
  [opencodeAdapter.id]: opencodeAdapter,
  [piAdapter.id]: piAdapter,
};

/** Resolve a registered adapter, or `undefined` for an unsupported id. */
export function getSetupTarget(id: string): AnySetupTargetAdapter | undefined {
  return SETUP_TARGETS[id];
}

/** List the ids that have a setup adapter, sorted for stable messages. */
export function supportedTargetIds(): string[] {
  return Object.keys(SETUP_TARGETS).sort();
}

/** Resolve an adapter or throw the unsupported-target error. */
export function resolveSetupTarget(id: string): AnySetupTargetAdapter {
  const adapter = getSetupTarget(id);
  if (!adapter) {
    throw new Error(unsupportedTargetMessage(id));
  }
  return adapter;
}

/** Exact error text for an unsupported `--target` value. */
export function unsupportedTargetMessage(id: string): string {
  return `Unsupported target "${id}". Supported targets: ${supportedTargetIds().join(', ')}.`;
}
