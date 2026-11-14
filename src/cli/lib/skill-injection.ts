/**
 * Compile CLI-managed per-agent skill rules into built OpenCode agents.
 *
 * The `pas skills` commands still read and write the legacy
 * `agent.<name>.permission.skill` config shape. This build step also reads
 * native V2 `agents.<name>.permissions` rules, then emits skill entries in
 * each source agent's V2 `permissions` list. Appending them preserves
 * OpenCode's last-matching-rule-wins behavior after broad wildcard rules.
 *
 * Build and install propagate the configured rules into the dist and
 * installed OpenCode agent files.
 *
 * If the user's per-agent skill block is empty or missing, the dist file
 * remains byte-identical to the source. Legacy V1 agent frontmatter remains
 * supported during migration; non-OpenCode targets have no OpenCode
 * permissions block and are copied without modification.
 *
 * The build step reads the user's `opencode.json` via the
 * `PAS_OPENCODE_CONFIG_PATH` env var when set (for testability and
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

/** Bounds of the native V2 `permissions` YAML list in an agent frontmatter. */
export interface PermissionsBlockBounds {
  /** Zero-based line index of the top-level `permissions:` key. */
  permissionsLine: number;
  /** First child line, or the line immediately after `permissions:` if empty. */
  firstChildLine: number;
  /** Last child line, inclusive. */
  lastChildLine: number;
  /** Line immediately after the permissions block. */
  endLine: number;
}

/** Locate the native V2 top-level `permissions:` list in agent frontmatter. */
export function findPermissionsBlock(content: string): PermissionsBlockBounds | null {
  const lines = content.split('\n');
  const permissionsLine = lines.findIndex((line) => line === 'permissions:');
  if (permissionsLine === -1) return null;

  let firstChildLine = -1;
  let lastChildLine = -1;
  for (let i = permissionsLine + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === '' || line.startsWith('  ') || line.startsWith('\t')) {
      if (firstChildLine === -1) firstChildLine = i;
      lastChildLine = i;
    } else {
      break;
    }
  }

  if (firstChildLine === -1) {
    return {
      permissionsLine,
      firstChildLine: permissionsLine + 1,
      lastChildLine: permissionsLine,
      endLine: permissionsLine + 1,
    };
  }

  return {
    permissionsLine,
    firstChildLine,
    lastChildLine,
    endLine: lastChildLine + 1,
  };
}

function yamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function renderV2SkillRules(
  rules: Record<string, PermissionAction>,
): string[] {
  return Object.entries(rules).flatMap(([resource, effect]) => [
    '  - action: skill',
    `    resource: ${JSON.stringify(resource)}`,
    `    effect: ${effect}`,
  ]);
}

/**
 * Replace source skill entries with configured rules in native V2 format.
 * Rules are appended after all other permission entries, preserving
 * last-match-wins behavior. Returns the input unchanged when the source has no
 * V2 permissions list or when there are no rules to inject.
 */
export function injectSkillRules(
  content: string,
  rules: Record<string, PermissionAction>,
): string {
  if (Object.keys(rules).length === 0) return content;

  const block = findPermissionsBlock(content);
  if (!block) return content;

  const lines = content.split('\n');
  const retained: string[] = [];
  let cursor = block.firstChildLine;

  while (cursor <= block.lastChildLine) {
    const actionMatch = /^  - action:\s*(.*?)\s*$/.exec(lines[cursor]!);
    if (!actionMatch) {
      retained.push(lines[cursor]!);
      cursor++;
      continue;
    }

    const itemStart = cursor;
    cursor++;
    while (
      cursor <= block.lastChildLine &&
      !/^  - action:\s*/.test(lines[cursor]!)
    ) {
      cursor++;
    }

    if (yamlScalar(actionMatch[1]!) !== 'skill') {
      retained.push(...lines.slice(itemStart, cursor));
    }
  }

  return [
    ...lines.slice(0, block.firstChildLine),
    ...retained,
    ...renderV2SkillRules(rules),
    ...lines.slice(block.endLine),
  ].join('\n');
}

/**
 * Read per-agent skill rules from legacy V1 or native V2 config.
 * If both forms contain the same pattern, the V2 rule takes precedence.
 */
export function readAgentSkillBlock(
  config: OpenCodeConfig,
  agentName: string,
): Record<string, PermissionAction> {
  const out: Record<string, PermissionAction> = {};

  const legacyBlock = config.agent?.[agentName]?.permission?.skill;
  if (legacyBlock && typeof legacyBlock === 'object' && !Array.isArray(legacyBlock)) {
    for (const [pattern, action] of Object.entries(legacyBlock)) {
      if (action === 'allow' || action === 'deny' || action === 'ask') {
        out[pattern] = action;
      }
    }
  }

  const nativeRules = config.agents?.[agentName]?.permissions;
  if (Array.isArray(nativeRules)) {
    for (const rule of nativeRules) {
      if (
        rule.action === 'skill' &&
        typeof rule.resource === 'string' &&
        (rule.effect === 'allow' || rule.effect === 'deny' || rule.effect === 'ask')
      ) {
        out[rule.resource] = rule.effect;
      }
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
 *
 * Matches both the nested-mapping form (`  skill:`) and the scalar form
 * (`  skill: allow|deny|ask`). Only direct children of the `permission:`
 * block are considered (exactly two spaces of indentation), so a nested
 * `skill:` deeper inside another mapping is never picked up.
 */
function findSkillLine(
  content: string,
  block: PermissionBlockBounds,
): number {
  const lines = content.split('\n');
  for (let i = block.firstChildLine; i <= block.lastChildLine; i++) {
    if (/^ {2}skill:\s*(\S.*)?$/.test(lines[i])) return i;
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
 * Insert (or replace) the legacy V1 `permission.skill` block in the agent's
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
 * pull its per-agent skill rules, and inject them into the agent's dist
 * content using V2 frontmatter when present, with V1 support during migration.
 * Returns the content UNCHANGED when:
 *   - the user config is not parseable (return source as-is)
 *   - the agent has no `permission.skill` rules in user config
 *   - the source has no supported OpenCode permissions block
 *
 * The config path is `PAS_OPENCODE_CONFIG_PATH` when set, otherwise the
 * default path used by `readConfig()`.
 */
export function injectSkillPoliciesFromConfig(
  agentName: string,
  content: string,
  configPathOverride?: string,
): string {
  const configPath = configPathOverride ?? process.env.PAS_OPENCODE_CONFIG_PATH;
  let config: OpenCodeConfig;
  try {
    config = configPath ? readConfig(configPath) : readConfig();
  } catch {
    // Malformed JSON or unreadable config: do not break the build.
    return content;
  }
  const rules = readAgentSkillBlock(config, agentName);
  if (findPermissionsBlock(content)) {
    return injectSkillRules(content, rules);
  }
  return injectSkillBlock(content, rules);
}
