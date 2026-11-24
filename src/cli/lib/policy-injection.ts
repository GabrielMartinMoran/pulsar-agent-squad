import { canonicalToolIdentifier } from './tool-policies';

/**
 * Build-time injection of PAS tool denies into an agent's frontmatter.
 *
 * Two frontmatter formats are supported and never mixed:
 *
 *   - native V2 list (`permissions:` array). A deny is appended as a
 *     `- action / resource / effect` item at the end of the list, so the
 *     existing rule order and resources are preserved and the new deny wins
 *     the last-match-wins resolution.
 *   - legacy map (`permission:` mapping, the format every canonical PAS agent
 *     uses). Denies are written as scalar map children in the same map. The
 *     canonical action is translated to its documented legacy keys
 *     (`shell`→`bash`, `subagent`→`task`, `edit`→`edit`/`write`/`patch`), and
 *     an existing non-deny entry for one of those keys is replaced by a deny
 *     at the end of the block. No legacy rule is ever relaxed.
 *
 * The function only adds or tightens denies. It never removes an unrelated
 * rule, never turns a deny into allow/ask, and is byte-stable when called
 * twice with the same denies. Unknown identifiers are skipped with a warning
 * because injecting them would not make the deny effective.
 */

export type ToolInjectionWarning = (message: string) => void;

/** Canonical actions OpenCode documents and PAS can inject. */
const DOCUMENTED_ACTIONS: ReadonlySet<string> = new Set([
  'shell',
  'subagent',
  'edit',
  'read',
  'glob',
  'grep',
  'webfetch',
  'websearch',
  'question',
  'todowrite',
]);

/**
 * Legacy permission-map keys for a canonical action. Denying a canonical
 * action in a legacy file must deny every deprecated key it replaced,
 * otherwise the legacy action stays allowed.
 */
const LEGACY_KEYS: Readonly<Record<string, readonly string[]>> = {
  shell: ['bash'],
  subagent: ['task'],
  edit: ['edit', 'write', 'patch'],
};

const DEFAULT_WARNING: ToolInjectionWarning = (message) => {
  console.warn(`Warning: ${message}`);
};

interface FrontmatterBounds {
  /** 0-based index of the opening `---` line. */
  start: number;
  /** 0-based index of the closing `---` line. */
  end: number;
}

interface LegacyEntry {
  key: string;
  start: number;
  /** Exclusive end line index. */
  next: number;
  scalar: string | null;
}

interface NativeEntry {
  start: number;
  next: number;
  action: string | null;
  resource: string | null;
  effect: string | null;
}

function findFrontmatter(lines: string[]): FrontmatterBounds | null {
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return { start: 0, end: i };
  }
  return null;
}

function findTopLevelLine(
  lines: string[],
  key: string,
  bounds: FrontmatterBounds,
): number {
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    if (lines[i] === key) return i;
  }
  return -1;
}

/**
 * Last content line of an indented block, ignoring trailing blank separator
 * lines so appended rules stay next to the block instead of after the blank.
 */
function blockContentEnd(lines: string[], keyLine: number, end: number): number {
  let last = keyLine;
  for (let i = keyLine + 1; i <= end; i++) {
    const line = lines[i];
    if (i === end || (!line.startsWith(' ') && line !== '')) break;
    if (line.trim() !== '') last = i;
  }
  return last;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseLegacyEntries(
  lines: string[],
  keyLine: number,
  end: number,
): LegacyEntry[] {
  const entries: LegacyEntry[] = [];
  for (let i = keyLine + 1; i <= end; i++) {
    if (i === end) break;
    const line = lines[i];
    // A blank separator line stays inside the frontmatter block.
    if (line === '') continue;
    if (line.startsWith(' ') === false) break;
    // Direct children use exactly two spaces; deeper lines belong to the
    // previous entry.
    if (!/^ {2}\S/.test(line)) continue;

    const match = /^ {2}("([^"]*)"|'([^']*)'|([^\s:#][^:]*)):\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;

    const key = match[2] ?? match[3] ?? match[4] ?? '';
    const rawScalar = match[5] ?? '';
    const scalar = rawScalar.trim() === '' ? null : unquote(rawScalar);

    let next = i + 1;
    while (next < end) {
      const candidate = lines[next];
      if (candidate === '') {
        next++;
        continue;
      }
      if (candidate.startsWith(' ') === false) break;
      if (/^ {2}\S/.test(candidate)) break;
      next++;
    }

    entries.push({ key, start: i, next, scalar });
    i = next - 1;
  }
  return entries;
}

function parseNativeEntries(
  lines: string[],
  keyLine: number,
  end: number,
): NativeEntry[] {
  const entries: NativeEntry[] = [];
  let current: NativeEntry | null = null;

  for (let i = keyLine + 1; i <= end; i++) {
    if (i === end) break;
    const line = lines[i];
    if (line === '') continue;
    if (line.startsWith(' ') === false) break;

    if (/^ {2}- /.test(line)) {
      if (current) entries.push(current);
      const inline = /^ {2}- ([^:]+):\s*(.*)$/.exec(line);
      current = {
        start: i,
        next: i + 1,
        action: null,
        resource: null,
        effect: null,
      };
      if (inline) {
        const field = inline[1]!.trim();
        const value = unquote(inline[2] ?? '');
        if (field === 'action') current.action = value;
        if (field === 'resource') current.resource = value;
        if (field === 'effect') current.effect = value;
      }
      continue;
    }

    if (!current) continue;
    current.next = i + 1;
    const field = /^\s{2,}([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    const name = field[1]!;
    const value = unquote(field[2] ?? '');
    if (name === 'action') current.action = value;
    if (name === 'resource') current.resource = value;
    if (name === 'effect') current.effect = value;
  }
  if (current) entries.push(current);
  return entries;
}

function normalizeRequestedTools(
  tools: readonly string[],
  warn: ToolInjectionWarning,
): string[] {
  const canonical: string[] = [];
  for (const identifier of tools) {
    const { tool } = canonicalToolIdentifier(identifier);
    if (!DOCUMENTED_ACTIONS.has(tool)) {
      warn(
        `"${tool}" is not a documented OpenCode permission action; it was not injected into the agent file.`,
      );
      continue;
    }
    canonical.push(tool);
  }
  return [...new Set(canonical)].sort();
}

function injectNative(
  lines: string[],
  keyLine: number,
  end: number,
  tools: readonly string[],
): string | null {
  const entries = parseNativeEntries(lines, keyLine, end);
  const missing = tools.filter((tool) => {
    const previous = entries.filter((entry) => entry.action === tool).at(-1);
    return !(previous && previous.resource === '*' && previous.effect === 'deny');
  });
  if (missing.length === 0) return null;

  const insertion = missing.flatMap((tool) => [
    `  - action: ${tool}`,
    '    resource: "*"',
    '    effect: deny',
  ]);
  const insertAt = blockContentEnd(lines, keyLine, end) + 1;
  return [...lines.slice(0, insertAt), ...insertion, ...lines.slice(insertAt)].join(
    '\n',
  );
}

function injectLegacy(
  lines: string[],
  keyLine: number,
  end: number,
  tools: readonly string[],
): { content: string; injected: boolean } {
  const entries = parseLegacyEntries(lines, keyLine, end);
  const remove = new Set<number>();
  const appended: string[] = [];
  let injected = false;

  for (const tool of tools) {
    const keys = LEGACY_KEYS[tool] ?? [tool];
    const existing = entries.filter((entry) => keys.includes(entry.key));
    const satisfied = keys.every((key) =>
      existing.some((entry) => entry.key === key && entry.scalar === 'deny'),
    );
    if (satisfied) continue;

    injected = true;
    for (const entry of existing) {
      if (entry.scalar === 'deny') continue;
      for (let i = entry.start; i < entry.next; i++) remove.add(i);
    }
    for (const key of keys) {
      if (existing.some((entry) => entry.key === key && entry.scalar === 'deny')) {
        continue;
      }
      appended.push(`  ${key}: deny`);
    }
  }

  if (!injected) return { content: lines.join('\n'), injected: false };

  const insertAt = blockContentEnd(lines, keyLine, end) + 1;
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === insertAt) output.push(...appended);
    if (!remove.has(i)) output.push(lines[i]!);
  }
  return { content: output.join('\n'), injected: true };
}

/**
 * Inject the given deny-only actions into `content`. Returns the content
 * unchanged when there is no frontmatter, no matching format, or every deny
 * is already present.
 */
export function injectToolDenies(
  content: string,
  tools: readonly string[],
  warn: ToolInjectionWarning = DEFAULT_WARNING,
): string {
  if (tools.length === 0) return content;

  const requested = normalizeRequestedTools(tools, warn);
  if (requested.length === 0) return content;

  const lines = content.split('\n');
  const bounds = findFrontmatter(lines);
  if (!bounds) return content;

  const nativeLine = findTopLevelLine(lines, 'permissions:', bounds);
  if (nativeLine >= 0) {
    return (
      injectNative(lines, nativeLine, bounds.end, requested) ?? content
    );
  }

  const legacyLine = findTopLevelLine(lines, 'permission:', bounds);
  if (legacyLine < 0) return content;

  const result = injectLegacy(lines, legacyLine, bounds.end, requested);
  if (result.injected) {
    warn(
      'agent file uses a V1 permission block; injected tool denies in the existing legacy permission map format.',
    );
  }
  return result.content;
}
