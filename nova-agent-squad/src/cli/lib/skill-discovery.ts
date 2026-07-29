/**
 * Skill discovery helper.
 *
 * Wraps the `opencode debug skill` command, which lists every skill that
 * OpenCode currently resolves (from the user's `~/.config/opencode/`,
 * `$XDG_CONFIG_HOME`, project-local `.opencode/skills/`, etc.).
 *
 * Per the approved contract:
 *   - this is the *only* source of truth for "what skills are available"
 *     in the CLI's UX
 *   - we do NOT invent a matcher and we do NOT maintain a parallel
 *     registry — `opencode debug skill` is the registry
 *   - the wrapper is intentionally injectable so the CLI command can
 *     pass a mock during tests
 */

import { spawnSync } from 'child_process';

export interface OpencodeDebugSkillEntry {
  name: string;
  description?: string;
  location?: string;
  [key: string]: unknown;
}

export interface DiscoverSkillsOptions {
  /** Override the binary path (for tests). Defaults to `opencode`. */
  opencodePath?: string;
  /** Inject a custom runner (for tests). Defaults to `spawnSync` on opencode. */
  runner?: () => string;
  /** Treat this output as the JSON payload (for tests). */
  stub?: string;
  /** Max time to wait for the opencode process (ms). */
  timeoutMs?: number;
}

export class SkillDiscoveryError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string,
    public readonly exitCode?: number,
  ) {
    super(message);
    this.name = 'SkillDiscoveryError';
  }
}

/**
 * Parse the JSON payload emitted by `opencode debug skill`. The payload is
 * a JSON array of `{ name, description, location, content }` objects.
 * We extract the `name` field of each entry (deduplicated, stable order).
 *
 * The parser is intentionally lenient: bad entries are skipped, not
 * thrown on, so a partial skill registry can still be inspected.
 */
export function parseOpencodeDebugSkill(payload: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    throw new SkillDiscoveryError(
      `Failed to parse "opencode debug skill" output as JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new SkillDiscoveryError(
      'Expected "opencode debug skill" output to be a JSON array.',
    );
  }
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of parsed) {
    if (entry && typeof entry === 'object' && 'name' in entry) {
      const name = (entry as { name: unknown }).name;
      if (typeof name === 'string' && name.length > 0 && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * Run `opencode debug skill` and return the deduplicated list of skill
 * names currently visible to OpenCode.
 */
export function listAvailableSkills(options: DiscoverSkillsOptions = {}): string[] {
  if (options.stub !== undefined) {
    return parseOpencodeDebugSkill(options.stub);
  }
  const bin = options.opencodePath ?? 'opencode';
  if (options.runner) {
    return parseOpencodeDebugSkill(options.runner());
  }
  const result = spawnSync(bin, ['debug', 'skill'], {
    encoding: 'utf-8',
    timeout: options.timeoutMs ?? 15000,
  });
  if (result.error) {
    throw new SkillDiscoveryError(
      `Failed to spawn "${bin} debug skill": ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new SkillDiscoveryError(
      `"${bin} debug skill" exited with code ${result.status}.`,
      result.stderr ?? '',
      result.status ?? -1,
    );
  }
  return parseOpencodeDebugSkill(result.stdout ?? '');
}
