/**
 * Model discovery — query the OpenCode v2 model registry.
 *
 * Models are listed by `opencode models` (one model per line in format
 * `provider/model-id`). Reasoning variants are discovered separately from the
 * v2 registry endpoint `model.list`, invoked as
 * `opencode api --standalone model.list`, which returns
 * `{ location, data: Model.Info[] }` where each item carries `providerID`,
 * `id` (the public model id printed by `opencode models`), `modelID` (the
 * upstream model id, which can be shared by several public entries), and a
 * `variants[]` array of `{ id, ... }` entries.
 */

export type Model = {
  id: string;
  provider: string;
  name: string;
};

type ModelListResponse = {
  data?: unknown;
};

type ModelListEntry = {
  providerID?: unknown;
  id?: unknown;
  modelID?: unknown;
  variants?: unknown;
};

type VariantEntry = {
  id?: unknown;
};

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

/** Discover variants populated from the current OpenCode v2 model registry. */
export function discoverVariants(modelId: string): string[] {
  return [...(cachedVariants?.[modelId] ?? [])];
}

/**
 * In-memory cache of the last successful `opencode models` output.
 *
 * Lives for the duration of the current process / wizard run so that the
 * `pas agents setup` wizard does not shell out to `opencode models` more
 * than once per session. The cache is intentionally NOT persisted: a
 * fresh `opencode models` invocation is the source of truth for the
 * next wizard run.
 */
let cachedModels: Model[] | null = null;
let cachedVariants: Record<string, string[]> | null = null;

/**
 * Whether a v2 registry variant fetch has already been attempted this run.
 *
 * The registry is fetched from a private ephemeral server
 * (`opencode api --standalone model.list`), so the wizard attempts it at most
 * once per process. The flag is set on every outcome (success or failure): a
 * failed fetch degrades to skipping the variant step for the rest of the run
 * rather than re-spawning on every model-selection pass.
 */
let variantsAttempted = false;

/** Return a non-empty string id, or undefined for any other value. */
function usableId(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Populate the in-memory variant registry from the v2 `model.list` endpoint. */
export async function populateVariantsFromModelList(): Promise<void> {
  if (variantsAttempted) return;
  variantsAttempted = true;

  try {
    const proc = Bun.spawnSync(['opencode', 'api', '--standalone', 'model.list'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (proc.exitCode !== 0) return;

    const parsed = JSON.parse(proc.stdout.toString()) as ModelListResponse;
    if (!Array.isArray(parsed.data)) return;

    const variantsByModel: Record<string, string[]> = {};
    for (const item of parsed.data) {
      if (item === null || typeof item !== 'object') continue;
      const entry = item as ModelListEntry;

      const providerID = entry.providerID;
      if (typeof providerID !== 'string' || providerID === '') continue;

      // Key on the registry's public `id`: `opencode models` prints
      // `${providerID}/${id}`, and the wizard looks variants up with exactly
      // that string. `modelID` is the upstream model and can be shared by
      // several public entries (e.g. OpenAI's `gpt-6-luna` and
      // `gpt-6-luna-fast`), so it is only a fallback for registry shapes that
      // do not expose a usable `id`.
      const publicId = usableId(entry.id) ?? usableId(entry.modelID);
      if (publicId === undefined) continue;
      if (!Array.isArray(entry.variants)) continue;

      const ids: string[] = [];
      for (const variant of entry.variants) {
        if (variant === null || typeof variant !== 'object') continue;
        const id = (variant as VariantEntry).id;
        if (typeof id === 'string' && id !== '') ids.push(id);
      }

      // Entry only when at least one variant id; duplicates: last wins.
      if (ids.length > 0) variantsByModel[`${providerID}/${publicId}`] = ids;
    }

    // Only cache a non-empty registry (mirrors the models cache rule).
    if (Object.keys(variantsByModel).length > 0) cachedVariants = variantsByModel;
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
  variantsAttempted = false;
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
