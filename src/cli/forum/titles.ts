/**
 * OpenCode session titles for the forum rail.
 *
 * Titles are an optional label, never a dependency: one CLI spawn is attempted
 * with a hard budget, its result (or failure) is cached briefly, and a caller
 * is always answered within the deadline. Nothing here throws for a missing
 * binary, a non-zero exit, invalid JSON or a slow runner.
 */

/** Hard budget for one `opencode session list` spawn and one caller wait. */
export const TITLE_DEADLINE_MS = 2_500;
/** How long a resolution, including a failure, is reused. */
export const TITLE_CACHE_TTL_MS = 30_000;
/** The exact listing the resolver runs; `cwd` scopes it to one project. */
export const TITLE_COMMAND: readonly string[] = [
  'opencode',
  'session',
  'list',
  '--format',
  'json',
  '--max-count',
  '500',
];

export interface TitleCommandOptions {
  cwd: string;
  timeoutMs: number;
}

export interface TitleCommandOutcome {
  exitCode: number | null;
  stdout: string;
}

/** Injectable so tests never depend on the real CLI or a network. */
export type TitleRunner = (
  command: readonly string[],
  options: TitleCommandOptions,
) => TitleCommandOutcome | Promise<TitleCommandOutcome>;

export interface TitleResolverOptions {
  /** Served workspace; the CLI runs here so it lists this project only. */
  workspace: string;
  runner?: TitleRunner;
  deadlineMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface TitleResolver {
  /** Never rejects; resolves to an empty map when titles are unavailable. */
  resolve(): Promise<ReadonlyMap<string, string>>;
  /** Synchronous view of the fresh cache, for diagnostics and tests. */
  cached(): ReadonlyMap<string, string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runOpencodeCommand(
  command: readonly string[],
  options: TitleCommandOptions,
): TitleCommandOutcome {
  const proc = Bun.spawnSync([...command], {
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: options.timeoutMs,
    killSignal: 'SIGKILL',
  });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
}

/**
 * Accepts only the documented shape: a JSON array of `{id, title}` entries.
 * A non-zero exit, a parse failure or a foreign shape yields no titles.
 */
function parseTitles(outcome: TitleCommandOutcome): Map<string, string> {
  const titles = new Map<string, string>();
  if (outcome.exitCode !== 0) return titles;

  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.stdout);
  } catch {
    return titles;
  }
  if (!Array.isArray(parsed)) return titles;

  for (const item of parsed) {
    if (!isObject(item)) continue;
    const id = item.id;
    const title = item.title;
    if (typeof id !== 'string' || id.length === 0 || typeof title !== 'string') continue;
    const trimmed = title.trim();
    if (trimmed.length === 0) continue;
    titles.set(id, trimmed);
  }

  return titles;
}

/**
 * Builds the per-server title resolver. One attempt is shared by concurrent
 * requests; a result or failure lives for the TTL; a caller that reaches the
 * deadline is answered from the cache (empty when cold) while the attempt keeps
 * running, so a late result still benefits the next request.
 */
export function createTitleResolver(options: TitleResolverOptions): TitleResolver {
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? TITLE_DEADLINE_MS;
  const cacheTtlMs = options.cacheTtlMs ?? TITLE_CACHE_TTL_MS;
  const runner = options.runner ?? runOpencodeCommand;

  let cache: { titles: Map<string, string>; expiresAt: number } | undefined;
  let inflight: Promise<Map<string, string>> | undefined;

  const freshTitles = (): Map<string, string> | undefined => {
    if (cache === undefined || now() >= cache.expiresAt) return undefined;
    return cache.titles;
  };

  const store = (titles: Map<string, string>): void => {
    cache = { titles, expiresAt: now() + cacheTtlMs };
  };

  const attempt = async (): Promise<Map<string, string>> => {
    try {
      const outcome = await runner(TITLE_COMMAND, {
        cwd: options.workspace,
        timeoutMs: deadlineMs,
      });
      const titles = parseTitles(outcome);
      store(titles);
      return titles;
    } catch {
      const empty = new Map<string, string>();
      store(empty);
      return empty;
    } finally {
      inflight = undefined;
    }
  };

  return {
    cached(): ReadonlyMap<string, string> {
      return freshTitles() ?? new Map();
    },
    async resolve(): Promise<ReadonlyMap<string, string>> {
      const cached = freshTitles();
      if (cached) return cached;

      if (inflight === undefined) inflight = attempt();
      const pending = inflight;

      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<null>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(null), deadlineMs);
      });

      try {
        const settled = await Promise.race([pending, deadline]);
        if (settled !== null) return settled;

        // The deadline fired first: answer with fallback labels now and leave
        // the attempt running so its late result can populate the cache.
        const fallback = freshTitles();
        if (fallback) return fallback;
        store(new Map());
        return cache!.titles;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
