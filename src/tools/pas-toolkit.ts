/**
 * PAS toolkit: single-file OpenCode V2 plugin exposing the `pas_toolkit` tool.
 *
 * Harness operations (`init`, `list`, `check`, `new`, `archive`)
 * over the numbered `NNNNN-slug` feature directories described by the `state:`
 * block of `.pas/pas.config.yaml`.
 *
 * Design constraints: no external dependencies (node builtins only), no
 * `@opencode/plugin` import (types are structural locals), and `execute` never
 * throws — failures become `ERROR:` text. Every tool result ends with a
 * `Workspace: <path>` line.
 *
 * The pure logic is exported as named functions for unit testing; OpenCode
 * only consumes the default export.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export const TOOL_NAME = 'pas_toolkit';

export const TOOL_DESCRIPTION =
  'PAS harness toolkit: initialize project config and manage numbered state (init, list, check, new, archive). For PAS harness agents only.';

export const TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    operation: { enum: ['init', 'list', 'check', 'new', 'archive'] },
    project: { type: 'string' },
    confirm: { type: 'boolean' },
    slug: { type: 'string' },
    feature: { type: 'string' },
    root: { type: 'string' },
  },
  required: ['operation'],
  additionalProperties: false,
} as const;

const CONFIG_RELATIVE_PATH = join('.pas', 'pas.config.yaml');
const DEFAULT_ACTIVE_PATH = '.pas/state/active';
const DEFAULT_ARCHIVED_PATH = '.pas/state/archived';
const DEFAULT_MAX_ACTIVE = 1;
const DEFAULT_WIDTH = 5;
const DEFAULT_START = 1;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TERMINAL_STATUSES = ['completed', 'complete', 'done', 'cancelled', 'archived'];
const ARCHIVE_LIST_LIMIT = 5;
const CLEANUP_GUIDE =
  'Guide: surface any violations to the user and offer a cleanup; run cleanup only as separately authorized work.';

export interface StateConfig {
  activePath: string;
  archivedPath: string;
  maxActive: number;
  width: number;
  start: number;
}

export interface ConfigLoad {
  config: StateConfig;
  present: boolean;
  sourcePath: string;
}

export interface FeatureEntry {
  name: string;
  id: number;
  idText: string;
  slug: string;
  path: string;
}

export interface UnexpectedEntry {
  name: string;
  path: string;
  reason: string;
}

export interface StateScan {
  features: FeatureEntry[];
  unexpected: UnexpectedEntry[];
}

export type ViolationKind =
  | 'missing-config'
  | 'unexpected-entry'
  | 'missing-state'
  | 'duplicate-id'
  | 'cardinality'
  | 'terminal-in-active';

export interface Violation {
  kind: ViolationKind;
  path: string;
  message: string;
}

export interface StateCheck {
  ok: boolean;
  violations: Violation[];
}

export interface OperationResult {
  ok: boolean;
  text: string;
}

export interface ToolkitInput {
  operation: string;
  project?: string;
  confirm?: boolean;
  slug?: string;
  feature?: string;
  root?: string;
}

/**
 * Portable PAS configuration template. The example file in
 * src/templates/pas.config.example.yaml must match
 * renderProjectConfig('example-project') (enforced by a unit test).
 * Keep the template inside this single-file plugin so it is available
 * after installation into any OpenCode workspace.
 */
export function renderProjectConfig(project: string): string {
  return [
    '# PAS project configuration — edit to fit this repository',
    'version: "0.1"',
    `product: ${project}`,
    '',
    'runtime:',
    '  primary: opencode',
    '',
    'state:',
    '  root: ".pas/state"',
    '  active_path: ".pas/state/active"',
    '  archived_path: ".pas/state/archived"',
    '  max_active: 1',
    '  numbering:',
    '    start: 1',
    '    width: 5',
    '    source: archived',
    '',
    '# Mind is optional; disable it if not installed.',
    'memory:',
    '  enabled: true',
    '  provider: mind',
    '  required: false',
    '',
    'mind_spaces:',
    '  project_space:',
    '    enabled: true',
    `    name: "projects/${project}"`,
    '    description: "Project context, decisions, architecture, and checkpoints"',
    '',
    'gherkin:',
    '  enabled: true',
    '  storage_path: "specs/features"',
    '  format: gherkin',
    '  filename_namespace: global',
    '  persist_to_repo:',
    '    when: "on_done"',
    '    format: "merged"',
    '  include:',
    '    - "product/*"',
    '    - "application/*"',
    '  exclude:',
    '    - "researcher/*"',
    '    - "sandbox/*"',
    '',
    'sdd:',
    '  enabled: true',
    '  change_memory:',
    '    auto_create: true',
    '  delta:',
    '    removal_policy: "remove"',
    '    resolve_on: "on_done"',
    '  memory_tracking: true',
    '',
    'config_policy:',
    '  require_confirmation: true',
    '',
    'models:',
    '  lead: strong',
    '  researcher: light',
    '  developer: light',
    '  qa: light',
    '',
  ].join('\n') + '\n';
}

export function initProjectConfig(
  root: string,
  options: { project?: string; confirm?: boolean } = {},
): OperationResult {
  const workspace = resolve(root);
  const configPath = join(workspace, CONFIG_RELATIVE_PATH);

  if (existsSync(configPath)) {
    return blocked(`config already exists (${configPath}); refusing to overwrite it`);
  }

  const inferred = basename(workspace).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const project = options.project ?? inferred;
  if (typeof project !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(project)) {
    return blocked('invalid project; provide a lowercase kebab-case slug of 1–64 characters');
  }
  const config = renderProjectConfig(project);

  if (options.confirm !== true) {
    return {
      ok: true,
      text: [
        `Preview PAS config for ${project} (NO FILES WRITTEN):`,
        `Destination: ${configPath}`,
        '',
        config,
        'Ask the user for explicit approval of this config and destination.',
        'Only after approval, call pas_toolkit init with confirm: true.',
      ].join('\n'),
    };
  }

  try {
    mkdirSync(join(workspace, '.pas'), { recursive: true });
    writeFileSync(configPath, config, { flag: 'wx' });
  } catch (error) {
    return blocked(`could not initialize config (never overwrites): ${describeError(error)}`);
  }
  return {
    ok: true,
    text: `Created PAS project config: ${configPath} (product: ${project}). Review optional Mind settings before proceeding.`,
  };
}

export function defaultStateConfig(): StateConfig {
  return {
    activePath: DEFAULT_ACTIVE_PATH,
    archivedPath: DEFAULT_ARCHIVED_PATH,
    maxActive: DEFAULT_MAX_ACTIVE,
    width: DEFAULT_WIDTH,
    start: DEFAULT_START,
  };
}

interface IndentedLine {
  indent: number;
  text: string;
}

function stripComment(line: string): string {
  const commentStart = line.indexOf('#');
  return commentStart === -1 ? line : line.slice(0, commentStart);
}

function unquote(value: string): string {
  const text = value.trim();
  const quoted =
    (text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"));
  return quoted ? text.slice(1, -1) : text;
}

function parseInteger(value: string, fallback: number, minimum: number): number {
  const text = unquote(value);
  if (!/^\d+$/.test(text)) return fallback;
  const parsed = Number.parseInt(text, 10);
  return parsed >= minimum ? parsed : fallback;
}

function stateBlockLines(document: string): IndentedLine[] {
  const lines: IndentedLine[] = [];
  let inBlock = false;
  for (const rawLine of document.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    const text = line.trim();
    if (text === '') continue;
    const indent = line.length - line.trimStart().length;
    if (!inBlock) {
      if (indent === 0 && text === 'state:') inBlock = true;
      continue;
    }
    if (indent === 0) break;
    lines.push({ indent, text });
  }
  return lines;
}

function applyStateEntries(lines: IndentedLine[], config: StateConfig): void {
  let inNumbering = false;
  let numberingIndent = 0;
  let archivedPathPrimary = false;
  for (const { indent, text } of lines) {
    const entry = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(text);
    if (!entry) continue;
    const key = entry[1];
    const value = entry[2].trim();

    if (inNumbering && indent > numberingIndent) {
      if (key === 'width') config.width = parseInteger(value, config.width, 1);
      if (key === 'start') config.start = parseInteger(value, config.start, 0);
      continue;
    }
    inNumbering = false;

    if (key === 'numbering' && value === '') {
      inNumbering = true;
      numberingIndent = indent;
      continue;
    }
    if (key === 'active_path' && value !== '') {
      config.activePath = unquote(value);
      continue;
    }
    if (key === 'archived_path' && value !== '') {
      config.archivedPath = unquote(value);
      archivedPathPrimary = true;
      continue;
    }
    if (key === 'archive_path' && value !== '' && !archivedPathPrimary) {
      config.archivedPath = unquote(value);
      continue;
    }
    if (key === 'max_active') {
      config.maxActive = parseInteger(value, config.maxActive, 1);
    }
  }
}

export function parseStateConfig(document: string): StateConfig {
  const config = defaultStateConfig();
  applyStateEntries(stateBlockLines(document), config);
  return config;
}

export function loadStateConfig(root: string): ConfigLoad {
  const sourcePath = join(resolve(root), CONFIG_RELATIVE_PATH);
  try {
    const document = readFileSync(sourcePath, 'utf-8');
    return { config: parseStateConfig(document), present: true, sourcePath };
  } catch {
    return { config: defaultStateConfig(), present: false, sourcePath };
  }
}

export function parseFeatureName(
  name: string,
  width: number,
): { id: number; idText: string; slug: string } | null {
  const digits = Math.max(1, width);
  const pattern = new RegExp(`^(\\d{${digits}})-([a-z0-9][a-z0-9-]*)$`);
  const match = pattern.exec(name);
  if (!match) return null;
  return { id: Number.parseInt(match[1], 10), idText: match[1], slug: match[2] };
}

export function scanStateDir(dir: string, width: number): StateScan {
  const features: FeatureEntry[] = [];
  const unexpected: UnexpectedEntry[] = [];
  if (!existsSync(dir)) return { features, unexpected };

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
    const path = join(dir, entry.name);
    const parsed = parseFeatureName(entry.name, width);
    if (!parsed) {
      unexpected.push({ name: entry.name, path, reason: 'does not match NNNNN-slug' });
      continue;
    }
    if (!entry.isDirectory()) {
      unexpected.push({ name: entry.name, path, reason: 'not a directory' });
      continue;
    }
    features.push({ name: entry.name, path, ...parsed });
  }

  features.sort((left, right) => left.id - right.id || left.name.localeCompare(right.name));
  unexpected.sort((left, right) => left.name.localeCompare(right.name));
  return { features, unexpected };
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function normalizeStatus(raw: string): string | null {
  const cleaned = raw
    .split('#')[0]
    .replace(/[*_`"']/g, '')
    .trim()
    .toLowerCase();
  const word = (cleaned.split(/\s+/)[0] ?? '').replace(/[.,;:]+$/, '');
  return word === '' ? null : word;
}

function extractStatus(document: string | null): string | null {
  if (document === null) return null;
  const match = /^\s*(?:[-*]\s*)?status\s*:\s*(.+?)\s*$/im.exec(document);
  return match ? normalizeStatus(match[1]) : null;
}

export function readFeatureStatus(featureDir: string): string | null {
  const fromMarkdown = extractStatus(readTextFile(join(featureDir, 'state.md')));
  if (fromMarkdown) return fromMarkdown;

  const yamlFiles = readdirSafe(featureDir)
    .filter((name) => name.endsWith('.yaml'))
    .sort();
  for (const file of yamlFiles) {
    const status = extractStatus(readTextFile(join(featureDir, file)));
    if (status) return status;
  }
  return null;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function hasStateFile(featureDir: string): boolean {
  if (existsSync(join(featureDir, 'state.md'))) return true;
  return readdirSafe(featureDir).some((name) => name.endsWith('.yaml'));
}

function resolveStatePaths(root: string, config: StateConfig): { activeDir: string; archivedDir: string } {
  return {
    activeDir: resolve(root, config.activePath),
    archivedDir: resolve(root, config.archivedPath),
  };
}

function formatStatus(path: string): string {
  return readFeatureStatus(path) ?? 'unknown';
}

export function listState(root: string, loaded: ConfigLoad = loadStateConfig(root)): string {
  const { config, present, sourcePath } = loaded;
  const paths = resolveStatePaths(root, config);
  const active = scanStateDir(paths.activeDir, config.width);
  const archived = scanStateDir(paths.archivedDir, config.width);
  const lines: string[] = [];

  if (!present) lines.push(`Config: unreadable (${sourcePath}); using defaults`);
  lines.push(
    `State: active=${config.activePath} archive=${config.archivedPath} max_active=${config.maxActive}`,
  );

  lines.push(`Active (${active.features.length}/${config.maxActive}):`);
  if (active.features.length === 0) lines.push('(none)');
  for (const feature of active.features) {
    lines.push(`- ${feature.name} [${formatStatus(feature.path)}]`);
  }

  lines.push(`Archive (${archived.features.length}):`);
  if (archived.features.length === 0) lines.push('(none)');
  for (const feature of archived.features.slice(0, ARCHIVE_LIST_LIMIT)) {
    lines.push(`- ${feature.name} [${formatStatus(feature.path)}]`);
  }
  const hidden = archived.features.length - ARCHIVE_LIST_LIMIT;
  if (hidden > 0) lines.push(`(+${hidden} more)`);

  return lines.join('\n');
}

export function allocateNextId(ids: number[], start: number): number {
  const maxId = ids.length === 0 ? 0 : Math.max(...ids);
  return Math.max(start, maxId + 1);
}

function duplicateViolations(features: FeatureEntry[]): Violation[] {
  const violations: Violation[] = [];
  const seen = new Map<number, FeatureEntry>();
  for (const feature of features) {
    const first = seen.get(feature.id);
    if (first) {
      violations.push({
        kind: 'duplicate-id',
        path: feature.path,
        message: `id ${feature.idText} is already used by ${first.path}`,
      });
    } else {
      seen.set(feature.id, feature);
    }
  }
  return violations;
}

function mutationBlockReason(active: StateScan, archived: StateScan): string | null {
  const malformed = [...active.unexpected, ...archived.unexpected].map((entry) => entry.path);
  if (malformed.length > 0) {
    return `malformed state entries present (${malformed.join(', ')}); run check first`;
  }

  const duplicates = duplicateViolations([...active.features, ...archived.features]);
  if (duplicates.length > 0) {
    const paths = duplicates.map((violation) => violation.path).join(', ');
    return `duplicate feature ids present (${paths}); run check first`;
  }
  return null;
}

export function checkState(root: string, loaded: ConfigLoad = loadStateConfig(root)): StateCheck {
  const { config, present, sourcePath } = loaded;
  const paths = resolveStatePaths(root, config);
  const active = scanStateDir(paths.activeDir, config.width);
  const archived = scanStateDir(paths.archivedDir, config.width);
  const violations: Violation[] = [];

  if (!present) {
    violations.push({
      kind: 'missing-config',
      path: sourcePath,
      message: 'config is missing or unreadable; state mutations are blocked',
    });
  }

  for (const entry of [...active.unexpected, ...archived.unexpected]) {
    violations.push({ kind: 'unexpected-entry', path: entry.path, message: entry.reason });
  }

  const allFeatures = [...active.features, ...archived.features];
  for (const feature of allFeatures) {
    if (!hasStateFile(feature.path)) {
      violations.push({
        kind: 'missing-state',
        path: feature.path,
        message: 'no state.md or *.yaml state file',
      });
    }
  }

  violations.push(...duplicateViolations(allFeatures));

  if (active.features.length > config.maxActive) {
    violations.push({
      kind: 'cardinality',
      path: paths.activeDir,
      message: `active holds ${active.features.length} features; max_active is ${config.maxActive}`,
    });
  }

  for (const feature of active.features) {
    const status = readFeatureStatus(feature.path);
    if (status && TERMINAL_STATUSES.includes(status)) {
      violations.push({
        kind: 'terminal-in-active',
        path: feature.path,
        message: `status "${status}" is terminal; archive this feature`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

export function renderCheck(check: StateCheck): string {
  const lines = [`ok: ${check.ok}`, `violations: ${check.violations.length}`];
  for (const violation of check.violations) {
    lines.push(`- [${violation.kind}] ${violation.path}: ${violation.message}`);
  }
  lines.push(CLEANUP_GUIDE);
  return lines.join('\n');
}

function blocked(message: string): OperationResult {
  return { ok: false, text: `Blocked: ${message}` };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function padId(id: number, width: number): string {
  return String(id).padStart(width, '0');
}

function renderFeatureSkeleton(input: { idText: string; slug: string; created: string }): string {
  return [
    '# Feature state',
    '',
    `- Feature ID: ${input.idText}`,
    `- Slug: ${input.slug}`,
    '- Status: active',
    `- Created: ${input.created}`,
    '',
  ].join('\n');
}

export function createFeatureState(
  root: string,
  slug: string,
  options: { loaded?: ConfigLoad; now?: Date } = {},
): OperationResult {
  const loaded = options.loaded ?? loadStateConfig(root);
  if (!loaded.present) {
    return blocked(`state config missing or unreadable (${loaded.sourcePath}); mutations are blocked`);
  }
  if (!SLUG_PATTERN.test(slug)) {
    return blocked(`invalid slug "${slug}" (expected ^[a-z0-9][a-z0-9-]*$)`);
  }

  const { config } = loaded;
  const paths = resolveStatePaths(root, config);
  const active = scanStateDir(paths.activeDir, config.width);
  const archived = scanStateDir(paths.archivedDir, config.width);
  const allFeatures = [...active.features, ...archived.features];

  const blocker = mutationBlockReason(active, archived);
  if (blocker) return blocked(blocker);

  const ids = allFeatures.map((feature) => feature.id);
  const nextId = allocateNextId(ids, config.start);
  const idText = padId(nextId, config.width);
  if (idText.length > config.width) {
    return blocked(`next id ${nextId} does not fit numbering width ${config.width}`);
  }

  const name = `${idText}-${slug}`;
  const featureDir = join(paths.activeDir, name);
  if (existsSync(featureDir)) {
    return blocked(`feature directory already exists: ${featureDir}`);
  }

  const statePath = join(featureDir, 'state.md');
  const created = (options.now ?? new Date()).toISOString().slice(0, 10);
  try {
    mkdirSync(paths.activeDir, { recursive: true });
    mkdirSync(featureDir);
    writeFileSync(statePath, renderFeatureSkeleton({ idText, slug, created }), { flag: 'wx' });
  } catch (error) {
    return blocked(`could not create feature: ${describeError(error)}`);
  }

  return {
    ok: true,
    text: [`Created ${name}`, `Path: ${featureDir}`, `State file: ${statePath}`].join('\n'),
  };
}

function resolveActiveFeature(
  features: FeatureEntry[],
  width: number,
  reference: string,
): { feature: FeatureEntry } | { error: string } {
  const exact = features.find((feature) => feature.name === reference);
  if (exact) return { feature: exact };

  if (parseFeatureName(reference, width)) {
    return { error: `feature "${reference}" not found in active` };
  }

  if (/^\d+$/.test(reference)) {
    const matches = features.filter((feature) => feature.idText === reference);
    if (matches.length === 0) return { error: `feature "${reference}" not found in active` };
    if (matches.length > 1) {
      return {
        error: `reference "${reference}" is ambiguous: ${matches.map((match) => match.name).join(', ')}`,
      };
    }
    return { feature: matches[0] };
  }

  return { error: `invalid feature reference "${reference}"; expected NNNNN-slug or NNNNN` };
}

export function archiveFeatureState(
  root: string,
  feature: string,
  options: { loaded?: ConfigLoad } = {},
): OperationResult {
  const loaded = options.loaded ?? loadStateConfig(root);
  if (!loaded.present) {
    return blocked(`state config missing or unreadable (${loaded.sourcePath}); mutations are blocked`);
  }

  const reference = typeof feature === 'string' ? feature.trim() : '';
  if (reference === '') {
    return blocked('missing feature reference; expected NNNNN-slug or NNNNN');
  }

  const { config } = loaded;
  const paths = resolveStatePaths(root, config);
  const active = scanStateDir(paths.activeDir, config.width);
  const archived = scanStateDir(paths.archivedDir, config.width);

  const resolved = resolveActiveFeature(active.features, config.width, reference);
  if ('error' in resolved) return blocked(resolved.error);
  const target = resolved.feature;

  const destination = join(paths.archivedDir, target.name);
  if (existsSync(destination)) {
    return blocked(`destination already exists in archive: ${destination}`);
  }
  const idConflict = archived.features.find((candidate) => candidate.id === target.id);
  if (idConflict) {
    return blocked(`id ${target.idText} already present in archive as ${idConflict.name}`);
  }

  try {
    mkdirSync(paths.archivedDir, { recursive: true });
    renameSync(target.path, destination);
  } catch (error) {
    return blocked(`could not move feature: ${describeError(error)}`);
  }

  return {
    ok: true,
    text: [`Archived ${target.name}`, `From: ${target.path}`, `To: ${destination}`].join('\n'),
  };
}

export function runToolkitOperation(input: ToolkitInput, workspace: string): string {
  switch (input.operation) {
    case 'init':
      return initProjectConfig(workspace, { project: input.project, confirm: input.confirm }).text;
    case 'list':
      return listState(workspace);
    case 'check':
      return renderCheck(checkState(workspace));
    case 'new':
      return createFeatureState(workspace, input.slug ?? '').text;
    case 'archive':
      return archiveFeatureState(workspace, input.feature ?? '').text;
    default:
      throw new Error(`unknown operation "${String(input.operation)}"`);
  }
}

interface ToolExecuteResult {
  content: string;
}

function resolveWorkspace(root: unknown, defaultDirectory: string): string {
  if (typeof root === 'string' && root.trim() !== '') return resolve(root.trim());
  return resolve(defaultDirectory);
}

function createToolExecute(defaultDirectory: string) {
  return async function executeToolkit(input: unknown): Promise<ToolExecuteResult> {
    let workspace = resolve(defaultDirectory);
    try {
      workspace = resolveWorkspace((input as ToolkitInput | undefined)?.root, defaultDirectory);
      const content = runToolkitOperation(input as ToolkitInput, workspace);
      return { content: `${content}\nWorkspace: ${workspace}` };
    } catch (error) {
      return { content: `ERROR: ${describeError(error)}\nWorkspace: ${workspace}` };
    }
  };
}

interface RegisteredTool {
  name: string;
  description: string;
  input: typeof TOOL_INPUT_SCHEMA;
  execute: (input: unknown, context?: unknown) => Promise<ToolExecuteResult>;
}

interface PluginContext {
  location?: { directory?: string };
  tool: {
    transform(callback: (editor: { add(tool: RegisteredTool): void }) => void): unknown;
  };
}

export default {
  id: 'pas-toolkit',
  async setup(ctx: PluginContext): Promise<void> {
    const locationDirectory = ctx.location?.directory;
    const defaultDirectory =
      typeof locationDirectory === 'string' && locationDirectory.trim() !== '' ? locationDirectory : process.cwd();
    const execute = createToolExecute(defaultDirectory);
    await ctx.tool.transform((editor) => {
      editor.add({
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        input: TOOL_INPUT_SCHEMA,
        execute,
      });
    });
  },
};
