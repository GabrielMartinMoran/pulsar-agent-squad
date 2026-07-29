/**
 * Model discovery — execute `opencode models` and parse the output.
 *
 * Output is one model per line in format: provider/model-id
 * Example: opencode/deepseek-v4-pro → { id: "opencode/deepseek-v4-pro", provider: "opencode", name: "deepseek-v4-pro" }
 */

export type Model = {
  id: string;
  provider: string;
  name: string;
};

type VerboseModel = {
  variants?: unknown;
};

type ParserState = 'IDLE' | 'IN_JSON';

const MODEL_ID_PATTERN = /^[^\s{}"]+\/[^\s{}"]+$/;

function variantNames(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.filter((variant): variant is string => typeof variant === 'string');
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value);
  }
  return null;
}

function braceDelta(line: string): number {
  let delta = 0;
  let isInString = false;
  let isEscaped = false;

  for (const character of line) {
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (character === '\\' && isInString) {
      isEscaped = true;
      continue;
    }
    if (character === '"') {
      isInString = !isInString;
      continue;
    }
    if (!isInString && character === '{') delta += 1;
    if (!isInString && character === '}') delta -= 1;
  }

  return delta;
}

function addParsedVariants(
  variantsByModel: Record<string, string[]>,
  modelId: string,
  json: string,
): void {
  try {
    const model = JSON.parse(json) as VerboseModel;
    const variants = variantNames(model.variants);
    if (variants !== null) variantsByModel[modelId] = variants;
  } catch {
    // A malformed model block is ignored. Later balanced blocks remain parseable.
  }
}

/** Parse model-id + pretty-printed JSON blocks from `opencode models --verbose`. */
export function parseVerboseModelsOutput(output: string): Record<string, string[]> {
  const variantsByModel: Record<string, string[]> = {};
  let state: ParserState = 'IDLE';
  let pendingModelId: string | null = null;
  let activeModelId = '';
  let jsonLines: string[] = [];
  let braceDepth = 0;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();

    if (state === 'IDLE') {
      if (!line) continue;
      if (MODEL_ID_PATTERN.test(line)) {
        pendingModelId = line;
        continue;
      }
      if (!pendingModelId || !line.startsWith('{')) {
        pendingModelId = null;
        continue;
      }

      state = 'IN_JSON';
      activeModelId = pendingModelId;
      pendingModelId = null;
      jsonLines = [rawLine];
      braceDepth = braceDelta(rawLine);
    } else {
      jsonLines.push(rawLine);
      braceDepth += braceDelta(rawLine);
    }

    if (state === 'IN_JSON' && braceDepth <= 0) {
      addParsedVariants(variantsByModel, activeModelId, jsonLines.join('\n'));
      state = 'IDLE';
      activeModelId = '';
      jsonLines = [];
      braceDepth = 0;
    }
  }

  return variantsByModel;
}

/**
 * Parse a single model line into a Model object.
 * Returns null for empty lines, whitespace-only lines, or lines without a slash.
 */
export function parseModelLine(line: string): Model | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex < 0) return null;

  const provider = trimmed.slice(0, slashIndex);
  const name = trimmed.slice(slashIndex + 1);

  if (!provider || !name) return null;

  return {
    id: trimmed,
    provider,
    name,
  };
}

/** Discover variants populated from the current verbose OpenCode model registry. */
export function discoverVariants(modelId: string): string[] {
  return [...(cachedVariants?.[modelId] ?? [])];
}

/**
 * In-memory cache of the last successful `opencode models` output.
 *
 * Lives for the duration of the current process / wizard run so that the
 * `nas agents setup` wizard does not shell out to `opencode models` more
 * than once per session. The cache is intentionally NOT persisted: a
 * fresh `opencode models` invocation is the source of truth for the
 * next wizard run.
 */
let cachedModels: Model[] | null = null;
let cachedVariants: Record<string, string[]> | null = null;

/** Populate the in-memory variant registry from `opencode models --verbose`. */
export async function populateVariantsFromVerbose(): Promise<void> {
  if (cachedVariants !== null) return;

  try {
    const proc = Bun.spawnSync(['opencode', 'models', '--verbose'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (proc.exitCode !== 0) return;

    const parsed = parseVerboseModelsOutput(proc.stdout.toString());
    if (Object.keys(parsed).length > 0) cachedVariants = parsed;
  } catch {
    // Variant discovery is optional. The wizard safely skips this step on failure.
  }
}

/**
 * Clear the in-memory models cache.
 *
 * Intended for tests that need a fresh `opencode models` invocation
 * between cases. Production code should not need to call this: the
 * cache is naturally scoped to the wizard run / process lifetime.
 */
export function resetModelsCache(): void {
  cachedModels = null;
  cachedVariants = null;
}

/**
 * Discover available models by running `opencode models`.
 * Returns parsed Model[] on success, empty array on failure.
 *
 * The result of a successful invocation is cached in-memory so that
 * subsequent calls within the same process return the cached list
 * without re-invoking `opencode models`. Failed invocations are NOT
 * cached — callers may want to retry once the underlying issue is
 * resolved.
 */
export async function discoverModels(): Promise<Model[]> {
  if (cachedModels !== null) {
    return cachedModels;
  }

  try {
    const proc = Bun.spawnSync(['opencode', 'models'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (proc.exitCode !== 0) {
      console.warn(`opencode models exited with code ${proc.exitCode}: ${proc.stderr.toString()}`);
      return [];
    }

    const output = proc.stdout.toString();
    const lines = output.split('\n');

    const models: Model[] = [];
    for (const line of lines) {
      const parsed = parseModelLine(line);
      if (parsed) models.push(parsed);
    }

    // Only cache non-empty results: an `opencode models` invocation that
    // exits cleanly but returns no parseable models (e.g. transient empty
    // stdout, configured providers with no models) must not poison the
    // cache. The next read in the same run must re-invoke `opencode
    // models` so the wizard can recover when the underlying issue clears.
    if (models.length > 0) {
      cachedModels = models;
    }
    return models;
  } catch (err) {
    console.warn('Failed to discover models:', err instanceof Error ? err.message : String(err));
    return [];
  }
}
