/**
 * Build-time injection of CLI-managed `permission.skill` rules into
 * the dist agent's frontmatter.
 *
 * The runtime precedence bug (memory
 * permission-skill-precedence-bug-confirmed-20260701): the agent's
 * source frontmatter contains a top-level `*`: allow which, when
 * merged with the user's `opencode.json` at runtime, shadows per-agent
 * `permission.skill.<pattern>` rules. OpenCode resolves the
 * `permission` block as "last matching rule wins", but the source
 * frontmatter is the LAST writer, so its `*`: allow catches every
 * tool key — including `skill` — and the user's per-agent skill rules
 * never apply.
 *
 * The fix: at build time, compile the user's per-agent
 * `permission.skill` block INTO the dist frontmatter's `permission:`
 * block, placed AFTER the `*`: allow line. This makes the frontmatter
 * the single runtime source of truth, eliminates the merge ambiguity,
 * and preserves the `nas skills` CLI ergonomics — the user keeps
 * writing to `opencode.json` via `nas skills add/remove/setup`, and
 * `nas build && nas install` propagates the rules into the dist +
 * installed agent files.
 *
 * Design contract (per approved scope):
 *   - The new `skill:` key is a SIBLING of the existing `*`: allow
 *     child inside the `permission:` block, not a child of any other
 *     key.
 *   - The new `skill:` key is placed immediately AFTER the
 *     `*`: allow line (so it wins the last-match-wins resolution).
 *   - If the user's per-agent `permission.skill` block is empty or
 *     missing, no injection happens and the dist file is byte-identical
 *     to the source (no `skill:` line added).
 *   - If the source frontmatter already has a `skill:` child (not
 *     expected for canonical NAS agents, but defensive), its children
 *     are replaced with the merged rules.
 *   - Non-OpenCode platforms (no `permission:` block in the source)
 *     are NOT touched.
 *
 * The build step reads the user's `opencode.json` via the
 * `NAS_OPENCODE_CONFIG_PATH` env var when set (for testability and
 * CI reproducibility), otherwise via the default path used by
 * `readConfig()` in `config-safety.ts`.
 */

import type {
  OpenCodeConfig,
  PermissionAction,
} from './config-safety';
import { readConfig } from './config-safety';

export interface PermissionBlockBounds {
  /** 0-based line index of the `permission:` line. */
  permLine: number;
  /** 0-based line index of the first child of the block. */
  firstChildLine: number;
  /** 0-based line index of the last child of the block (inclusive). */
  lastChildLine: number;
  /** 0-based line index of the line JUST AFTER the block. */
  endLine: number;
}

/**
 * Read the per-agent `permission.skill` block from a parsed config.
 * Returns an empty object when the block is missing or empty.
 * Invalid action values are filtered out defensively.
 */
export function readAgentSkillBlock(
  config: OpenCodeConfig,
  agentName: string,
): Record<string, PermissionAction> {
  const block = config.agent?.[agentName]?.permission?.skill;
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return {};
  }
  const out: Record<string, PermissionAction> = {};
  for (const [pattern, action] of Object.entries(
    block as Record<string, unknown>,
  )) {
    if (action === 'allow' || action === 'deny' || action === 'ask') {
      out[pattern] = action;
    }
  }
  return out;
}

/**
 * Locate the `permission:` line and the bounds of its indented children.
 * Returns null if no `permission:` block is found.
 *
 * The bounds are computed by:
 *   1. Find the `permission:` line (must be at column 0).
 *   2. Walk forward collecting lines that are indented by ≥ 2 spaces
 *      OR are blank (a blank line inside the block is treated as a
 *      separator, not a block terminator).
 *   3. Stop at the first non-indented, non-blank line.
 */
export function findPermissionBlock(content: string): PermissionBlockBounds | null {
  const lines = content.split('\n');
  let permLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'permission:') {
      permLine = i;
      break;
    }
  }
  if (permLine === -1) return null;

  let firstChildLine = -1;
  let lastChildLine = -1;
  for (let i = permLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' || line.startsWith('  ') || line.startsWith('\t')) {
      if (firstChildLine === -1) firstChildLine = i;
      lastChildLine = i;
    } else {
      break;
    }
  }
  if (firstChildLine === -1) {
    // Empty permission block.
    return {
      permLine,
      firstChildLine: permLine + 1,
      lastChildLine: permLine,
      endLine: permLine + 1,
    };
  }
  return {
    permLine,
    firstChildLine,
    lastChildLine,
    endLine: lastChildLine + 1,
  };
}

/**
 * Find the `  "*": allow` line inside the permission block.
 * Returns the 0-based line index, or -1 if not present.
 */
export function findStarAllowLine(
  content: string,
  block: PermissionBlockBounds,
): number {
  const lines = content.split('\n');
  for (let i = block.firstChildLine; i <= block.lastChildLine; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('"*"') && trimmed.includes('allow')) {
      return i;
    }
  }
  return -1;
}

/**
 * Find an existing `  skill:` line inside the permission block.
 * Returns the 0-based line index, or -1 if not present.
 */
function findSkillLine(
  content: string,
  block: PermissionBlockBounds,
): number {
  const lines = content.split('\n');
  for (let i = block.firstChildLine; i <= block.lastChildLine; i++) {
    if (lines[i].trim() === 'skill:') return i;
  }
  return -1;
}

/**
 * Serialize the `permission.skill` block children. Indentation is 4
 * spaces (one level deeper than the `skill:` key).
 */
function renderSkillChildren(
  rules: Record<string, PermissionAction>,
): string[] {
  return Object.entries(rules).map(
    ([pattern, action]) => `    "${pattern}": ${action}`,
  );
}

/**
 * Insert (or replace) the `permission.skill` block in the agent's
 * frontmatter. The new `skill:` key is placed AFTER the `*`: allow
 * line (so OpenCode's "last matching rule wins" semantics make the
 * specific skill rules override the catch-all). If the source
 * frontmatter already has a `skill:` key, its children are replaced
 * in place. If `rules` is empty, the content is returned unchanged
 * (no injection).
 *
 * Indentation: 2 spaces for the `skill:` key, 4 spaces for its
 * children. The existing `*`: allow line is preserved verbatim.
 */
export function injectSkillBlock(
  content: string,
  rules: Record<string, PermissionAction>,
): string {
  if (Object.keys(rules).length === 0) return content;

  const block = findPermissionBlock(content);
  if (!block) return content;

  const lines = content.split('\n');
  const skillLine = findSkillLine(content, block);

  if (skillLine >= 0) {
    // Replace the existing skill block in place. Find the end of the
    // existing skill block (the next line that is NOT indented by ≥ 4
    // spaces, accounting for blank-line separators).
    let blockEnd = skillLine;
    for (let i = skillLine + 1; i <= block.lastChildLine; i++) {
      const line = lines[i];
      if (line === '') {
        blockEnd = i;
        continue;
      }
      if (line.startsWith('    ') || line.startsWith('\t\t')) {
        blockEnd = i;
        continue;
      }
      break;
    }
    const newChildren = renderSkillChildren(rules);
    const replacement = ['  skill:', ...newChildren];
    const before = lines.slice(0, skillLine);
    const after = lines.slice(blockEnd + 1);
    return [...before, ...replacement, ...after].join('\n');
  }

  // No existing skill block. Insert one AFTER the `*`: allow line, or
  // at the end of the permission block if no `*`: allow is present.
  const starLine = findStarAllowLine(content, block);
  const insertAt = starLine >= 0 ? starLine + 1 : block.endLine;
  const newChildren = renderSkillChildren(rules);
  const insertion = ['  skill:', ...newChildren];
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  return [...before, ...insertion, ...after].join('\n');
}

/**
 * Build-time entry point: read the user's opencode.json (or fixture),
 * pull the per-agent `permission.skill` block, and inject it into the
 * agent's dist content. Returns the content UNCHANGED when:
 *   - the user config is not parseable (return source as-is)
 *   - the agent has no `permission.skill` rules in user config
 *   - the source has no `permission:` block
 *
 * The config path is `NAS_OPENCODE_CONFIG_PATH` when set, otherwise the
 * default path used by `readConfig()`.
 */
export function injectSkillPoliciesFromConfig(
  agentName: string,
  content: string,
  configPathOverride?: string,
): string {
  const configPath = configPathOverride ?? process.env.NAS_OPENCODE_CONFIG_PATH;
  let config: OpenCodeConfig;
  try {
    config = configPath ? readConfig(configPath) : readConfig();
  } catch {
    // Malformed JSON or unreadable config: do not break the build.
    return content;
  }
  const rules = readAgentSkillBlock(config, agentName);
  return injectSkillBlock(content, rules);
}
