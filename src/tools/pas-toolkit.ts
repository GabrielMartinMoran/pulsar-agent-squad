/**
 * PAS toolkit: OpenCode V2 plugin exposing PAS state and pairing-room tools.
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

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

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

/**
 * Pairing-room protocol: one JSON file per room under `.pas/rooms/`.
 *
 * Writes are serialized with an exclusive `.lock` file so concurrent tool
 * calls cannot lose messages, and every file is replaced atomically through a
 * temporary file plus `renameSync`. The store is pure filesystem logic; role
 * resolution and transport live in the plugin layer.
 */
export const MAX_DISCUSSION_MESSAGES = 32;
const ROOMS_RELATIVE_PATH = join('.pas', 'rooms');
const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 5000;
const INBOX_POLL_MS = 250;
const INBOX_MAX_WAIT_S = 60;
export const INBOX_DEFAULT_WAIT_S = 10;
const ACTIVITY_FRESH_MS = 120_000;
const SESSION_READ_TIMEOUT_MS = 1_000;
const SESSION_STOP_TIMEOUT_MS = 5_000;
const END_DEFAULT_WAIT_S = 30;
const END_MAX_WAIT_S = 60;
const ACK_POLL_MS = 100;
const ROOM_MESSAGE_TYPES = ['open', 'reply', 'challenge', 'propose_close', 'ready_for_final_audit', 'reopen', 'ack'] as const;

const EVIDENCE_STAGES = ['red', 'green', 'refactor', 'verification', 'manual', 'suite'] as const;
const FINDING_CATEGORIES = ['process', 'evidence', 'quality', 'cruft', 'skill', 'ui', 'test', 'scope'] as const;
const FINDING_SEVERITIES = ['blocking', 'major', 'minor', 'info'] as const;
const ESCALATION_ACTIONS = ['re_delegate', 'fix_brief', 'escalate_to_user'] as const;

/** Distinct reviewed implementation revisions with blocking findings per unit. */
export const MAX_CORRECTION_ROUNDS = 3;

export type RoomRole = 'host' | 'driver' | 'peer';
export type RoomStatus = 'open' | 'awaiting_ack' | 'closed' | 'aborted';
export type UnitStatus = 'open' | 'closed';
export type RoomMessageKind = 'discussion' | 'evidence' | 'audit';
export type RoomMessageType = (typeof ROOM_MESSAGE_TYPES)[number];
export type EvidenceStage = (typeof EVIDENCE_STAGES)[number];
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export type EscalationAction = (typeof ESCALATION_ACTIONS)[number];

export interface RoomFinding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  detail: string;
  resolved?: boolean;
  overridden_by?: string;
}

export interface RoomEscalation {
  action: EscalationAction;
  reason: string;
  unit?: string;
  evidence?: string;
  raised_by: RoomRole;
  sessionID: string;
  created_at: string;
}

export interface RoomReconcileSubmission {
  sessionID: string;
  files: string[];
  submitted_at: string;
}

export interface RoomReconciliation {
  submissions: Partial<Record<'driver' | 'peer', RoomReconcileSubmission>>;
  reconciled: boolean;
  files?: string[];
  discrepancies?: { only_driver: string[]; only_peer: string[] };
}

export interface RoomEvidence {
  stage: EvidenceStage;
  command: string;
  exit_code: number;
  output_excerpt: string;
  actor?: string;
}

export interface RoomMember {
  sessionID: string;
  role: RoomRole;
}

type PairRole = 'driver' | 'peer';
type ParticipantAvailability = 'active' | 'finished' | 'unavailable';
interface ParticipantActivity {
  sessionID: string;
  availability: ParticipantAvailability;
  availability_at: number;
  availability_source?: 'declared' | 'host' | 'runtime' | 'killswitch';
  joined_at?: number;
  state: 'working' | 'waiting_for_response';
  waiting_for?: string;
  unit?: string;
  updated_at: number;
}

interface ParticipantStopResult {
  sessionID?: string;
  status: 'pending' | 'interrupted' | 'already_finished' | 'failed' | 'timeout' | 'not_joined';
  detail?: string;
}

export interface RoomUnit {
  id: string;
  status: UnitStatus;
  opened_at: string;
  opened_by: RoomRole;
  closed_at?: string;
  resolution?: string;
  dissent?: string;
  correction_rounds?: number;
  blocking_findings?: number;
}

export interface RoomMessage {
  id: string;
  seq: number;
  role: RoomRole;
  sessionID: string;
  to: string;
  unit: string;
  type: RoomMessageType | string;
  kind: RoomMessageKind;
  body: string;
  reply_to?: string;
  evidence?: RoomEvidence;
  findings?: RoomFinding[];
  command?: string;
  exit_code?: number;
  output_excerpt?: string;
  reviewed_evidence_seq?: number;
  reviewed_revision_seq?: number;
  resolved_findings?: string[];
  note?: string;
  created_at: string;
  read_by: RoomRole[];
}

export interface Room {
  id: string;
  status: RoomStatus;
  generation?: number;
  goal: string;
  scope: string[];
  authorized_paths: string[];
  created_at: string;
  members: RoomMember[];
  retired_sessions?: string[];
  units: Record<string, RoomUnit>;
  messages: RoomMessage[];
  next_seq: number;
  awaiting_ack_since?: string;
  ack_deadline_at?: string;
  aborted_at?: string;
  abort_reason?: string;
  escalation?: RoomEscalation;
  reconciliation?: RoomReconciliation;
  final_review?: { ready_seq: number; ready_at: string };
  activities?: Partial<Record<PairRole, ParticipantActivity>>;
  mutual_wait?: { key: string; action_owner: PairRole; notified: RoomRole[] };
  stop?: { id: string; generation: number; requested_at: number; reason: string; target: PairRole | 'both'; results: Partial<Record<PairRole, ParticipantStopResult>> };
  forum?: PairForum;
}

type ForumCategory = 'comment' | 'question' | 'answer' | 'ready_for_review' | 'approved' | 'changes_requested' | 'clarification_needed' | 'escalation_candidate' | 'candidate_resolved' | 'escalate' | 'escalation_resolved' | 'final_approved';
interface ForumTopic { id: string; title: string; scenarios: string[]; paths?: string[]; status: 'open' | 'ready' | 'approved'; revision: number; fingerprint?: string; }
interface ForumPost { id: string; seq: number; topic: string; category: ForumCategory; message: string; role: RoomRole; revision: number; reply_to?: string; evidence?: { command: string; exit_code: number; output: string }; }
interface PairForum { topics: ForumTopic[]; posts: ForumPost[]; requests: Record<string, { sessionID: string; hash: string; post_ids: string[] }>; reads?: { sessionID: string; topic: string; seq: number }[]; baseline?: Record<string, string>; final_requested?: boolean; final_fingerprint?: string; }
interface ForumTopicInput { id: string; title: string; scenarios: string[]; paths?: string[]; }
interface ForumPostInput { topic: string; category: ForumCategory; message: string; reply_to?: string; revision?: number; evidence?: { command: string; exit_code: number; output: string }; }

export interface RoomSessionApi {
  get(input: { sessionID: string }, options?: { signal?: AbortSignal }): Promise<{
    id: string; parentID?: string; outcome?: string; time?: { idle?: number; busy?: number };
  }>;
  interrupt?(input: { sessionID: string; resume: false }, options?: { signal?: AbortSignal }): Promise<{ interrupted: boolean }>;
}

export interface RoomOpenInput {
  goal: string;
  scope: string[];
  authorized_paths: string[];
}

export interface RoomSendInput {
  to: string;
  unit: string;
  type: string;
  body: string;
  reply_to?: string;
  kind?: RoomMessageKind;
}

export interface RoomInboxInput {
  unit?: string;
  wait_s?: number;
  cursor?: string;
  waiting_for?: string;
}

export interface RoomUpdateResult {
  messages: RoomMessage[];
  updates: RoomMessage[];
  state: Room;
  cursor: string;
  changed: boolean;
  timed_out: boolean;
  notice?: 'MUTUAL_WAIT' | 'PEER_UNAVAILABLE';
  action_owner?: PairRole;
}

interface RoomWaitTiming {
  now(): number;
  sleep(ms: number): Promise<void>;
  signal?: { readonly aborted: boolean };
}

interface RoomActivityInput {
  state: string;
  waiting_for?: string;
  unit?: string;
  target?: PairRole;
  participant_session?: string;
  expected_generation?: number;
  reason?: string;
}

interface RoomStopInput {
  reason: string;
  target?: string;
  expected_generation?: number;
}

interface RequestTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const requestTimers: RequestTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

class RoomRequestTimeout extends Error {}

async function boundedRequest<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  timers: RequestTimers = requestTimers,
): Promise<T> {
  const controller = new AbortController();
  let timer: unknown;
  const task = Promise.resolve().then(() => run(controller.signal));
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = timers.setTimeout(() => {
      controller.abort();
      reject(new RoomRequestTimeout(`runtime request exceeded ${ms}ms; interruption is unconfirmed`));
    }, ms);
  });
  try { return await Promise.race([task, deadline]); }
  finally { if (timer !== undefined) timers.clearTimeout(timer); }
}

export interface RoomCloseInput {
  unit: string;
  resolution: string;
  dissent?: string;
}

export interface RoomEvidenceInput {
  unit: string;
  stage: string;
  command?: string;
  exit_code?: number;
  output_excerpt?: string;
  actor?: string;
}

export interface RoomEndInput {
  summary?: string;
  wait_s?: number;
}

export interface RoomAckInput {
  summary?: string;
}

export interface RoomAuditInput {
  unit: string;
  findings: Array<{ category: string; severity: string; detail: string }>;
  command?: string;
  exit_code?: number;
  output_excerpt?: string;
  resolves?: string[];
  note?: string;
}

export interface RoomEscalateInput {
  action: string;
  reason: string;
  unit?: string;
  evidence?: string;
}

export interface RoomResolveEscalationInput {
  resolution: string;
}

export interface RoomAbortInput {
  reason: string;
}

export interface RoomResetInput {
  reason: string;
}

export interface RoomResetResult {
  room: Room;
  archivedPath: string;
}

export interface RoomReconcileInput {
  files: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function roomsDirectory(rootDir: string): string {
  return resolve(rootDir, ROOMS_RELATIVE_PATH);
}

function roomFileId(roomId: string): string {
  return roomId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function roomFilePath(rootDir: string, roomId: string): string {
  return join(roomsDirectory(rootDir), `${roomFileId(roomId)}.json`);
}

function lockFilePath(rootDir: string, roomId: string): string {
  return join(roomsDirectory(rootDir), `${roomFileId(roomId)}.lock`);
}

function readRoomFile(path: string): Room | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Room;
  } catch {
    return null;
  }
}

function writeRoomAtomically(directory: string, path: string, room: Room): void {
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(room, null, 2));
  renameSync(temporary, path);
}

function archiveRoomSnapshot(rootDir: string, roomId: string, room: Room): string {
  const archiveDirectory = join(roomsDirectory(rootDir), 'archive', roomFileId(roomId));
  mkdirSync(archiveDirectory, { recursive: true });

  const timestamp = nowIso().replace(/[:.]/g, '-');
  const filename = `generation-${room.generation ?? 1}-${timestamp}-${randomUUID()}.json`;
  const archivePath = join(archiveDirectory, filename);
  writeRoomAtomically(archiveDirectory, archivePath, room);
  return archivePath;
}

/**
 * Acquire an exclusive lock by creating the lock file with the `wx` flag.
 * Retries with a short backoff until the timeout, and always returns a
 * release function for the caller's `finally`.
 */
async function acquireLock(lockPath: string): Promise<() => void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          // The lock is already gone; nothing to release.
        }
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'EEXIST') throw error;
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for the room lock (${lockPath})`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

async function mutateRoom<T>(
  rootDir: string,
  roomId: string,
  mutate: (room: Room) => T,
): Promise<T> {
  const directory = roomsDirectory(rootDir);
  mkdirSync(directory, { recursive: true });
  const path = roomFilePath(rootDir, roomId);
  const release = await acquireLock(lockFilePath(rootDir, roomId));
  try {
    const room = readRoomFile(path);
    if (!room) throw new Error(`room not found: ${roomId}`);
    const result = mutate(room);
    writeRoomAtomically(directory, path, room);
    return result;
  } finally {
    release();
  }
}

function findMember(room: Room, sessionID: string): RoomMember | null {
  return room.members.find((member) => member.sessionID === sessionID) ?? null;
}

function requireMember(room: Room, sessionID: string): RoomMember {
  const member = findMember(room, sessionID);
  if (!member) throw new Error('this session has not joined the room');
  return member;
}

function requireHost(room: Room, sessionID: string): RoomMember {
  const member = requireMember(room, sessionID);
  if (member.role !== 'host') throw new Error('only the host may administer the room');
  return member;
}

function requireRoomOpen(room: Room, operation: string): void {
  if (room.status !== 'open') {
    throw new Error(`cannot ${operation}: the room is ${room.status}`);
  }
}

function requireNonEmptyRoomText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') throw new Error(`${field} is required and must be non-empty`);
  return text;
}

const CAP_COUNTED_TYPES = new Set<string>(['open', 'reply', 'challenge', 'propose_close']);

export function discussionCount(room: Room, unitId: string): number {
  return room.messages.filter(
    (message) =>
      message.unit === unitId &&
      message.kind === 'discussion' &&
      CAP_COUNTED_TYPES.has(message.type),
  ).length;
}

/**
 * Whether a message reaches a role. Broadcasts (`*`) go to every member except
 * the host (the host is excluded from the discussion) and the sender.
 */
export function messageTargetsRole(message: RoomMessage, role: RoomRole): boolean {
  if (message.to === role) return true;
  if (message.to === 'all') return role !== message.role;
  if (message.to === '*') return role !== 'host' && role !== message.role;
  return false;
}

/**
 * Resolve the pairing room for a session by walking `parentID` to the top-most
 * session. The lead and both of its children therefore share one room id.
 */
export async function roomIdForSession(
  sessionOrContext: RoomSessionApi | { session: RoomSessionApi },
  sessionID: string,
): Promise<string> {
  const session =
    (sessionOrContext as { session?: RoomSessionApi }).session ?? (sessionOrContext as RoomSessionApi);
  const visited = new Set<string>();
  let current = sessionID;
  for (;;) {
    if (visited.has(current)) throw new Error('session parent chain contains a cycle');
    visited.add(current);
    const info = await session.get({ sessionID: current });
    const id = typeof info?.id === 'string' && info.id !== '' ? info.id : current;
    if (!info || info.parentID === undefined || info.parentID === null || info.parentID === '') {
      return id;
    }
    current = info.parentID;
  }
}

export async function openRoom(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomOpenInput,
): Promise<Room> {
  const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
  if (goal === '') throw new Error('goal is required');
  if (!Array.isArray(input.scope) || input.scope.length === 0) {
    throw new Error('scope must list at least one acceptance scenario');
  }
  if (!Array.isArray(input.authorized_paths)) {
    throw new Error('authorized_paths must be an array');
  }

  const directory = roomsDirectory(rootDir);
  mkdirSync(directory, { recursive: true });
  const path = roomFilePath(rootDir, roomId);
  const release = await acquireLock(lockFilePath(rootDir, roomId));
  try {
    if (existsSync(path)) throw new Error(`a room already exists for this session (${roomId})`);
    const room: Room = {
      id: roomId,
      status: 'open',
      generation: 1,
      goal,
      scope: [...input.scope],
      authorized_paths: [...input.authorized_paths],
      created_at: nowIso(),
      members: [{ sessionID, role: 'host' }],
      units: {},
      messages: [],
      next_seq: 0,
    };
    writeRoomAtomically(directory, path, room);
    return room;
  } finally {
    release();
  }
}

export async function joinRoom(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: { role: RoomRole },
): Promise<Room> {
  const role = input.role;
  if (role !== 'driver' && role !== 'peer') {
    throw new Error('role must be "driver" or "peer"');
  }
  return mutateRoom(rootDir, roomId, (room) => {
    requireRoomOpen(room, 'join');
    if (room.retired_sessions?.includes(sessionID)) {
      throw new Error('this session was retired by a room reset and cannot rejoin this generation');
    }
    const existing = findMember(room, sessionID);
    if (existing) {
      if (existing.role !== role) {
        throw new Error(`this session already joined as ${existing.role}`);
      }
      return room;
    }
    if (room.members.some((member) => member.role === role)) {
      throw new Error(`${role} already joined this room`);
    }
    room.members.push({ sessionID, role });
    const joinedAt = Date.now();
    room.activities ??= {};
    room.activities[role] = { sessionID, availability: 'active', availability_at: 0, availability_source: 'declared', joined_at: joinedAt, state: 'working', updated_at: joinedAt };
    return room;
  });
}

export async function sendMessage(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomSendInput,
): Promise<RoomMessage> {
  const to = typeof input.to === 'string' ? input.to.trim() : '';
  const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
  const type = typeof input.type === 'string' ? input.type.trim() : '';
  const body = typeof input.body === 'string' ? input.body : '';
  const kind: RoomMessageKind = input.kind ?? 'discussion';

  if (to === '') throw new Error('to is required (an agent name or "*")');
  if (unit === '') throw new Error('unit is required (an acceptance scenario name)');
  if (!ROOM_MESSAGE_TYPES.includes(type as RoomMessageType)) {
    throw new Error(`invalid message type "${type}"`);
  }
  if (body.trim() === '') throw new Error('body is required');

  return mutateRoom(rootDir, roomId, (room) => {
    const member = requireMember(room, sessionID);
    requireRoomOpen(room, 'send a message');

    if (type === 'open') {
      if (!room.scope.includes(unit)) {
        throw new Error(`unit "${unit}" is not in the authorized scope`);
      }
      if (room.units[unit]) throw new Error(`unit "${unit}" is already open`);
    } else if (!room.units[unit]) {
      throw new Error(`unit "${unit}" is not open`);
    }

    if (type === 'open' || type === 'reopen' || type === 'ready_for_final_audit') {
      if (member.role !== 'driver') throw new Error(`only the driver may ${type}`);
    }
    if (type === 'reopen') {
      if (room.units[unit]?.status !== 'closed') throw new Error('only a closed unit can be reopened');
      room.units[unit].status = 'open';
      delete room.units[unit].closed_at;
      delete room.units[unit].resolution;
      delete room.units[unit].dissent;
      delete room.final_review;
      delete room.reconciliation;
    }
    if (type === 'ready_for_final_audit') {
      requireNoPendingEscalation(room, 'request final review');
      if (room.scope.some((name) => room.units[name]?.status !== 'closed')) {
        throw new Error('final review requires every unit closed');
      }
      if (to !== 'peer' && to !== '*') throw new Error('final review must notify the peer');
      room.final_review = { ready_seq: room.next_seq, ready_at: nowIso() };
    }

    const countsAgainstCap = kind === 'discussion' && (type === 'open' || type === 'reply' || type === 'challenge');
    if (countsAgainstCap && discussionCount(room, unit) >= MAX_DISCUSSION_MESSAGES) {
      throw new Error(
        `discussion cap reached for "${unit}" (${MAX_DISCUSSION_MESSAGES} messages); use propose_close`,
      );
    }

    if (type === 'open') {
      room.units[unit] = {
        id: unit,
        status: 'open',
        opened_at: nowIso(),
        opened_by: member.role,
      };
    }

    const message: RoomMessage = {
      id: randomUUID(),
      seq: room.next_seq,
      role: member.role,
      sessionID,
      to,
      unit,
      type,
      kind,
      body,
      created_at: nowIso(),
      read_by: [member.role],
    };
    room.next_seq += 1;
    if (input.reply_to !== undefined) message.reply_to = input.reply_to;
    room.messages.push(message);
    return message;
  });
}

export async function readInbox(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomInboxInput = {},
): Promise<RoomMessage[]> {
  const requestedWait = typeof input.wait_s === 'number' && Number.isFinite(input.wait_s) ? input.wait_s : 0;
  const waitSeconds = Math.min(Math.max(requestedWait, 0), INBOX_MAX_WAIT_S);
  const deadline = Date.now() + waitSeconds * 1000;

  for (;;) {
    const found = await mutateRoom(rootDir, roomId, (room) => {
      const member = requireMember(room, sessionID);
      const unread = room.messages.filter(
        (message) =>
          messageTargetsRole(message, member.role) &&
          !message.read_by.includes(member.role) &&
          (input.unit === undefined || message.unit === input.unit),
      );
      if (room.status !== 'aborted') {
        for (const message of unread) message.read_by.push(member.role);
      }
      return unread;
    });
    if (found.length > 0) return found;

    const remaining = deadline - Date.now();
    if (remaining <= 0) return [];
    await sleep(Math.min(INBOX_POLL_MS, remaining));
  }
}

/** Opaque snapshot cursor; read receipts and filesystem rewrites are not updates. */
export function roomUpdateCursor(room: Room): string {
  const { activities: _activities, mutual_wait: _mutualWait, ...progress } = room;
  const forum = progress.forum && (({ reads: _reads, ...rest }) => rest)(progress.forum);
  const meaningful = {
    ...progress,
    ...(forum ? { forum } : {}),
    messages: room.messages.map(({ read_by: _readBy, ...message }) => message),
  };
  const hash = createHash('sha256').update(JSON.stringify(meaningful)).digest('hex');
  return `${room.generation ?? 1}:${room.next_seq}:${hash}`;
}

/** One tool call waits for messages or meaningful room state changes, not just mail. */
export async function waitForUpdates(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomInboxInput = {},
  timing: RoomWaitTiming = { now: Date.now, sleep },
): Promise<RoomUpdateResult> {
  if (timing.signal?.aborted) throw new Error('update wait cancelled');
  const initial = roomState(rootDir, roomId);
  if (!findMember(initial, sessionID) && !initial.retired_sessions?.includes(sessionID)) {
    throw new Error('this session has not joined the room');
  }
  const previous = input.cursor ?? roomUpdateCursor(initial);
  const previousSeq = Number(previous.split(':')[1]);
  const previousGeneration = Number(previous.split(':')[0]);
  const requested = typeof input.wait_s === 'number' && Number.isFinite(input.wait_s)
    ? input.wait_s : INBOX_DEFAULT_WAIT_S;
  const deadline = timing.now() + Math.min(Math.max(requested, 0), INBOX_MAX_WAIT_S) * 1000;
  const initialMember = findMember(initial, sessionID);
  if (requested > 0 && initialMember && initialMember.role !== 'host' && initial.status === 'open') {
    await setParticipantActivity(rootDir, roomId, sessionID, {
      state: 'waiting_for_response', waiting_for: input.waiting_for,
      unit: input.unit,
    }, timing.now());
  }
  try {
    for (;;) {
      if (timing.signal?.aborted) throw new Error('update wait cancelled');
      let state = roomState(rootDir, roomId);
      const member = findMember(state, sessionID);
      const retired = state.retired_sessions?.includes(sessionID) === true;
      if (!member && !retired) throw new Error('this session has not joined the room');
      const unread = member ? unreadForRole(state, member.role).filter(
        (message) => input.unit === undefined || message.unit === input.unit,
      ) : [];
      const changed = roomUpdateCursor(state) !== previous;
      const terminal = retired || state.status === 'closed' || state.status === 'aborted' ||
        (state.status === 'awaiting_ack' && member?.role === 'peer');
      const unavailable = state.status !== 'closed' && state.members.some(candidate => candidate.role !== 'host' &&
        candidate.sessionID !== sessionID && participantActivity(state, candidate.role)?.availability !== undefined &&
        participantActivity(state, candidate.role)?.availability !== 'active');
      const mutual = !terminal && !unavailable && member?.role !== 'host'
        ? await mutualWaitNotice(rootDir, roomId, sessionID, timing.now()) : undefined;
      if (mutual) state = roomState(rootDir, roomId);
      const remaining = deadline - timing.now();
      if (unread.length > 0 || changed || terminal || unavailable || mutual || remaining <= 0) {
        const messages = unread.length > 0
          ? await readInbox(rootDir, roomId, sessionID, { unit: input.unit, wait_s: 0 }) : [];
        state = roomState(rootDir, roomId);
        const cursor = roomUpdateCursor(state);
        const updates = state.messages.filter((message) =>
          (state.generation ?? 1) !== previousGeneration ||
          (Number.isInteger(previousSeq) && message.seq >= previousSeq),
        );
        const waitingOwner = state.status === 'open' && mutualWaitKey(state, timing.now()) === state.mutual_wait?.key
          ? state.mutual_wait?.action_owner : undefined;
        return {
          messages, updates, state, cursor,
          changed: cursor !== previous || messages.length > 0 || terminal || unavailable || Boolean(mutual),
          timed_out: remaining <= 0 && cursor === previous && messages.length === 0 && !terminal && !unavailable && !mutual,
          ...(unavailable ? { notice: 'PEER_UNAVAILABLE' as const } : {}),
          ...(mutual ? { notice: 'MUTUAL_WAIT' as const } : {}),
          ...(mutual || waitingOwner ? { action_owner: mutual ?? waitingOwner } : {}),
        };
      }
      await timing.sleep(Math.min(INBOX_POLL_MS, remaining));
    }
  } finally {
    if (timing.signal?.aborted) {
      const current = readRoomFile(roomFilePath(rootDir, roomId));
      const member = current && findMember(current, sessionID);
      if (current?.status === 'open' && member && member.role !== 'host' && participantActivity(current, member.role)?.availability === 'active') {
        try {
          await setParticipantActivity(rootDir, roomId, sessionID, { state: 'working', expected_generation: initial.generation ?? 1 });
        } catch { /* The generation may have changed while cancellation ran. */ }
      }
    }
  }
}

function participantActivity(room: Room, role: PairRole): ParticipantActivity | undefined {
  const activity = room.activities?.[role];
  return activity && room.members.some(member => member.role === role && member.sessionID === activity.sessionID) ? activity : undefined;
}

export async function setParticipantActivity(
  rootDir: string, roomId: string, sessionID: string, input: RoomActivityInput, at = Date.now(),
): Promise<Room> {
  if (!['working', 'waiting_for_response', 'finished', 'unavailable'].includes(input.state)) throw new Error('invalid activity state');
  if (input.target !== undefined && !['driver', 'peer'].includes(input.target)) throw new Error('activity target must be driver or peer');
  return mutateRoom(rootDir, roomId, room => {
    const caller = requireMember(room, sessionID);
    if (input.expected_generation !== undefined && input.expected_generation !== (room.generation ?? 1)) throw new Error('activity generation is stale');
    let role: PairRole;
    if (caller.role === 'host') {
      if (!input.target || !input.participant_session || input.expected_generation === undefined) throw new Error('host activity reports require exact participant session and generation');
      if (!['finished', 'unavailable'].includes(input.state)) throw new Error('host reports availability; runtime execution resumes participants');
      requireNonEmptyRoomText(input.reason, 'reason');
      role = input.target;
      if (!room.members.some(member => member.role === role && member.sessionID === input.participant_session)) throw new Error('participant session does not match the current role');
    } else {
      role = caller.role;
      if (input.target && input.target !== role) throw new Error('only the host may change another participant; declare your own state');
    }
    const member = room.members.find(candidate => candidate.role === role)!;
    const previous = participantActivity(room, role);
    if (caller.role === 'host' && previous && at < previous.availability_at) throw new Error('availability report is older than the current execution state');
    const selfActive = caller.role !== 'host' && ['working', 'waiting_for_response'].includes(input.state);
    if (selfActive) requireRoomOpen(room, 'declare working activity');
    room.activities ??= {};
    const terminal = input.state === 'finished' || input.state === 'unavailable';
    room.activities[role] = {
      sessionID: member.sessionID,
      availability: terminal ? input.state as ParticipantAvailability : selfActive ? 'active' : previous?.availability ?? 'active',
      availability_at: input.state === 'finished' ? at : previous?.availability_at ?? 0,
      availability_source: terminal ? caller.role === 'host' ? 'host' : 'declared' : selfActive ? 'declared' : previous?.availability_source ?? 'declared',
      joined_at: previous?.joined_at ?? at,
      state: input.state === 'waiting_for_response' ? 'waiting_for_response' : 'working',
      ...(input.state === 'waiting_for_response' ? {
        waiting_for: input.waiting_for?.trim() || (role === 'driver' ? 'peer_review' : 'driver_changes'),
        ...(input.unit ? { unit: input.unit } : {}),
      } : {}),
      updated_at: at,
    };
    if (terminal && previous?.availability !== input.state) {
      insertRoomEvent(room, sessionID, caller.role, 'participant_unavailable', `${role}: ${input.state} — ${input.reason ?? 'participant reported completion'}; room messages do not restart this session`);
    }
    return room;
  });
}

function mutualWaitKey(room: Room, at: number): string | undefined {
  const driver = participantActivity(room, 'driver');
  const peer = participantActivity(room, 'peer');
  if (![driver, peer].every(activity => activity?.availability === 'active' && activity.state === 'waiting_for_response' && at - activity.updated_at <= ACTIVITY_FRESH_MS)) return;
  return `${room.generation ?? 1}:${room.next_seq}:${driver!.waiting_for}:${peer!.waiting_for}`;
}

async function mutualWaitNotice(rootDir: string, roomId: string, sessionID: string, at: number): Promise<PairRole | undefined> {
  const snapshot = roomState(rootDir, roomId);
  if (snapshot.forum) return;
  const key = mutualWaitKey(snapshot, at);
  if (!key) return;
  const caller = requireMember(snapshot, sessionID);
  if (snapshot.mutual_wait?.key === key && snapshot.mutual_wait.notified.includes(caller.role)) return;
  return mutateRoom(rootDir, roomId, room => {
    if (mutualWaitKey(room, at) !== key) return;
    const activeUnits = room.scope.filter(unit => room.units[unit]?.status === 'open');
    const ready = activeUnits.some(unit => {
      const point = reviewRevisionSeq(room, unit);
      const evidence = latestReviewableEvidence(room, unit);
      const reviewed = auditMessages(room, unit).some(message =>
        message.seq > point && message.command && Number.isInteger(message.exit_code) && message.output_excerpt,
      );
      return !reviewed && ((evidence?.seq === point && evidence.evidence?.exit_code === 0) ||
        room.messages.some(message => message.unit === unit && message.role === 'driver' && message.type === 'propose_close' && message.seq >= point));
    });
    let actionOwner: PairRole = ready ? 'peer' : 'driver';
    if (activeUnits.length === 0 && room.final_review) {
      const suite = latestSuiteAudit(room);
      if (!suite || suite.seq <= room.final_review.ready_seq ||
        (suite.evidence?.exit_code === 0 && room.reconciliation?.submissions.driver && !room.reconciliation.submissions.peer)) {
        actionOwner = 'peer';
      }
    }
    room.mutual_wait = room.mutual_wait?.key === key ? room.mutual_wait : {
      key, action_owner: actionOwner, notified: [],
    };
    if (room.mutual_wait.notified.includes(caller.role)) return;
    room.mutual_wait.notified.push(caller.role);
    return room.mutual_wait.action_owner;
  });
}

/**
 * Runtime "execution started" is the only lifecycle signal treated as proof of
 * activity. Per-step succeeded/failed events and idle timestamps are NOT proof
 * that a pair member has finished; only the host reports a returned child.
 */
export async function applyParticipantLifecycle(
  rootDir: string, roomId: string, sessionID: string, availability: ParticipantAvailability, observedAt: number,
): Promise<void> {
  if (availability !== 'active') return;
  if (!readRoomFile(roomFilePath(rootDir, roomId))) return;
  await mutateRoom(rootDir, roomId, room => {
    const member = findMember(room, sessionID);
    if (!member || member.role === 'host') return;
    const previous = participantActivity(room, member.role);
    if (previous?.joined_at !== undefined && observedAt < previous.joined_at) return;
    if (room.stop) {
      const requestedAt = room.stop.requested_at ?? Date.parse(room.aborted_at ?? '');
      if (observedAt < requestedAt) return;
      if (previous?.availability_at === observedAt && room.stop.results[member.role]?.detail === 'runtime execution restarted after killswitch; stop is unconfirmed') return;
      room.activities ??= {};
      room.activities[member.role] = { sessionID, availability: 'unavailable', availability_at: observedAt, availability_source: 'runtime', joined_at: previous?.joined_at, state: 'working', updated_at: observedAt };
      room.stop.results[member.role] = { sessionID, status: 'failed', detail: 'runtime execution restarted after killswitch; stop is unconfirmed' };
      insertRoomEvent(room, sessionID, member.role, 'stop_unconfirmed', `${member.role}: execution restarted after killswitch; do not replace writers until it is stopped again`);
      return;
    }
    if (room.status !== 'open') return;
    if (previous && previous.availability_source !== 'declared' && observedAt <= previous.availability_at) return;
    room.activities ??= {};
    room.activities[member.role] = {
      sessionID, availability: 'active', availability_at: previous?.availability_at ?? 0, availability_source: 'runtime',
      joined_at: previous?.joined_at, state: previous?.state ?? 'working',
      ...(previous?.waiting_for ? { waiting_for: previous.waiting_for } : {}),
      ...(previous?.unit ? { unit: previous.unit } : {}),
      updated_at: observedAt,
    };
    if (previous?.availability !== 'active') {
      insertRoomEvent(room, sessionID, member.role, 'participant_availability', `${member.role}: active; runtime execution started`);
    }
  });
}

export async function stopRoom(
  rootDir: string, roomId: string, sessionID: string, input: RoomStopInput,
  api: Pick<RoomSessionApi, 'interrupt'>, timers: RequestTimers = requestTimers,
): Promise<Room> {
  const reason = requireNonEmptyRoomText(input.reason, 'reason');
  const target = input.target ?? 'both';
  if (!['driver', 'peer', 'both'].includes(target)) throw new Error('stop target must be driver, peer or both');
  const attempt = await mutateRoom(rootDir, roomId, room => {
    requireHost(room, sessionID);
    if (input.expected_generation !== undefined && input.expected_generation !== (room.generation ?? 1)) throw new Error('stop generation is stale');
    if (room.status === 'closed') throw new Error('cannot stop a successfully closed room');
    const generation = room.generation ?? 1;
    const roles: PairRole[] = target === 'both' ? ['driver', 'peer'] : [target as PairRole];
    const previous = room.stop?.generation === generation ? room.stop : undefined;
    const results: Partial<Record<PairRole, ParticipantStopResult>> = { ...previous?.results };
    for (const role of roles) {
      const member = room.members.find(candidate => candidate.role === role);
      const saved = previous?.results[role];
      results[role] = !member ? { status: 'not_joined' } :
        saved?.sessionID === member.sessionID && ['interrupted', 'already_finished'].includes(saved.status)
          ? { ...saved } : { sessionID: member.sessionID, status: 'pending' };
      if (member) {
        const observedAt = participantActivity(room, role)?.availability_at ?? 0;
        room.activities ??= {};
        room.activities[role] = { sessionID: member.sessionID, availability: 'unavailable', availability_at: observedAt, availability_source: 'killswitch', state: 'working', updated_at: Date.now() };
      }
    }
    room.status = 'aborted'; room.abort_reason = reason; room.aborted_at = nowIso();
    delete room.awaiting_ack_since; delete room.ack_deadline_at;
    room.stop = { id: randomUUID(), generation, requested_at: Date.now(), reason, target: target as PairRole | 'both', results };
    insertRoomEvent(room, sessionID, 'host', 'stop_requested', `Killswitch ${target}: ${reason}; room aborted before runtime interruption`);
    return { ...room.stop, results: { ...results }, roles };
  });
  await Promise.all(attempt.roles.map(async role => {
    const entry = attempt.results[role]!;
    if (entry.status !== 'pending' || !entry.sessionID) return;
    let result: ParticipantStopResult;
    try {
      if (typeof api.interrupt !== 'function') throw new Error('runtime session.interrupt is unavailable');
      const output = await boundedRequest(signal => api.interrupt!({ sessionID: entry.sessionID!, resume: false }, { signal }), SESSION_STOP_TIMEOUT_MS, timers);
      if (typeof output?.interrupted !== 'boolean') throw new Error('runtime did not confirm the interruption result');
      result = { sessionID: entry.sessionID, status: output.interrupted ? 'interrupted' : 'already_finished' };
    } catch (error) {
      result = { sessionID: entry.sessionID, status: error instanceof RoomRequestTimeout ? 'timeout' : 'failed', detail: describeError(error) };
    }
    await mutateRoom(rootDir, roomId, room => {
      if (room.stop?.id !== attempt.id || (room.generation ?? 1) !== attempt.generation) return;
      room.stop.results[role as PairRole] = result;
      if (result.status === 'already_finished' && room.activities?.[role as PairRole]) room.activities[role as PairRole]!.availability = 'finished';
      insertRoomEvent(room, sessionID, 'host', 'stop_result', `${role}: ${result.status}${result.detail ? ' — ' + result.detail : ''}`);
    });
  }));
  const current = roomState(rootDir, roomId);
  if ((current.generation ?? 1) !== attempt.generation) throw new Error('stop completed for a retired generation; only its frozen session targets were interrupted, current generation was not changed');
  return current;
}

export function roomState(rootDir: string, roomId: string): Room {
  const room = readRoomFile(roomFilePath(rootDir, roomId));
  if (!room) throw new Error(`room not found: ${roomId}`);
  return room;
}

export function transcript(rootDir: string, roomId: string): RoomMessage[] {
  return [...roomState(rootDir, roomId).messages].sort((left, right) => left.seq - right.seq);
}

function unreadForRole(room: Room, role: RoomRole): RoomMessage[] {
  return room.messages.filter(
    (message) => messageTargetsRole(message, role) && !message.read_by.includes(role),
  );
}

export interface RoomNoticeHookEvent {
  sessionID?: string;
  system?: unknown[];
}

function unavailableParticipants(room: Room, sessionID: string): string[] {
  return room.members
    .filter(member => member.role !== 'host' && member.sessionID !== sessionID &&
      ['finished', 'unavailable'].includes(participantActivity(room, member.role as PairRole)?.availability ?? ''))
    .map(member => `${member.role} (session ${member.sessionID}, generation ${room.generation ?? 1})`);
}

/**
 * Build the one-line unread notice for a session, or null when the session is
 * not a room member or has no unread messages. Read-only: it never mutates the
 * room, because reading is the inbox tool's job.
 */
export function buildRoomNotice(room: Room, sessionID: string): string | null {
  const member = findMember(room, sessionID);
  if (!member) return null;
  const unread = unreadForRole(room, member.role);
  const unavailable = room.status !== 'closed' && room.status !== 'aborted'
    ? unavailableParticipants(room, sessionID)
    : [];
  const availabilityNotice = unavailable.length > 0
    ? `[pas-room] PEER_UNAVAILABLE: ${unavailable.join(', ')} stopped before the room completed; room messages do not restart sessions. The host must recover the pair.` : '';
  if (unread.length === 0) return availabilityNotice || null;
  const senders = [...new Set(unread.map((message) => message.role))].join(', ');
  const units = [...new Set(unread.map((message) => message.unit))].join(', ');
  return `[pas-room] ${unread.length} unread message(s) from ${senders} on ${units}; call pas_room_inbox before your next action.${availabilityNotice ? '\n' + availabilityNotice : ''}`;
}

/**
 * Context/compaction hook: append one unread notice to the outgoing system
 * prompt. Any failure is swallowed so it can never break a model call.
 */
export function createRoomNoticeHook(
  directory: string,
  session: RoomSessionApi,
): (event: RoomNoticeHookEvent) => Promise<void> {
  return async (event) => {
    try {
      const sessionID = typeof event?.sessionID === 'string' ? event.sessionID : '';
      if (sessionID === '' || !Array.isArray(event.system)) return;
      const roomId = await roomIdForSession(session, sessionID);
      const room = readRoomFile(roomFilePath(directory, roomId));
      if (!room) return;
      const notice = buildRoomNotice(room, sessionID);
      if (!notice) return;
      event.system.push({ type: 'text', text: notice });
    } catch {
      // A safety net must never break the model call it is decorating.
    }
  };
}

function evidenceMessages(room: Room, unitId: string): RoomMessage[] {
  return room.messages
    .filter((message) => message.kind === 'evidence' && message.unit === unitId && message.evidence)
    .sort((left, right) => left.seq - right.seq);
}

function latestSuiteAudit(room: Room): RoomMessage | null {
  const suites = room.messages
    .filter((message) => message.kind === 'evidence' && message.evidence?.stage === 'suite')
    .sort((left, right) => left.seq - right.seq);
  return suites[suites.length - 1] ?? null;
}

function auditMessages(room: Room, unitId: string): RoomMessage[] {
  return room.messages.filter((message) => message.kind === 'audit' && message.unit === unitId);
}

function unresolvedBlockingFindings(room: Room, unitId: string): RoomFinding[] {
  return auditMessages(room, unitId).flatMap((message) =>
    (message.findings ?? []).filter(
      (finding) => finding.severity === 'blocking' && finding.resolved !== true,
    ),
  );
}

function latestReviewableEvidence(room: Room, unitId: string, beforeSeq = Infinity): RoomMessage | undefined {
  return evidenceMessages(room, unitId).filter((message) =>
    message.seq < beforeSeq && message.role === 'driver' &&
    ['green', 'refactor', 'verification', 'manual'].includes(message.evidence!.stage),
  ).at(-1);
}

/** Review freshness is independent from whether the engineer used TDD stages. */
function reviewRevisionSeq(room: Room, unitId: string, beforeSeq = Infinity): number {
  const opened = room.messages.filter(message =>
    message.unit === unitId && message.role === 'driver' && message.seq < beforeSeq &&
    (message.type === 'open' || message.type === 'reopen'),
  ).at(-1)?.seq ?? -1;
  return Math.max(opened, latestReviewableEvidence(room, unitId, beforeSeq)?.seq ?? -1);
}

function correctionRoundsUsed(room: Room, unitId: string): number {
  const revisions = auditMessages(room, unitId)
    .filter((message) => (message.findings ?? []).some((finding) => finding.severity === 'blocking'))
    .map((message) => message.reviewed_revision_seq ?? message.reviewed_evidence_seq ?? reviewRevisionSeq(room, unitId, message.seq))
    .filter(seq => seq >= 0);
  return new Set(revisions).size;
}

function requireNoPendingEscalation(room: Room, operation: string): void {
  if (!room.escalation) return;
  throw new Error(
    `cannot ${operation}: a pending escalation (${room.escalation.action} — ${room.escalation.reason}) must be resolved first`,
  );
}

function validateEvidenceFields(evidence: RoomEvidence): string | null {
  if (typeof evidence.command !== 'string' || evidence.command.trim() === '') {
    return 'command is required and must be non-empty';
  }
  if (typeof evidence.output_excerpt !== 'string' || evidence.output_excerpt.trim() === '') {
    return 'output_excerpt is required and must be non-empty';
  }
  if (!Number.isInteger(evidence.exit_code)) {
    return 'exit_code is required and must be an integer';
  }
  return null;
}

function parseEvidenceInput(input: RoomEvidenceInput): RoomEvidence {
  const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
  const stage = typeof input.stage === 'string' ? input.stage.trim() : '';
  if (unit === '') throw new Error('unit is required (an acceptance scenario name)');
  if (!EVIDENCE_STAGES.includes(stage as EvidenceStage)) {
    throw new Error(`invalid evidence stage "${stage}"`);
  }
  const evidence: RoomEvidence = {
    stage: stage as EvidenceStage,
    command: typeof input.command === 'string' ? input.command : '',
    exit_code: input.exit_code as number,
    output_excerpt: typeof input.output_excerpt === 'string' ? input.output_excerpt : '',
  };
  if (typeof input.actor === 'string' && input.actor.trim() !== '') evidence.actor = input.actor.trim();
  const problem = validateEvidenceFields(evidence);
  if (problem) throw new Error(problem);
  return evidence;
}

/**
 * Record reproducible evidence for a unit. Evidence is a log entry, not
 * conversation: it is exempt from the discussion cap and is marked read for
 * every role so it never blocks a close through the unread rule.
 */
export async function recordEvidence(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomEvidenceInput,
): Promise<RoomMessage> {
  const evidence = parseEvidenceInput(input);
  const unitId = typeof input.unit === 'string' ? input.unit.trim() : '';
  return mutateRoom(rootDir, roomId, (room) => {
    const member = requireMember(room, sessionID);
    requireRoomOpen(room, 'record evidence');
    if (!room.scope.includes(unitId)) {
      throw new Error(`unit "${unitId}" is not in the authorized scope`);
    }

    if (evidence.stage === 'suite') {
      if (member.role !== 'peer') {
        throw new Error('only the peer may record the full-suite audit (stage "suite")');
      }
    } else {
      const unit = room.units[unitId];
      if (!unit || unit.status !== 'open') {
        throw new Error(`unit "${unitId}" is not open`);
      }
      if (member.role !== 'driver') {
        throw new Error('only the driver may record unit check evidence');
      }
      if (evidence.stage === 'green') {
        const red = evidenceMessages(room, unitId).some(
          (message) => message.evidence?.stage === 'red',
        );
        if (!red) throw new Error('cannot record green evidence before a red entry for this unit');
      }
    }

    const message: RoomMessage = {
      id: randomUUID(),
      seq: room.next_seq,
      role: member.role,
      sessionID,
      to: '*',
      unit: unitId,
      type: 'evidence',
      kind: 'evidence',
      body: `${evidence.stage}: ${evidence.command} (exit ${evidence.exit_code})\n${evidence.output_excerpt}`,
      evidence,
      created_at: nowIso(),
      read_by: ['host', 'driver', 'peer'],
    };
    room.next_seq += 1;
    room.messages.push(message);
    return message;
  });
}

function parseAuditFindings(raw: unknown): RoomFinding[] {
  if (!Array.isArray(raw)) {
    throw new Error('findings must be an array');
  }
  return raw.map((entry) => {
    const record = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    const category = typeof record.category === 'string' ? record.category.trim() : '';
    const severity = typeof record.severity === 'string' ? record.severity.trim() : '';
    const detail = typeof record.detail === 'string' ? record.detail.trim() : '';
    if (!FINDING_CATEGORIES.includes(category as FindingCategory)) {
      throw new Error(
        `invalid finding category "${category}"; expected one of ${FINDING_CATEGORIES.join(', ')}`,
      );
    }
    if (!FINDING_SEVERITIES.includes(severity as FindingSeverity)) {
      throw new Error(
        `invalid finding severity "${severity}"; expected one of ${FINDING_SEVERITIES.join(', ')}`,
      );
    }
    if (detail === '') throw new Error('finding detail is required and must be non-empty');
    return {
      id: randomUUID(),
      category: category as FindingCategory,
      severity: severity as FindingSeverity,
      detail,
    };
  });
}

/**
 * Peer-only audit entry for a unit. Findings are first-class: each carries a
 * category and a severity, audits are exempt from the discussion cap, and the
 * number of blocking rounds per unit is bounded. When the bound is reached the
 * only exit is `pas_room_escalate`.
 */
export async function auditUnit(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomAuditInput,
): Promise<RoomMessage> {
  const unitId = typeof input.unit === 'string' ? input.unit.trim() : '';
  if (unitId === '') throw new Error('unit is required (an acceptance scenario name)');
  const findings = parseAuditFindings(input.findings);
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const output = typeof input.output_excerpt === 'string' ? input.output_excerpt.trim() : '';
  if (input.exit_code !== undefined && !Number.isInteger(input.exit_code)) {
    throw new Error('audit exit_code must be an integer');
  }
  if (input.resolves !== undefined && (!Array.isArray(input.resolves) || input.resolves.some(id => typeof id !== 'string' || id.trim() === ''))) {
    throw new Error('resolves must list finding ids');
  }

  return mutateRoom(rootDir, roomId, (room) => {
    const member = requireMember(room, sessionID);
    if (member.role !== 'peer') throw new Error('only the peer may record an audit');
    requireRoomOpen(room, 'record an audit');
    if (!room.scope.includes(unitId)) {
      throw new Error(`unit "${unitId}" is not in the authorized scope`);
    }
    const unit = room.units[unitId];
    if (!unit || unit.status !== 'open') throw new Error(`unit "${unitId}" is not open`);

    const hasBlocking = findings.some((finding) => finding.severity === 'blocking');
    const reviewedSeq = reviewRevisionSeq(room, unitId);
    const alreadyReviewed = auditMessages(room, unitId).some((message) =>
      (message.reviewed_revision_seq ?? message.reviewed_evidence_seq ?? reviewRevisionSeq(room, unitId, message.seq)) === reviewedSeq &&
      (message.findings ?? []).some(finding => finding.severity === 'blocking'),
    );
    if (hasBlocking && !alreadyReviewed && correctionRoundsUsed(room, unitId) >= MAX_CORRECTION_ROUNDS) {
      throw new Error(
        `correction rounds for "${unitId}" are exhausted (${MAX_CORRECTION_ROUNDS} reviewed revisions); the only exit is pas_room_escalate`,
      );
    }

    const resolves = input.resolves ?? [];
    const previousFindings = unresolvedBlockingFindings(room, unitId);
    if (resolves.length > 0) {
      if (command === '' || input.exit_code !== 0 || output === '' || hasBlocking) {
        throw new Error('resolving findings requires current successful peer command evidence');
      }
      for (const id of resolves) {
        const finding = previousFindings.find(candidate => candidate.id === id);
        if (!finding) throw new Error(`unresolved finding "${id}" is not in this unit`);
      }
      for (const finding of previousFindings) {
        if (resolves.includes(finding.id)) finding.resolved = true;
      }
    }

    const body = [
      `audit: ${findings.length} finding(s)`,
      ...findings.map((finding) => `[${finding.severity}/${finding.category}] ${finding.detail}`),
      command ? `command: ${command}` : '',
      note ? `note: ${note}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n');

    const message: RoomMessage = {
      id: randomUUID(),
      seq: room.next_seq,
      role: member.role,
      sessionID,
      to: '*',
      unit: unitId,
      type: 'audit',
      kind: 'audit',
      body,
      findings,
      created_at: nowIso(),
      read_by: ['host', 'driver', 'peer'],
    };
    if (command !== '') message.command = command;
    if (input.exit_code !== undefined) message.exit_code = input.exit_code;
    if (output !== '') message.output_excerpt = output;
    message.reviewed_revision_seq = reviewedSeq;
    if (resolves.length > 0) message.resolved_findings = [...resolves];
    if (note !== '') message.note = note;
    room.next_seq += 1;
    room.messages.push(message);

    unit.correction_rounds = correctionRoundsUsed(room, unitId);
    unit.blocking_findings = unresolvedBlockingFindings(room, unitId).length;
    return message;
  });
}

/**
 * Escalate to the orchestrator. Escalation is a cut, never a wait: the tool
 * returns immediately, and the pending escalation blocks close, end and ack
 * until the host decides. The latest escalation wins; the previous one stays
 * in the transcript as an event.
 */
export async function escalateRoom(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomEscalateInput,
): Promise<Room> {
  const action = typeof input.action === 'string' ? input.action.trim() : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!ESCALATION_ACTIONS.includes(action as EscalationAction)) {
    throw new Error(
      `invalid escalation action "${action}"; expected one of ${ESCALATION_ACTIONS.join(', ')}`,
    );
  }
  if (reason === '') throw new Error('escalation reason is required and must be non-empty');
  const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
  const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : '';

  return mutateRoom(rootDir, roomId, (room) => {
    const member = requireMember(room, sessionID);
    if (member.role !== 'driver' && member.role !== 'peer') {
      throw new Error('only the driver or the peer may escalate');
    }
    requireRoomOpen(room, 'escalate');

    if (room.escalation) {
      insertRoomEvent(
        room,
        sessionID,
        member.role,
        'escalation_superseded',
        `superseded escalation: ${room.escalation.action} — ${room.escalation.reason}`,
      );
    }

    const escalation: RoomEscalation = {
      action: action as EscalationAction,
      reason,
      raised_by: member.role,
      sessionID,
      created_at: nowIso(),
    };
    if (unit !== '') escalation.unit = unit;
    if (evidence !== '') escalation.evidence = evidence;
    room.escalation = escalation;
    insertRoomEvent(
      room,
      sessionID,
      member.role,
      'escalation',
      `escalation: ${escalation.action} — ${escalation.reason}`,
    );
    return room;
  });
}

/** Resolve a pending escalation with an auditable host decision. */
export async function resolveRoomEscalation(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomResolveEscalationInput,
): Promise<Room> {
  const resolution = requireNonEmptyRoomText(input.resolution, 'resolution');

  return mutateRoom(rootDir, roomId, (room) => {
    requireHost(room, sessionID);
    if (room.status === 'closed' || room.status === 'aborted') {
      throw new Error(`cannot resolve an escalation in a ${room.status} room`);
    }
    if (!room.escalation) throw new Error('there is no pending escalation to resolve');

    const { action, reason } = room.escalation;
    insertRoomEvent(
      room,
      sessionID,
      'host',
      'escalation_resolved',
      `escalation resolved: ${action} — ${reason}; host decision: ${resolution}`,
    );
    delete room.escalation;
    return room;
  });
}

/** Abort a room without claiming the pair completed its acceptance criteria. */
export async function abortRoom(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomAbortInput,
): Promise<Room> {
  const reason = requireNonEmptyRoomText(input.reason, 'reason');

  return mutateRoom(rootDir, roomId, (room) => {
    requireHost(room, sessionID);
    if (room.status === 'closed') {
      throw new Error('cannot abort a successfully closed room; reset it to start another generation');
    }
    if (room.status === 'aborted') throw new Error('the room is already aborted');

    room.status = 'aborted';
    room.abort_reason = reason;
    room.aborted_at = nowIso();
    delete room.awaiting_ack_since;
    delete room.ack_deadline_at;
    insertRoomEvent(room, sessionID, 'host', 'abort', `room aborted: ${reason}`);
    return room;
  });
}

function createResetRoom(
  previous: Room,
  sessionID: string,
  generation: number,
  reason: string,
): Room {
  const retiredSessions = new Set(previous.retired_sessions ?? []);
  for (const member of previous.members) {
    if (member.role !== 'host') retiredSessions.add(member.sessionID);
  }

  const room: Room = {
    id: previous.id,
    status: 'open',
    generation,
    goal: previous.goal,
    scope: [...previous.scope],
    authorized_paths: [...previous.authorized_paths],
    created_at: nowIso(),
    members: [{ sessionID, role: 'host' }],
    retired_sessions: [...retiredSessions],
    units: {},
    messages: [],
    next_seq: 0,
    ...(previous.forum ? { forum: { topics: [], posts: [], requests: {}, baseline: previous.forum.baseline } } : {}),
  };
  insertRoomEvent(room, sessionID, 'host', 'reset', `started generation ${generation}: ${reason}`);
  return room;
}

/** Archive this attempt and start a clean generation under the same room id. */
export async function resetRoom(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomResetInput,
): Promise<RoomResetResult> {
  const reason = requireNonEmptyRoomText(input.reason, 'reason');

  const directory = roomsDirectory(rootDir);
  mkdirSync(directory, { recursive: true });
  const path = roomFilePath(rootDir, roomId);
  const release = await acquireLock(lockFilePath(rootDir, roomId));
  try {
    const previous = readRoomFile(path);
    if (!previous) throw new Error(`room not found: ${roomId}`);
    requireHost(previous, sessionID);
    if (previous.forum && previous.members.some(member => member.role !== 'host' &&
      !(participantActivity(previous, member.role as PairRole)?.availability === 'finished' &&
        ['host', 'runtime'].includes(participantActivity(previous, member.role as PairRole)?.availability_source ?? 'declared')) &&
      !(previous.stop?.results[member.role as PairRole]?.sessionID === member.sessionID &&
        ['interrupted', 'already_finished'].includes(previous.stop.results[member.role as PairRole]!.status)))) {
      throw new Error('cannot restart forum: participant termination is unconfirmed');
    }
    if (previous.stop) {
      const unconfirmed = previous.members.filter(member => member.role !== 'host').filter(member => {
        const result = previous.stop!.results[member.role as PairRole];
        return !(result?.sessionID === member.sessionID && ['interrupted', 'already_finished'].includes(result.status)) &&
          !(participantActivity(previous, member.role as PairRole)?.availability === 'finished' &&
            ['runtime', 'host'].includes(participantActivity(previous, member.role as PairRole)?.availability_source ?? 'declared'));
      });
      if (unconfirmed.length > 0) throw new Error('cannot reset: runtime stop/interrupt is unconfirmed; stop remaining participants before replacing the pair');
    }

    const previousGeneration = previous.generation ?? 1;
    const generation = previousGeneration + 1;
    insertRoomEvent(
      previous,
      sessionID,
      'host',
      'reset',
      `generation ${previousGeneration} reset to ${generation}: ${reason}`,
    );
    const archivedPath = archiveRoomSnapshot(rootDir, roomId, previous);
    const room = createResetRoom(previous, sessionID, generation, reason);
    writeRoomAtomically(directory, path, room);
    return { room, archivedPath };
  } finally {
    release();
  }
}

/**
 * Submit this agent's changed-file list. Both the driver and the peer must
 * submit; the room compares the lists as sets. Re-submitting replaces that
 * agent's own previous submission, so an agent can correct itself.
 */
export async function reconcileFiles(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomReconcileInput,
): Promise<Room> {
  if (!Array.isArray(input.files)) throw new Error('files must be an array of paths');
  const files = input.files
    .filter((file): file is string => typeof file === 'string')
    .map((file) => file.trim())
    .filter((file) => file !== '');
  if (files.length !== input.files.length) {
    throw new Error('files must be an array of non-empty path strings');
  }
  const normalized = Array.from(new Set(files)).sort();

  return mutateRoom(rootDir, roomId, (room) => {
    const member = requireMember(room, sessionID);
    if (room.status === 'closed' || room.status === 'aborted') {
      throw new Error(`cannot reconcile files in a ${room.status} room`);
    }
    if (member.role !== 'driver' && member.role !== 'peer') {
      throw new Error('only the driver or the peer may reconcile file lists');
    }
    const reconciliation: RoomReconciliation = room.reconciliation ?? {
      submissions: {},
      reconciled: false,
    };
    reconciliation.submissions[member.role] = {
      sessionID,
      files: normalized,
      submitted_at: nowIso(),
    };

    const driver = reconciliation.submissions.driver;
    const peer = reconciliation.submissions.peer;
    if (!driver || !peer) {
      reconciliation.reconciled = false;
      delete reconciliation.files;
      delete reconciliation.discrepancies;
    } else {
      const onlyDriver = driver.files.filter((file) => !peer.files.includes(file));
      const onlyPeer = peer.files.filter((file) => !driver.files.includes(file));
      if (onlyDriver.length === 0 && onlyPeer.length === 0) {
        reconciliation.reconciled = true;
        reconciliation.files = [...driver.files];
        delete reconciliation.discrepancies;
      } else {
        reconciliation.reconciled = false;
        delete reconciliation.files;
        reconciliation.discrepancies = { only_driver: onlyDriver, only_peer: onlyPeer };
      }
    }
    room.reconciliation = reconciliation;
    return room;
  });
}

export async function closeUnit(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomCloseInput,
): Promise<RoomUnit> {
  const unitId = typeof input.unit === 'string' ? input.unit.trim() : '';
  const resolution = typeof input.resolution === 'string' ? input.resolution.trim() : '';
  if (unitId === '') throw new Error('unit is required');
  if (resolution === '') throw new Error('resolution is required');

  return mutateRoom(rootDir, roomId, (room) => {
    const member = requireMember(room, sessionID);
    if (member.role === 'peer') {
      throw new Error('the peer cannot close a unit; use propose_close');
    }
    if (member.role !== 'driver') {
      throw new Error('only the driver may close a unit');
    }
    requireRoomOpen(room, 'close a unit');
    requireNoPendingEscalation(room, `close "${unitId}"`);

    const unit = room.units[unitId];
    if (!unit) throw new Error(`unit "${unitId}" is not open`);
    if (unit.status === 'closed') throw new Error(`unit "${unitId}" is already closed`);

    const dissent = typeof input.dissent === 'string' ? input.dissent.trim() : '';

    const unread = room.messages.filter(
      (message) =>
        message.unit === unitId &&
        messageTargetsRole(message, 'driver') &&
        !message.read_by.includes('driver'),
    );
    if (unread.length > 0) {
      throw new Error(
        `cannot close "${unitId}" with ${unread.length} unread message(s); read the inbox first`,
      );
    }

    const peerMessages = room.messages
      .filter((message) => message.unit === unitId && message.role === 'peer')
      .sort((left, right) => left.seq - right.seq);
    const lastPeer = peerMessages[peerMessages.length - 1];
    if (lastPeer && lastPeer.type === 'challenge') {
      const replied = room.messages.some(
        (message) => message.unit === unitId && message.role === 'driver' && message.seq > lastPeer.seq,
      );
      if (!replied && dissent === '') {
        throw new Error('closing over a challenge requires explicit dissent');
      }
    }

    const blockingFindings = unresolvedBlockingFindings(room, unitId);
    if (blockingFindings.length > 0 && dissent === '') {
      throw new Error(
        `cannot close "${unitId}": ${blockingFindings.length} unresolved blocking finding(s); resolve them or record explicit dissent`,
      );
    }

    const reviewedSeq = reviewRevisionSeq(room, unitId);
    const review = auditMessages(room, unitId).filter(message =>
      message.role === 'peer' && message.seq > reviewedSeq &&
      typeof message.command === 'string' && message.command.trim() !== '' &&
      Number.isInteger(message.exit_code) && typeof message.output_excerpt === 'string' && message.output_excerpt.trim() !== '',
    ).at(-1);
    if (!review) {
        throw new Error(`cannot close "${unitId}": requires a fresh executable peer audit of the current review point`);
    }
    if (review.exit_code !== 0 && dissent === '') {
      throw new Error(`cannot close "${unitId}": peer audit failed; resolve it or record explicit dissent`);
    }

    unit.status = 'closed';
    unit.closed_at = nowIso();
    unit.resolution = resolution;
    unit.correction_rounds = correctionRoundsUsed(room, unitId);
    for (const finding of blockingFindings) {
      finding.resolved = true;
      finding.overridden_by = dissent;
      insertRoomEvent(
        room,
        sessionID,
        member.role,
        'finding_override',
        `override: overruled blocking finding [${finding.category}] "${finding.detail}" — dissent: ${dissent}`,
      );
    }
    unit.blocking_findings = 0;
    if (input.dissent !== undefined) unit.dissent = input.dissent;
    return unit;
  });
}

function insertRoomEvent(
  room: Room,
  sessionID: string,
  role: RoomRole,
  type: string,
  body: string,
): void {
  room.messages.push({
    id: randomUUID(),
    seq: room.next_seq,
    role,
    sessionID,
    to: '*',
    unit: '',
    type,
    kind: 'discussion',
    body,
    created_at: nowIso(),
    read_by: ['host', 'driver', 'peer'],
  });
  room.next_seq += 1;
}

function clampWaitSeconds(value: unknown): number {
  const requested = typeof value === 'number' && Number.isFinite(value) ? value : END_DEFAULT_WAIT_S;
  return Math.min(Math.max(requested, 0), END_MAX_WAIT_S);
}

/**
 * Driver-only end of the pairing session. Sets `awaiting_ack`, records the end
 * event, then waits up to `wait_s` (default 30, cap 60) for the peer's ack.
 * If no ack arrives the room deliberately stays `awaiting_ack`; it is never
 * reported closed without the peer's acknowledgement.
 */
export async function endRoom(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomEndInput = {},
): Promise<Room> {
  const waitSeconds = clampWaitSeconds(input.wait_s);
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';

  await mutateRoom(rootDir, roomId, (room) => {
    if (room.forum) throw new Error('forum rooms must use the pair forum closing protocol');
    const member = requireMember(room, sessionID);
    if (member.role !== 'driver') throw new Error('only the driver may end the room');
    requireNoPendingEscalation(room, 'end the room');
    if (room.status === 'closed') throw new Error('the room is already closed');
    if (room.status === 'aborted') throw new Error('cannot end an aborted room');
    if (room.status === 'awaiting_ack') {
      throw new Error('the room is already awaiting the peer ack');
    }

    const notClosed = room.scope.filter((unit) => room.units[unit]?.status !== 'closed');
    if (notClosed.length > 0) {
      throw new Error(`cannot end: every unit must be closed (open: ${notClosed.join(', ')})`);
    }

    const unread = unreadForRole(room, 'driver');
    if (unread.length > 0) {
      throw new Error(`cannot end with ${unread.length} unread message(s); read the inbox first`);
    }

    const suite = latestSuiteAudit(room);
    if (!suite) {
      throw new Error('cannot end: missing the peer full-suite audit (stage "suite")');
    }
    if (suite.evidence?.exit_code !== 0) {
      throw new Error(
        `cannot end: the peer full-suite audit exited with code ${String(suite.evidence?.exit_code)} (must be 0)`,
      );
    }
    if (!room.final_review || suite.seq <= room.final_review.ready_seq) {
      throw new Error('cannot end: requires a green peer suite after ready_for_final_audit on the stable final tree');
    }

    room.status = 'awaiting_ack';
    room.awaiting_ack_since = nowIso();
    room.ack_deadline_at = new Date(Date.now() + waitSeconds * 1000).toISOString();
    insertRoomEvent(room, sessionID, member.role, 'end', summary ? `end: ${summary}` : 'end');
    return room;
  });

  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const current = roomState(rootDir, roomId);
    if (current.status === 'closed') return current;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return current;
    await sleep(Math.min(ACK_POLL_MS, remaining));
  }
}

/** Peer-only acknowledgement of the driver's end request. */
export async function ackRoom(
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: RoomAckInput = {},
): Promise<Room> {
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  return mutateRoom(rootDir, roomId, (room) => {
    if (room.forum) throw new Error('forum rooms must use the pair forum closing protocol');
    const member = requireMember(room, sessionID);
    if (member.role !== 'peer') throw new Error('only the peer may ack the room');
    requireNoPendingEscalation(room, 'ack the room');
    if (!room.reconciliation?.reconciled) {
      throw new Error(
        'cannot ack: both agents must reconcile their file lists first (pas_room_reconcile)',
      );
    }
    if (room.status !== 'awaiting_ack') {
      throw new Error('ack is only valid after the driver ends the room (status awaiting_ack)');
    }
    room.status = 'closed';
    delete room.awaiting_ack_since;
    delete room.ack_deadline_at;
    insertRoomEvent(room, sessionID, member.role, 'ack', summary ? `ack: ${summary}` : 'ack');
    return room;
  });
}

function roomAnomalies(room: Room): string[] {
  const anomalies: string[] = [];
  if (room.status === 'awaiting_ack' && room.ack_deadline_at !== undefined) {
    if (Date.now() > Date.parse(room.ack_deadline_at)) {
      anomalies.push(
        `awaiting_ack past the wait window (deadline ${room.ack_deadline_at}); the peer did not acknowledge`,
      );
    }
  }
  return anomalies;
}

function renderReconciliation(reconciliation: RoomReconciliation | undefined): string {
  if (!reconciliation) return 'not submitted';
  const submissions = reconciliation.submissions;
  const submitted = (['driver', 'peer'] as const)
    .map((role) => `${role}=${submissions[role] ? 'yes' : 'no'}`)
    .join(' ');
  if (reconciliation.reconciled) {
    return `reconciled (${submitted}) files=[${(reconciliation.files ?? []).join(', ')}]`;
  }
  if (reconciliation.discrepancies) {
    return `discrepancy (${submitted}) only_driver=[${reconciliation.discrepancies.only_driver.join(', ')}] only_peer=[${reconciliation.discrepancies.only_peer.join(', ')}]`;
  }
  return `pending (${submitted})`;
}

export function renderRoomState(room: Room): string {
  const lines = [
    `Room: ${room.id}`,
    `Status: ${room.status}`,
    `Generation: ${room.generation ?? 1}`,
    `Update cursor: ${roomUpdateCursor(room)}`,
    `Goal: ${room.goal}`,
    `Scope: ${room.scope.join(' | ') || '(none)'}`,
    `Authorized paths: ${room.authorized_paths.join(', ') || '(none)'}`,
    'Members:',
  ];
  if (room.members.length === 0) lines.push('- (none)');
  for (const member of room.members) lines.push(`- ${member.role}: ${member.sessionID}`);
  lines.push('Participant activity:');
  for (const role of ['driver', 'peer'] as const) {
    const activity = participantActivity(room, role);
    lines.push(`- ${role}: ${activity?.availability ?? 'unknown'} / ${activity?.state ?? 'unknown'}${activity?.waiting_for ? ` waiting_for=${activity.waiting_for}` : ''}${activity?.unit ? ` unit=${activity.unit}` : ''} source=${activity?.availability_source ?? 'declared'}`);
  }
  if (room.stop) {
    lines.push(`Killswitch generation ${room.stop.generation}: ${room.stop.reason}`);
    for (const [role, result] of Object.entries(room.stop.results)) lines.push(`- ${role}: ${result.status}${result.detail ? ' — ' + result.detail : ''}`);
  }
  lines.push('Units:');
  const unitIds = Object.keys(room.units);
  if (unitIds.length === 0) lines.push('- (none)');
  for (const unitId of unitIds) {
    const counts = EVIDENCE_STAGES.map((stage) => {
      const total = evidenceMessages(room, unitId).filter(
        (message) => message.evidence?.stage === stage,
      ).length;
      return `${stage}=${total}`;
    });
    lines.push(`- ${unitId} [${room.units[unitId].status}] evidence: ${counts.join(' ')}`);
    lines.push(
      `  blocking=${unresolvedBlockingFindings(room, unitId).length} rounds=${correctionRoundsUsed(room, unitId)}/${MAX_CORRECTION_ROUNDS}`,
    );
  }

  lines.push(
    room.escalation
      ? `Escalation: ${room.escalation.action} — ${room.escalation.reason}${room.escalation.unit ? ` (unit: ${room.escalation.unit})` : ''}`
      : 'Escalation: none',
  );
  if (room.status === 'aborted') {
    lines.push(`Abort reason: ${room.abort_reason ?? '(not recorded)'}`);
  }
  lines.push(`Reconciliation: ${renderReconciliation(room.reconciliation)}`);
  lines.push(`Final review: ${room.final_review ? `ready at #${room.final_review.ready_seq}` : 'not requested'}`);

  const suite = latestSuiteAudit(room);
  lines.push(
    suite
      ? `Suite audit: exit=${String(suite.evidence?.exit_code)} (${suite.evidence?.exit_code === 0 ? 'green' : 'failing'})`
      : 'Suite audit: missing',
  );
  lines.push(
    `Unread: ${room.members
      .map((member) => `${member.role}=${unreadForRole(room, member.role).length}`)
      .join(' ')}`,
  );
  const anomalies = roomAnomalies(room);
  lines.push(`Anomalies: ${anomalies.length === 0 ? 'none' : anomalies.join(' | ')}`);
  lines.push(`Messages: ${room.messages.length}`);
  return lines.join('\n');
}

export function renderTranscript(messages: RoomMessage[]): string {
  if (messages.length === 0) return '(empty transcript)';
  return messages
    .map((message) => {
      const lines = [
        `#${message.seq} ${message.role}->${message.to} ${message.unit} ${message.type}/${message.kind}: ${message.body}`,
      ];
      if (message.kind === 'audit' && message.exit_code !== undefined) {
        lines.push(`exit code: ${message.exit_code}`);
      }
      if (message.kind === 'audit' && message.output_excerpt) {
        lines.push(`output: ${message.output_excerpt}`);
      }
      if (message.findings?.length) {
        lines.push(`Finding IDs: ${message.findings.map(finding => `${finding.id} (${finding.severity})`).join(', ')}`);
      }
      if (message.resolved_findings?.length) {
        lines.push(`Resolved finding IDs: ${message.resolved_findings.join(', ')}`);
      }
      return lines.join('\n');
    })
    .join('\n');
}

function requireForum(room: Room): PairForum {
  if (!room.forum) throw new Error('this room uses the legacy pairing protocol');
  return room.forum;
}

function requireForumDiscussionsResolved(forum: PairForum): void {
  if (forum.posts.some(p => (p.category === 'question' || p.category === 'clarification_needed') && !forum.posts.some(r => r.category === 'answer' && r.reply_to === p.id))) throw new Error('unanswered question or clarification');
  if (forum.posts.some(p => p.category === 'escalate' && !forum.posts.some(r => r.category === 'escalation_resolved' && r.reply_to === p.id))) throw new Error('unresolved escalation');
  if (forum.posts.some(p => p.category === 'escalation_candidate' && !forum.posts.some(r => (r.category === 'candidate_resolved' || r.category === 'escalate') && r.reply_to === p.id))) throw new Error('unresolved escalation candidate');
}

function forumSnapshot(root: string, paths: string[]): Record<string, string> {
  const base = realpathSync(root);
  const snapshot: Record<string, string> = {};
  let count = 0;
  const visit = (path: string): void => {
    if (++count > 10000) throw new Error('cannot verify review freshness: too many files');
    const relativePath = relative(base, path);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error('authorized path escapes workspace');
    let stat;
    try { stat = lstatSync(path); }
    catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') { snapshot[relativePath] = 'missing'; return; }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('cannot verify review freshness: authorized path contains a symlink');
    const real = realpathSync(path);
    const actual = relative(base, real);
    if (actual === '..' || actual.startsWith(`..${sep}`) || isAbsolute(actual)) throw new Error('authorized path resolves outside workspace');
    if (stat.isDirectory()) {
      snapshot[relativePath] = `directory:${stat.mode}`;
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else if (stat.isFile()) {
      if (stat.size > 10_000_000) throw new Error('cannot verify review freshness: file is too large');
      snapshot[relativePath] = createHash('sha256').update(`file:${stat.mode}:${stat.size}:`).update(readFileSync(path)).digest('hex');
    } else throw new Error('cannot verify review freshness: unsupported file type');
  };
  for (const path of [...paths].sort()) visit(resolve(base, path));
  return snapshot;
}

function forumFingerprint(root: string, paths: string[]): string {
  return createHash('sha256').update(JSON.stringify(forumSnapshot(root, paths))).digest('hex');
}

export async function openForum(root: string, roomId: string, sessionID: string, input: RoomOpenInput): Promise<Room> {
  const goal = requireNonEmptyRoomText(input.goal, 'goal');
  if (!Array.isArray(input.scope) || input.scope.length === 0 || input.scope.some(s => typeof s !== 'string' || !s.trim())) throw new Error('scope must list at least one acceptance scenario');
  if (!Array.isArray(input.authorized_paths) || input.authorized_paths.some(p => typeof p !== 'string' || !p.trim())) throw new Error('authorized_paths must be an array of non-empty paths');
  const baseline = forumSnapshot(root, input.authorized_paths);
  const directory = roomsDirectory(root);
  mkdirSync(directory, { recursive: true });
  const path = roomFilePath(root, roomId);
  const release = await acquireLock(lockFilePath(root, roomId));
  try {
    const previous = readRoomFile(path);
    if (previous) {
      requireHost(previous, sessionID);
      if (previous.status !== 'closed') throw new Error('a room already exists and is not closed');
      if (previous.members.some(member => member.role !== 'host' &&
        !(participantActivity(previous, member.role as PairRole)?.availability === 'finished' &&
          ['host', 'runtime'].includes(participantActivity(previous, member.role as PairRole)?.availability_source ?? '')))) {
        throw new Error('cannot start a new forum: previous participant termination is unconfirmed');
      }
      archiveRoomSnapshot(root, roomId, previous);
    } else if (existsSync(path)) throw new Error('cannot overwrite an unreadable room');
    const retired = previous ? [...new Set([...(previous.retired_sessions ?? []), ...previous.members.filter(m => m.role !== 'host').map(m => m.sessionID)])] : [];
    const room: Room = {
      id: roomId, status: 'open', generation: (previous?.generation ?? 0) + 1, goal,
      scope: [...input.scope], authorized_paths: [...input.authorized_paths], created_at: nowIso(),
      members: [{ sessionID, role: 'host' }], ...(retired.length ? { retired_sessions: retired } : {}),
      units: {}, messages: [], next_seq: 0, forum: { topics: [], posts: [], requests: {}, baseline },
    };
    writeRoomAtomically(directory, path, room);
    return room;
  } finally { release(); }
}

export function forumChanges(root: string, roomId: string, sessionID: string): string[] {
  const room = roomState(root, roomId);
  requireMember(room, sessionID);
  const baseline = requireForum(room).baseline;
  if (!baseline) throw new Error('forum baseline is unavailable');
  const current = forumSnapshot(root, room.authorized_paths);
  return [...new Set([...Object.keys(baseline), ...Object.keys(current)])].filter(path => {
    if (baseline[path] === current[path]) return false;
    return ![baseline[path], current[path]].every(value => value === undefined || value === 'missing' || value.startsWith('directory:'));
  }).sort();
}

export async function forumOpenTopics(root: string, roomId: string, sessionID: string, topics: ForumTopicInput[]): Promise<ForumTopic[]> {
  if (!Array.isArray(topics) || topics.length === 0) throw new Error('topics must be a non-empty array');
  return mutateRoom(root, roomId, room => {
    const member = requireMember(room, sessionID);
    if (member.role === 'host') throw new Error('only the driver or peer may open topics');
    requireRoomOpen(room, 'open topics');
    const forum = requireForum(room);
    const ids = new Set(forum.topics.map(t => t.id));
    const created = topics.map(input => {
      const id = requireNonEmptyRoomText(input.id, 'topic id');
      const title = requireNonEmptyRoomText(input.title, 'topic title');
      if (ids.has(id)) throw new Error(`topic "${id}" already exists`);
      if (!Array.isArray(input.scenarios) || input.scenarios.some(s => !room.scope.includes(s))) throw new Error('topic scenarios must belong to the room scope');
      if (input.paths !== undefined && (!Array.isArray(input.paths) || (input.paths.length === 0 && room.authorized_paths.length > 0) || input.paths.some(path => typeof path !== 'string' || path.trim() === '' || !room.authorized_paths.some(allowed => {
        const remainder = relative(resolve(root, allowed), resolve(root, path));
        return remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
      })))) throw new Error('topic paths must be within authorized paths');
      ids.add(id);
      return { id, title, scenarios: [...input.scenarios], ...(input.paths ? { paths: [...input.paths] } : {}), status: 'open' as const, revision: 0 };
    });
    forum.topics.push(...created);
    for (const topic of created) room.messages.push({
      id: randomUUID(), seq: room.next_seq++, role: member.role, sessionID, to: '*', unit: topic.id,
      type: 'topic_opened', kind: 'discussion', body: `topic opened: ${topic.id} — ${topic.title}`,
      created_at: nowIso(), read_by: [member.role],
    });
    return created;
  });
}

const FORUM_CATEGORIES: ForumCategory[] = ['comment', 'question', 'answer', 'ready_for_review', 'approved', 'changes_requested', 'clarification_needed', 'escalation_candidate', 'candidate_resolved', 'escalate', 'escalation_resolved', 'final_approved'];

const FORUM_DISCUSSION_CATEGORIES: ForumCategory[] = ['comment', 'question', 'answer', 'changes_requested', 'clarification_needed', 'escalation_candidate', 'candidate_resolved', 'escalate', 'escalation_resolved'];

function takeForumPosts(forum: PairForum, sessionID: string, topic: string | undefined, all: boolean, beforeSeq = Infinity): ForumPost[] {
  const reads = forum.reads ??= [];
  const posts = forum.posts.filter(post => {
    if ((topic !== undefined && post.topic !== topic) || post.seq >= beforeSeq) return false;
    const last = reads.find(read => read.sessionID === sessionID && read.topic === post.topic)?.seq ?? -1;
    return all || post.seq > last;
  });
  for (const post of posts) {
    let read = reads.find(entry => entry.sessionID === sessionID && entry.topic === post.topic);
    if (!read) { read = { sessionID, topic: post.topic, seq: -1 }; reads.push(read); }
    read.seq = Math.max(read.seq, post.seq);
  }
  return posts;
}

export async function forumReadTopic(root: string, roomId: string, sessionID: string, topicId: string, all = false) {
  return mutateRoom(root, roomId, room => {
    requireMember(room, sessionID);
    const forum = requireForum(room);
    const topic = forum.topics.find(entry => entry.id === topicId);
    if (!topic) throw new Error('unknown topic');
    const discussion = forum.posts.filter(post => post.topic === topicId && FORUM_DISCUSSION_CATEGORIES.includes(post.category));
    const bytes = discussion.reduce((total, post) => total + Buffer.byteLength(post.message, 'utf8'), 0);
    const warning = discussion.length >= 20 || bytes >= 32768;
    return { topic, posts: takeForumPosts(forum, sessionID, topicId, all), discussion: {
      count: discussion.length, bytes, warning,
      ...(warning ? { guidance: 'Keep discussion focused: resolve the remaining point or consider an escalation candidate if agreement is not possible. This is not a limit.' } : {}),
    } };
  });
}

export async function forumPost(root: string, roomId: string, sessionID: string, input: { posts: ForumPostInput[]; request_id?: string }): Promise<ForumPost[]> {
  if (!Array.isArray(input.posts) || input.posts.length === 0 || input.posts.length > 50) throw new Error('posts must contain 1 to 50 entries');
  return mutateRoom(root, roomId, room => {
    const member = requireMember(room, sessionID);
    const forum = requireForum(room);
    const hash = createHash('sha256').update(JSON.stringify(input.posts)).digest('hex');
    const requestKey = input.request_id ? `${sessionID}:${input.request_id}` : '';
    const previous = requestKey ? forum.requests[requestKey] : undefined;
    if (previous) {
      if (previous.hash !== hash) throw new Error('request_id was already used for different posts');
      return previous.post_ids.map(id => forum.posts.find(post => post.id === id)!);
    }
    requireRoomOpen(room, 'post');
    const added: ForumPost[] = [];
    for (const [index, item] of input.posts.entries()) {
      const topic = forum.topics.find(t => t.id === item.topic);
      if (!topic) throw new Error(`unknown topic "${item.topic}"`);
      if (!FORUM_CATEGORIES.includes(item.category)) throw new Error('invalid post category');
      const message = requireNonEmptyRoomText(item.message, 'message');
      if (item.reply_to && !forum.posts.some(p => p.id === item.reply_to && p.topic === topic.id)) throw new Error('reply_to must refer to a post in this topic');
      if (item.category === 'final_approved' && index !== input.posts.length - 1) throw new Error('final approval must be the last post in a batch');
      if (['candidate_resolved', 'escalation_resolved'].includes(item.category)) {
        const target = forum.posts.find(p => p.id === item.reply_to && p.topic === topic.id);
        const expected = item.category === 'candidate_resolved' ? 'escalation_candidate' : 'escalate';
        if (!target || target.category !== expected) throw new Error(`${item.category} must reply to ${expected}`);
      }
      if (item.category === 'ready_for_review') {
        if (member.role !== 'driver') throw new Error('only the driver may request review');
        topic.fingerprint = forumFingerprint(root, topic.paths ?? room.authorized_paths);
        topic.revision += 1; topic.status = 'ready'; delete forum.final_requested; delete room.reconciliation;
      }
      if (['approved', 'changes_requested', 'clarification_needed'].includes(item.category)) {
        if (member.role !== 'peer') throw new Error('only the peer may review');
        if (topic.status !== 'ready') throw new Error('topic is not ready for review');
        if (item.revision !== topic.revision) throw new Error(`stale review: current revision is ${topic.revision}`);
        if (topic.fingerprint !== forumFingerprint(root, topic.paths ?? room.authorized_paths)) throw new Error('review is stale: authorized files changed');
      }
      if (item.category === 'approved') {
        if (!item.evidence || !item.evidence.command?.trim() || item.evidence.exit_code !== 0 || !item.evidence.output?.trim()) throw new Error('approval requires a passing independent command and output');
        topic.status = 'approved';
      }
      if (item.category === 'changes_requested') topic.status = 'open';
      if (forum.final_requested && ['question', 'changes_requested', 'clarification_needed', 'escalation_candidate', 'escalate'].includes(item.category)) delete forum.final_requested;
      if (item.category === 'escalation_resolved' && member.role !== 'host') throw new Error('only the host may resolve an escalation');
      if (item.category === 'final_approved') {
        if (member.role !== 'peer' || !forum.final_requested) throw new Error('only the peer may approve the requested final review');
        if (!item.evidence || !item.evidence.command?.trim() || item.evidence.exit_code !== 0 || !item.evidence.output?.trim()) throw new Error('final approval requires a passing suite command and output');
        if (!room.reconciliation?.reconciled) throw new Error('both participants must reconcile files before final approval');
        if (forum.topics.some(t => t.status !== 'approved')) throw new Error('all topics must be approved');
        requireForumDiscussionsResolved(forum);
        if (forum.final_fingerprint !== forumFingerprint(root, room.authorized_paths)) throw new Error('final review is stale: authorized files changed');
        room.status = 'closed';
      }
      const post: ForumPost = { id: randomUUID(), seq: room.next_seq, topic: topic.id, category: item.category, message, role: member.role, revision: topic.revision, ...(item.reply_to ? { reply_to: item.reply_to } : {}), ...(item.evidence ? { evidence: item.evidence } : {}) };
      forum.posts.push(post); added.push(post);
      room.messages.push({ id: post.id, seq: room.next_seq++, role: member.role, sessionID, to: item.category === 'escalate' || item.category === 'escalation_resolved' ? 'all' : '*', unit: topic.id, type: item.category, kind: 'discussion', body: `${item.category}: ${message}${item.evidence ? `\ncommand: ${item.evidence.command}\nexit code: ${item.evidence.exit_code}\noutput: ${item.evidence.output}` : ''}`, created_at: nowIso(), read_by: [member.role] });
    }
    if (requestKey) forum.requests[requestKey] = { sessionID, hash, post_ids: added.map(post => post.id) };
    return added;
  });
}

export async function forumRequestFinish(root: string, roomId: string, sessionID: string, summary: string): Promise<Room> {
  return mutateRoom(root, roomId, room => {
    const member = requireMember(room, sessionID);
    if (member.role !== 'driver') throw new Error('only the driver may request final review');
    requireRoomOpen(room, 'request final review');
    const forum = requireForum(room);
    if (forum.topics.length === 0 || forum.topics.some(t => t.status !== 'approved')) throw new Error('all topics must be approved before final review');
    const currentFingerprint = forumFingerprint(root, room.authorized_paths);
    if (forum.topics.some(t => t.fingerprint !== forumFingerprint(root, t.paths ?? room.authorized_paths))) throw new Error('approved review is stale: authorized files changed');
    if (room.scope.some(scenario => !forum.topics.some(t => t.status === 'approved' && t.scenarios.includes(scenario)))) throw new Error('all scenarios need approved review coverage');
    requireForumDiscussionsResolved(forum);
    forum.final_requested = true;
    forum.final_fingerprint = currentFingerprint;
    delete room.reconciliation;
    room.messages.push({ id: randomUUID(), seq: room.next_seq++, role: member.role, sessionID, to: 'peer', unit: '', type: 'ready_for_final_audit', kind: 'discussion', body: `final review requested: ${requireNonEmptyRoomText(summary, 'summary')}`, created_at: nowIso(), read_by: [member.role] });
    return room;
  });
}

export async function forumReplaceParticipant(root: string, roomId: string, sessionID: string, input: { role: PairRole; participant_session: string; generation: number; reason: string }): Promise<Room> {
  const reason = requireNonEmptyRoomText(input.reason, 'reason');
  return mutateRoom(root, roomId, room => {
    requireHost(room, sessionID);
    requireForum(room);
    requireRoomOpen(room, 'replace a participant');
    if ((room.generation ?? 1) !== input.generation) throw new Error('generation is stale');
    const member = room.members.find(m => m.role === input.role && m.sessionID === input.participant_session);
    if (!member) throw new Error('participant session does not match the current role');
    const activity = participantActivity(room, input.role);
    if (activity?.availability !== 'finished' || !['host', 'runtime'].includes(activity.availability_source ?? '')) throw new Error('participant completion is not confirmed');
    room.members = room.members.filter(m => m !== member);
    room.retired_sessions = [...new Set([...(room.retired_sessions ?? []), member.sessionID])];
    if (room.activities) delete room.activities[input.role];
    insertRoomEvent(room, sessionID, 'host', 'participant_replaced', `${input.role} ${member.sessionID} retired: ${reason}; replacement must join`);
    return room;
  });
}

export const internals = {
  openForum,
  forumChanges,
  forumReadTopic,
  forumOpenTopics,
  forumPost,
  forumRequestFinish,
  forumReplaceParticipant,
  roomIdForSession,
  openRoom,
  joinRoom,
  sendMessage,
  readInbox,
  waitForUpdates,
  setParticipantActivity,
  applyParticipantLifecycle,
  stopRoom,
  roomUpdateCursor,
  INBOX_DEFAULT_WAIT_S,
  roomState,
  closeUnit,
  recordEvidence,
  auditUnit,
  escalateRoom,
  resolveRoomEscalation,
  abortRoom,
  resetRoom,
  reconcileFiles,
  endRoom,
  ackRoom,
  transcript,
  roomFilePath,
  renderRoomState,
  renderTranscript,
  messageTargetsRole,
  discussionCount,
  buildRoomNotice,
  createRoomNoticeHook,
  MAX_DISCUSSION_MESSAGES,
  MAX_CORRECTION_ROUNDS,
};

interface ToolContext {
  sessionID?: string;
  agent?: string;
  messageID?: string;
  id?: string;
  signal?: unknown;
  progress?: unknown;
}

type RoomToolHandler = (
  rootDir: string,
  roomId: string,
  sessionID: string,
  input: Record<string, unknown>,
  context?: ToolContext,
) => string | Promise<string>;

function asInputRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function createRoomToolExecute(
  defaultDirectory: string,
  session: RoomSessionApi,
  handler: RoomToolHandler,
  name = '',
) {
  return async function executeRoomTool(
    input: unknown,
    context?: ToolContext,
  ): Promise<ToolExecuteResult> {
    const workspace = resolve(defaultDirectory);
    try {
      const sessionID = context?.sessionID;
      if (typeof sessionID !== 'string' || sessionID === '') {
        throw new Error('room tools require a session context');
      }
      if (!session || typeof session.get !== 'function') {
        throw new Error('the session API is unavailable; room tools cannot resolve the room');
      }
      const roomId = await roomIdForSession(session, sessionID);
      if (!['pas_pair_feed', 'pas_pair_room', 'pas_pair_topic', 'pas_room_inbox', 'pas_room_state', 'pas_room_transcript', 'pas_room_activity', 'pas_room_join',
        'pas_room_stop', 'pas_room_abort', 'pas_room_reset', 'pas_room_resolve_escalation'].includes(name)) {
        const current = readRoomFile(roomFilePath(workspace, roomId));
        const member = current && findMember(current, sessionID);
        if (current?.status === 'open' && member && member.role !== 'host' && participantActivity(current, member.role)?.availability === 'active') {
          await setParticipantActivity(workspace, roomId, sessionID, { state: 'working' });
        }
      }
      const content = await handler(workspace, roomId, sessionID, asInputRecord(input), context);
      return { content: `${content}\nWorkspace: ${workspace}` };
    } catch (error) {
      return { content: `ERROR: ${describeError(error)}\nWorkspace: ${workspace}` };
    }
  };
}

interface RegisteredTool {
  name: string;
  description: string;
  input: unknown;
  execute: (input: unknown, context?: ToolContext) => Promise<ToolExecuteResult>;
}

interface SessionHookApi {
  hook(name: string, callback: (event: RoomNoticeHookEvent) => unknown): Promise<unknown>;
}

interface PluginContext {
  location?: { directory?: string };
  session: RoomSessionApi & Partial<SessionHookApi>;
  event?: { subscribe(options: { types: string[]; signal: AbortSignal }): AsyncIterable<{ type: string; created: number; data: { sessionID: string }; location?: { directory?: string } }> };
  tool: {
    transform(callback: (editor: { add(tool: RegisteredTool): void }) => void): unknown;
  };
}

export default {
  id: 'pas-toolkit',
  async setup(ctx: PluginContext): Promise<void | (() => void)> {
    const locationDirectory = ctx.location?.directory;
    const defaultDirectory =
      typeof locationDirectory === 'string' && locationDirectory.trim() !== '' ? locationDirectory : process.cwd();

    const sessionHook = ctx.session.hook;
    if (typeof sessionHook === 'function') {
      const noticeHook = createRoomNoticeHook(defaultDirectory, ctx.session);
      await sessionHook.call(ctx.session, 'context', noticeHook);
      await sessionHook.call(ctx.session, 'compaction', noticeHook);
    }

    const execute = createToolExecute(defaultDirectory);
    const lifecycleController = new AbortController();
    if (ctx.event?.subscribe) {
      const events = ctx.event.subscribe({
        types: ['session.execution.started'],
        signal: lifecycleController.signal,
      });
      void (async () => {
        try {
          for await (const event of events) {
            if (lifecycleController.signal.aborted) break;
            if (event.location?.directory && resolve(event.location.directory) !== resolve(defaultDirectory)) continue;
            try {
              if (event.type !== 'session.execution.started') continue;
              const roomId = await boundedRequest(() => roomIdForSession(ctx.session, event.data.sessionID), SESSION_READ_TIMEOUT_MS);
              if (lifecycleController.signal.aborted) break;
              await applyParticipantLifecycle(defaultDirectory, roomId, event.data.sessionID, 'active', event.created);
            } catch { /* Ignore unrelated sessions and stale/unavailable rooms. */ }
          }
        } catch { /* Subscription cancellation must not break the plugin. */ }
      })();
    }
    await ctx.tool.transform((editor) => {
      editor.add({
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        input: TOOL_INPUT_SCHEMA,
        execute,
      });

      const registerRoomTool = (
        name: string,
        description: string,
        input: unknown,
        handler: RoomToolHandler,
      ): void => {
        editor.add({
          name,
          description,
          input,
          execute: createRoomToolExecute(defaultDirectory, ctx.session, handler, name),
        });
      };

      registerRoomTool('pas_pair_room', 'Create, join or inspect a pairing forum; request final review or use host recovery controls.', {
        type: 'object', properties: {
          action: { enum: ['create', 'join', 'status', 'changes', 'finish', 'reconcile', 'report_completion', 'replace', 'interrupt', 'cancel', 'restart'] },
          goal: { type: 'string' }, scope: { type: 'array', items: { type: 'string' } },
          authorized_paths: { type: 'array', items: { type: 'string' } }, role: { enum: ['driver', 'peer'] },
          summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' }, target: { enum: ['driver', 'peer', 'both'] }, participant_session: { type: 'string' }, generation: { type: 'integer' },
        }, required: ['action'], additionalProperties: false,
      }, async (root, roomId, sessionID, input) => {
        switch (input.action) {
          case 'create': return JSON.stringify(await openForum(root, roomId, sessionID, { goal: String(input.goal ?? ''), scope: stringList(input.scope), authorized_paths: stringList(input.authorized_paths) }));
          case 'join': {
            if (input.role !== 'driver' && input.role !== 'peer') throw new Error('role must be driver or peer');
            requireForum(roomState(root, roomId));
            const room = await joinRoom(root, roomId, sessionID, { role: input.role });
            requireForum(room); return JSON.stringify(room);
          }
          case 'status': { const room = roomState(root, roomId); requireMember(room, sessionID); return JSON.stringify(room); }
          case 'changes': return JSON.stringify(forumChanges(root, roomId, sessionID));
          case 'finish': return JSON.stringify(await forumRequestFinish(root, roomId, sessionID, String(input.summary ?? '')));
          case 'reconcile': return JSON.stringify(await reconcileFiles(root, roomId, sessionID, { files: input.files as string[] }));
          case 'report_completion': {
            const snapshot = roomState(root, roomId); requireHost(snapshot, sessionID); requireForum(snapshot);
            if ((input.target !== 'driver' && input.target !== 'peer') || typeof input.participant_session !== 'string' || input.generation !== (snapshot.generation ?? 1) || !snapshot.members.some(m => m.role === input.target && m.sessionID === input.participant_session)) throw new Error('completion requires the exact current participant and generation');
            const info = await boundedRequest(signal => ctx.session.get({ sessionID: input.participant_session as string }, { signal }), SESSION_READ_TIMEOUT_MS);
            if (info.id !== input.participant_session || info.time?.idle === undefined || (info.time.busy !== undefined && info.time.busy > info.time.idle)) throw new Error('runtime does not confirm participant completion');
            return JSON.stringify(await setParticipantActivity(root, roomId, sessionID, { state: 'finished', target: input.target, participant_session: input.participant_session, expected_generation: input.generation as number, reason: String(input.reason ?? '') }, info.time.idle));
          }
          case 'replace': {
            if ((input.target !== 'driver' && input.target !== 'peer') || typeof input.participant_session !== 'string' || typeof input.generation !== 'number') throw new Error('replacement requires target, participant_session and generation');
            return JSON.stringify(await forumReplaceParticipant(root, roomId, sessionID, { role: input.target, participant_session: input.participant_session, generation: input.generation, reason: String(input.reason ?? '') }));
          }
          case 'interrupt': return JSON.stringify(await stopRoom(root, roomId, sessionID, { reason: String(input.reason ?? ''), target: String(input.target ?? 'both'), ...(typeof input.generation === 'number' ? { expected_generation: input.generation } : {}) }, ctx.session));
          case 'cancel': return JSON.stringify(await abortRoom(root, roomId, sessionID, { reason: String(input.reason ?? '') }));
          case 'restart': return JSON.stringify(await resetRoom(root, roomId, sessionID, { reason: String(input.reason ?? '') }));
          default: throw new Error('invalid room action');
        }
      });

      registerRoomTool('pas_pair_topic', 'Open or list topics; read returns unread posts for this session, or all posts with all=true.', {
        type: 'object', properties: {
          action: { enum: ['open', 'list', 'read'] },
          topics: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, scenarios: { type: 'array', items: { type: 'string' } }, paths: { type: 'array', items: { type: 'string' } } }, required: ['id', 'title', 'scenarios'], additionalProperties: false } },
          topic: { type: 'string' },
          all: { type: 'boolean' },
        }, required: ['action'], additionalProperties: false,
      }, async (root, roomId, sessionID, input) => {
        if (input.action === 'open') return JSON.stringify(await forumOpenTopics(root, roomId, sessionID, input.topics as ForumTopicInput[]));
        const room = roomState(root, roomId); requireMember(room, sessionID); const forum = requireForum(room);
        if (input.action === 'list') return JSON.stringify(forum.topics);
        if (input.action === 'read') return JSON.stringify(await forumReadTopic(root, roomId, sessionID, String(input.topic ?? ''), input.all === true));
        throw new Error('invalid topic action');
      });

      registerRoomTool('pas_pair_post', 'Post a message, review or escalation; batches are atomic and request_id makes retries idempotent.', {
        type: 'object', properties: {
          request_id: { type: 'string' }, posts: { type: 'array', items: { type: 'object', properties: {
            topic: { type: 'string' }, category: { enum: FORUM_CATEGORIES }, message: { type: 'string' }, reply_to: { type: 'string' }, revision: { type: 'integer' },
            evidence: { type: 'object', properties: { command: { type: 'string' }, exit_code: { type: 'integer' }, output: { type: 'string' } }, required: ['command', 'exit_code', 'output'], additionalProperties: false },
          }, required: ['topic', 'category', 'message'], additionalProperties: false } },
        }, required: ['posts'], additionalProperties: false,
      }, async (root, roomId, sessionID, input) => JSON.stringify(await forumPost(root, roomId, sessionID, { posts: input.posts as ForumPostInput[], ...(typeof input.request_id === 'string' ? { request_id: input.request_id } : {}) })));

      registerRoomTool('pas_pair_feed', 'Read updates or wait for new posts and room changes. Reuse cursor; timeout is not failure.', {
        type: 'object', properties: { cursor: { type: 'string' }, wait_seconds: { type: 'number' }, waiting_for: { type: 'string' } }, additionalProperties: false,
      }, async (root, roomId, sessionID, input, context) => {
        const initial = roomState(root, roomId);
        requireMember(initial, sessionID);
        const initialForum = requireForum(initial);
        const hasUnread = initialForum.posts.some(post => post.seq > (initialForum.reads?.find(read => read.sessionID === sessionID && read.topic === post.topic)?.seq ?? -1));
        const result = await waitForUpdates(root, roomId, sessionID, {
          ...(typeof input.cursor === 'string' ? { cursor: input.cursor } : {}),
          ...(hasUnread ? { wait_s: 0 } : typeof input.wait_seconds === 'number' ? { wait_s: input.wait_seconds } : {}),
          ...(typeof input.waiting_for === 'string' ? { waiting_for: input.waiting_for } : {}),
        }, { now: Date.now, sleep, ...(typeof context?.signal === 'object' && context.signal !== null && 'aborted' in context.signal ? { signal: context.signal as { readonly aborted: boolean } } : {}) });
        const snapshot = result.state;
        const posts = await mutateRoom(root, roomId, room => {
          requireMember(room, sessionID);
          if (room.generation !== snapshot.generation) return [];
          return takeForumPosts(requireForum(room), sessionID, undefined, false, snapshot.next_seq);
        });
        const postIds = new Set(requireForum(snapshot).posts.map(post => post.id));
        const { messages: _messages, forum: snapshotForum, ...state } = snapshot;
        const { posts: _posts, requests: _requests, reads: _reads, baseline: _baseline, ...forumState } = snapshotForum!;
        return JSON.stringify({ ...result, posts, messages: result.messages.filter(message => !postIds.has(message.id)), updates: result.updates.filter(message => !postIds.has(message.id)), state: { ...state, forum: forumState }, changed: result.changed || posts.length > 0, timed_out: result.timed_out && posts.length === 0 });
      });

      registerRoomTool(
        'pas_room_open',
        'Open a pairing room as host. The caller becomes host; scope lists the acceptance scenarios (units).',
        {
          type: 'object',
          properties: {
            goal: { type: 'string' },
            scope: { type: 'array', items: { type: 'string' } },
            authorized_paths: { type: 'array', items: { type: 'string' } },
          },
          required: ['goal', 'scope', 'authorized_paths'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const room = await openRoom(root, roomId, sessionID, {
            goal: typeof input.goal === 'string' ? input.goal : '',
            scope: stringList(input.scope),
            authorized_paths: stringList(input.authorized_paths),
          });
          return `Room opened.\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_join',
        'Join an existing pairing room as driver or peer. Idempotent per session.',
        {
          type: 'object',
          properties: { role: { enum: ['driver', 'peer'] } },
          required: ['role'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const role = input.role;
          if (role !== 'driver' && role !== 'peer') {
            throw new Error('role must be "driver" or "peer"');
          }
          const room = await joinRoom(root, roomId, sessionID, { role });
          return `Joined as ${role}.\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_send',
        'Send a room message addressed to an agent name or "*". An "open" message creates the unit.',
        {
          type: 'object',
          properties: {
            to: { type: 'string' },
            unit: { type: 'string' },
            type: { enum: ['open', 'reply', 'challenge', 'propose_close', 'ready_for_final_audit', 'reopen'] },
            body: { type: 'string' },
            reply_to: { type: 'string' },
          },
          required: ['to', 'unit', 'type', 'body'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const message = await sendMessage(root, roomId, sessionID, {
            to: typeof input.to === 'string' ? input.to : '',
            unit: typeof input.unit === 'string' ? input.unit : '',
            type: typeof input.type === 'string' ? input.type : '',
            body: typeof input.body === 'string' ? input.body : '',
            ...(typeof input.reply_to === 'string' ? { reply_to: input.reply_to } : {}),
          });
          return `Sent #${message.seq} (${message.type}/${message.kind}) on "${message.unit}".`;
        },
      );

      registerRoomTool(
        'pas_room_inbox',
        'Wait up to 10 seconds by default (max 60). Returns early for messages, progress, MUTUAL_WAIT or PEER_UNAVAILABLE. Reuse cursor; waiting_for names the dependency. Mutual wait requires the elected agent to act, not blindly wait again.',
        {
          type: 'object',
          properties: {
            unit: { type: 'string' },
            wait_s: { type: 'number' },
            cursor: { type: 'string' },
            waiting_for: { type: 'string' },
          },
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input, context) => {
          const result = await waitForUpdates(root, roomId, sessionID, {
            ...(typeof input.unit === 'string' ? { unit: input.unit } : {}),
            ...(typeof input.wait_s === 'number' ? { wait_s: input.wait_s } : {}),
            ...(typeof input.cursor === 'string' ? { cursor: input.cursor } : {}),
            ...(typeof input.waiting_for === 'string' ? { waiting_for: input.waiting_for } : {}),
          }, {
            now: Date.now, sleep,
            ...(typeof context?.signal === 'object' && context.signal !== null && 'aborted' in context.signal
              ? { signal: context.signal as { readonly aborted: boolean } } : {}),
          });
          const delivered = [...new Map(
            [...result.updates, ...result.messages].map(message => [message.id, message]),
          ).values()];
          const status = result.notice === 'MUTUAL_WAIT'
            ? `MUTUAL_WAIT — ${result.action_owner} must act or clarify the last request; do not blindly wait again.`
            : result.notice === 'PEER_UNAVAILABLE'
              ? `PEER_UNAVAILABLE — ${unavailableParticipants(result.state, sessionID).join(', ')} finished or unavailable. Room messages do not restart it; host recovery is required.`
              : result.timed_out
            ? result.action_owner
              ? `No progress before timeout; both participants remain waiting. ${result.action_owner} must act or clarify the request, not blindly wait again.`
              : 'No updates before timeout; wait again if work is pending.'
            : result.changed ? 'Room updated.' : 'No unread messages.';
          return [status, ...(delivered.length ? [renderTranscript(delivered)] : []), renderRoomState(result.state)].join('\n');
        },
      );

      registerRoomTool(
        'pas_room_state',
        'Return the pairing room summary: status, per-unit state, evidence counts, suite audit, unread counts and anomalies.',
        { type: 'object', properties: {}, additionalProperties: false },
        (root, roomId) => renderRoomState(roomState(root, roomId)),
      );

      registerRoomTool(
        'pas_room_activity',
        'Declare your working/waiting state with waiting_for. Host may report finished/unavailable only for an exact participant_session and expected_generation, with a reason; this never resumes execution.',
        {
          type: 'object', properties: {
            state: { enum: ['working', 'waiting_for_response', 'finished', 'unavailable'] },
            waiting_for: { type: 'string' }, unit: { type: 'string' },
            target: { enum: ['driver', 'peer'] }, participant_session: { type: 'string' },
            expected_generation: { type: 'integer' }, reason: { type: 'string' },
          }, required: ['state'], additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const request = input as unknown as RoomActivityInput;
          const snapshot = roomState(root, roomId);
          let observedAt = Date.now();
          if (findMember(snapshot, sessionID)?.role === 'host' && request.state === 'finished' && request.participant_session) {
            if (request.expected_generation !== (snapshot.generation ?? 1) ||
              !snapshot.members.some(member => member.role === request.target && member.sessionID === request.participant_session)) {
              throw new Error('host completion report must match the exact current participant session and generation');
            }
            const info = await boundedRequest(signal => ctx.session.get({ sessionID: request.participant_session! }, { signal }), SESSION_READ_TIMEOUT_MS);
            if (info.id !== request.participant_session || info.time?.idle === undefined ||
              (info.time.busy !== undefined && info.time.busy > info.time.idle)) {
              throw new Error('runtime does not confirm this participant finished; room messages do not stop or resume it');
            }
            observedAt = info.time.idle;
          }
          const room = await setParticipantActivity(root, roomId, sessionID, request, observedAt);
          return `Activity recorded.\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_stop',
        'Host killswitch: abort room and interrupt current driver, peer or both (default), resume=false. Reason required; use expected_generation against stale requests. Returns per-session results within bounded runtime deadlines; no rollback, deletion or automatic replacement.',
        {
          type: 'object', properties: {
            target: { enum: ['driver', 'peer', 'both'] }, reason: { type: 'string' }, expected_generation: { type: 'integer' },
          }, required: ['reason'], additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const room = await stopRoom(root, roomId, sessionID, input as unknown as RoomStopInput, ctx.session);
          return `Killswitch recorded; inspect each runtime result before replacement.\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_evidence',
        'Record reproducible checks (red|green|refactor|verification|manual|suite). Use verification for existing behavior without a new TDD cycle. Explicit TDD green requires red; acceptance auditing does not. Only the peer records the final suite.',
        {
          type: 'object',
          properties: {
            unit: { type: 'string' },
            stage: { enum: ['red', 'green', 'refactor', 'verification', 'manual', 'suite'] },
            command: { type: 'string' },
            exit_code: { type: 'integer' },
            output_excerpt: { type: 'string' },
            actor: { type: 'string' },
          },
          required: ['unit', 'stage', 'command', 'exit_code', 'output_excerpt'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const message = await recordEvidence(root, roomId, sessionID, {
            unit: typeof input.unit === 'string' ? input.unit : '',
            stage: typeof input.stage === 'string' ? input.stage : '',
            command: typeof input.command === 'string' ? input.command : undefined,
            exit_code: typeof input.exit_code === 'number' ? input.exit_code : undefined,
            output_excerpt:
              typeof input.output_excerpt === 'string' ? input.output_excerpt : undefined,
            ...(typeof input.actor === 'string' ? { actor: input.actor } : {}),
          });
          return `Recorded ${message.evidence?.stage} evidence #${message.seq} for "${message.unit}".`;
        },
      );

      registerRoomTool(
        'pas_room_audit',
        'Peer only: audit one open unit. Use findings: [] when there are no findings. Closure requires a current command, exit_code and output_excerpt. Reuse a check across covered units; record each unit separately. resolves lists verified finding IDs.',
        {
          type: 'object',
          properties: {
            unit: { type: 'string' },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  category: {
                    enum: ['process', 'evidence', 'quality', 'cruft', 'skill', 'ui', 'test', 'scope'],
                  },
                  severity: { enum: ['blocking', 'major', 'minor', 'info'] },
                  detail: { type: 'string' },
                },
                required: ['category', 'severity', 'detail'],
                additionalProperties: false,
              },
            },
            command: { type: 'string' },
            exit_code: { type: 'integer' },
            output_excerpt: { type: 'string' },
            resolves: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
          },
          required: ['unit', 'findings'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const message = await auditUnit(root, roomId, sessionID, {
            unit: typeof input.unit === 'string' ? input.unit : '',
            findings: Array.isArray(input.findings)
              ? (input.findings as RoomAuditInput['findings'])
              : [],
            ...(typeof input.command === 'string' ? { command: input.command } : {}),
            ...(typeof input.exit_code === 'number' ? { exit_code: input.exit_code } : {}),
            ...(typeof input.output_excerpt === 'string' ? { output_excerpt: input.output_excerpt } : {}),
            ...(Array.isArray(input.resolves) ? { resolves: input.resolves as string[] } : {}),
            ...(typeof input.note === 'string' ? { note: input.note } : {}),
          });
          return `Recorded audit #${message.seq} with ${message.findings?.length ?? 0} finding(s) for "${message.unit}".\n${message.findings?.map(finding => `${finding.id}: [${finding.severity}/${finding.category}] ${finding.detail}`).join('\n')}`;
        },
      );

      registerRoomTool(
        'pas_room_escalate',
        'Driver or peer: escalate to the host with an action (re_delegate|fix_brief|escalate_to_user) and a reason. Returns immediately; while pending it blocks close, end and ack.',
        {
          type: 'object',
          properties: {
            action: { enum: ['re_delegate', 'fix_brief', 'escalate_to_user'] },
            reason: { type: 'string' },
            unit: { type: 'string' },
            evidence: { type: 'string' },
          },
          required: ['action', 'reason'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const room = await escalateRoom(root, roomId, sessionID, {
            action: typeof input.action === 'string' ? input.action : '',
            reason: typeof input.reason === 'string' ? input.reason : '',
            ...(typeof input.unit === 'string' ? { unit: input.unit } : {}),
            ...(typeof input.evidence === 'string' ? { evidence: input.evidence } : {}),
          });
          return `Escalated (${room.escalation?.action}); close, end and ack are blocked until the host resolves it.\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_resolve_escalation',
        'Resolve a pending escalation as the host with a non-empty decision. Records the decision in the transcript and clears the blocker.',
        {
          type: 'object',
          properties: { resolution: { type: 'string' } },
          required: ['resolution'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const room = await resolveRoomEscalation(root, roomId, sessionID, {
            resolution: typeof input.resolution === 'string' ? input.resolution : '',
          });
          return `Escalation resolved.\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_abort',
        'Abort an open or awaiting-ack room as the host, even with a pending escalation. Records a reason and sets terminal status "aborted" without claiming successful completion.',
        {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const room = await abortRoom(root, roomId, sessionID, {
            reason: typeof input.reason === 'string' ? input.reason : '',
          });
          return `Room aborted.\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_reset',
        'Archive the current generation and start a fresh one as the host. Preserves the goal, scope, and authorized paths, retires prior worker sessions, and requires a reason.',
        {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const result = await resetRoom(root, roomId, sessionID, {
            reason: typeof input.reason === 'string' ? input.reason : '',
          });
          return `Room reset. Previous generation archived at ${result.archivedPath}.\n${renderRoomState(result.room)}`;
        },
      );

      registerRoomTool(
        'pas_room_reconcile',
        'Driver or peer: submit this agent\'s changed-file list. Both must submit identical lists (compared as sets) before the ack is accepted; re-submitting replaces that agent\'s own list.',
        {
          type: 'object',
          properties: { files: { type: 'array', items: { type: 'string' } } },
          required: ['files'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const room = await reconcileFiles(root, roomId, sessionID, {
            files: stringList(input.files),
          });
          return `Reconciliation: ${room.reconciliation?.reconciled ? 'reconciled' : 'not reconciled'}.\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_close',
        'Close a unit. Driver only; rejects unread messages and requires dissent over an unanswered challenge.',
        {
          type: 'object',
          properties: {
            unit: { type: 'string' },
            resolution: { type: 'string' },
            dissent: { type: 'string' },
          },
          required: ['unit', 'resolution'],
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const unit = await closeUnit(root, roomId, sessionID, {
            unit: typeof input.unit === 'string' ? input.unit : '',
            resolution: typeof input.resolution === 'string' ? input.resolution : '',
            ...(typeof input.dissent === 'string' ? { dissent: input.dissent } : {}),
          });
          const dissent = unit.dissent ? ` with dissent: ${unit.dissent}` : '';
          return `Closed unit "${unit.id}"${dissent}.`;
        },
      );

      registerRoomTool(
        'pas_room_end',
        'Driver only: end the room, set it awaiting the peer ack, and wait up to wait_s seconds (default 30, maximum 60) for that ack. Every unit must be closed and the peer full-suite audit must be green. Without an ack the room stays awaiting_ack.',
        {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            wait_s: { type: 'number' },
          },
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const room = await endRoom(root, roomId, sessionID, {
            ...(typeof input.summary === 'string' ? { summary: input.summary } : {}),
            ...(typeof input.wait_s === 'number' ? { wait_s: input.wait_s } : {}),
          });
          const note =
            room.status === 'closed'
              ? 'The peer acknowledged; the room is closed.'
              : 'The peer did not acknowledge within the wait window; the room stays awaiting_ack.';
          return `${note}\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_ack',
        'Peer only: acknowledge the driver end request. Only valid while the room is awaiting_ack; closes the room.',
        {
          type: 'object',
          properties: { summary: { type: 'string' } },
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const room = await ackRoom(root, roomId, sessionID, {
            ...(typeof input.summary === 'string' ? { summary: input.summary } : {}),
          });
          return `Acknowledged; the room is closed.\n${renderRoomState(room)}`;
        },
      );

      registerRoomTool(
        'pas_room_transcript',
        'Return the full ordered pairing-room transcript.',
        { type: 'object', properties: {}, additionalProperties: false },
        (root, roomId) => renderTranscript(transcript(root, roomId)),
      );
    });
    return () => lifecycleController.abort();
  },
};
