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

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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
export const MAX_DISCUSSION_MESSAGES = 16;
const ROOMS_RELATIVE_PATH = join('.pas', 'rooms');
const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 5000;
const INBOX_POLL_MS = 250;
const INBOX_MAX_WAIT_S = 60;
const END_DEFAULT_WAIT_S = 30;
const END_MAX_WAIT_S = 60;
const ACK_POLL_MS = 100;
const ROOM_MESSAGE_TYPES = ['open', 'reply', 'challenge', 'propose_close', 'ack'] as const;

const EVIDENCE_STAGES = ['red', 'green', 'refactor', 'manual', 'suite'] as const;
const FINDING_CATEGORIES = ['process', 'evidence', 'quality', 'cruft', 'skill', 'ui', 'test', 'scope'] as const;
const FINDING_SEVERITIES = ['blocking', 'major', 'minor', 'info'] as const;
const ESCALATION_ACTIONS = ['re_delegate', 'fix_brief', 'escalate_to_user'] as const;

/** Blocking audits allowed per unit before the only exit is an escalation. */
export const MAX_CORRECTION_ROUNDS = 3;

export type RoomRole = 'host' | 'driver' | 'peer';
export type RoomStatus = 'open' | 'awaiting_ack' | 'closed';
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
  note?: string;
  created_at: string;
  read_by: RoomRole[];
}

export interface Room {
  id: string;
  status: RoomStatus;
  goal: string;
  scope: string[];
  authorized_paths: string[];
  created_at: string;
  members: RoomMember[];
  units: Record<string, RoomUnit>;
  messages: RoomMessage[];
  next_seq: number;
  awaiting_ack_since?: string;
  ack_deadline_at?: string;
  escalation?: RoomEscalation;
  reconciliation?: RoomReconciliation;
}

export interface RoomSessionApi {
  get(input: { sessionID: string }): Promise<{ id: string; parentID?: string }>;
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
  note?: string;
}

export interface RoomEscalateInput {
  action: string;
  reason: string;
  unit?: string;
  evidence?: string;
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

    if (type === 'open') {
      if (!room.scope.includes(unit)) {
        throw new Error(`unit "${unit}" is not in the authorized scope`);
      }
      if (room.units[unit]) throw new Error(`unit "${unit}" is already open`);
      const earlierOpen = room.scope
        .slice(0, room.scope.indexOf(unit))
        .find((candidate) => room.units[candidate]?.status !== 'closed');
      if (earlierOpen !== undefined) {
        throw new Error(
          `cannot open "${unit}": earlier unit "${earlierOpen}" is not closed; close units in scope order`,
        );
      }
    } else if (!room.units[unit]) {
      throw new Error(`unit "${unit}" is not open`);
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
      for (const message of unread) message.read_by.push(member.role);
      return unread;
    });
    if (found.length > 0) return found;

    const remaining = deadline - Date.now();
    if (remaining <= 0) return [];
    await sleep(Math.min(INBOX_POLL_MS, remaining));
  }
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

/**
 * Build the one-line unread notice for a session, or null when the session is
 * not a room member or has no unread messages. Read-only: it never mutates the
 * room, because reading is the inbox tool's job.
 */
export function buildRoomNotice(room: Room, sessionID: string): string | null {
  const member = findMember(room, sessionID);
  if (!member) return null;
  const unread = unreadForRole(room, member.role);
  if (unread.length === 0) return null;
  const senders = [...new Set(unread.map((message) => message.role))].join(', ');
  const units = [...new Set(unread.map((message) => message.unit))].join(', ');
  return `[pas-room] ${unread.length} unread message(s) from ${senders} on ${units}; call pas_room_inbox before your next action.`;
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

function correctionRoundsUsed(room: Room, unitId: string): number {
  return auditMessages(room, unitId).filter((message) =>
    (message.findings ?? []).some((finding) => finding.severity === 'blocking'),
  ).length;
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
    if (room.status === 'closed') throw new Error('the room is closed; no more evidence can be recorded');
    if (room.status === 'awaiting_ack') {
      throw new Error('the room is awaiting ack; evidence must be recorded before end');
    }
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
        throw new Error('only the driver may record TDD evidence');
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
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('findings must be a non-empty array; an audit with nothing to say is not an audit');
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

  return mutateRoom(rootDir, roomId, (room) => {
    const member = requireMember(room, sessionID);
    if (member.role !== 'peer') throw new Error('only the peer may record an audit');
    if (room.status === 'closed') throw new Error('the room is closed; no more audits can be recorded');
    if (room.status === 'awaiting_ack') {
      throw new Error('the room is awaiting ack; audits must be recorded before end');
    }
    if (!room.scope.includes(unitId)) {
      throw new Error(`unit "${unitId}" is not in the authorized scope`);
    }
    const unit = room.units[unitId];
    if (!unit || unit.status !== 'open') throw new Error(`unit "${unitId}" is not open`);

    const hasBlocking = findings.some((finding) => finding.severity === 'blocking');
    if (hasBlocking && correctionRoundsUsed(room, unitId) >= MAX_CORRECTION_ROUNDS) {
      throw new Error(
        `correction rounds for "${unitId}" are exhausted (${MAX_CORRECTION_ROUNDS} blocking audits); the only exit is pas_room_escalate`,
      );
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
    if (room.status === 'closed') throw new Error('the room is closed; nothing to escalate');

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

    const evidence = evidenceMessages(room, unitId);
    let seenRed = false;
    for (const message of evidence) {
      const entry = message.evidence;
      if (!entry) continue;
      const problem = validateEvidenceFields(entry);
      if (problem) {
        throw new Error(`evidence #${message.seq} for "${unitId}" is invalid: ${problem}`);
      }
      if (entry.stage === 'green' && !seenRed) {
        throw new Error(`cannot close "${unitId}": green evidence #${message.seq} has no preceding red`);
      }
      if (entry.stage === 'red') seenRed = true;
    }

    const hasRed = evidence.some((message) => message.evidence?.stage === 'red');
    const hasGreen = evidence.some((message) => message.evidence?.stage === 'green');
    const hasManual = evidence.some((message) => message.evidence?.stage === 'manual');
    if (!hasManual && !(hasRed && hasGreen)) {
      throw new Error(
        `cannot close "${unitId}": requires red and green evidence (or a manual entry)`,
      );
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
    const member = requireMember(room, sessionID);
    if (member.role !== 'driver') throw new Error('only the driver may end the room');
    requireNoPendingEscalation(room, 'end the room');
    if (room.status === 'closed') throw new Error('the room is already closed');
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
    `Goal: ${room.goal}`,
    `Scope: ${room.scope.join(' | ') || '(none)'}`,
    `Authorized paths: ${room.authorized_paths.join(', ') || '(none)'}`,
    'Members:',
  ];
  if (room.members.length === 0) lines.push('- (none)');
  for (const member of room.members) lines.push(`- ${member.role}: ${member.sessionID}`);
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
  lines.push(`Reconciliation: ${renderReconciliation(room.reconciliation)}`);

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
    .map(
      (message) =>
        `#${message.seq} ${message.role}->${message.to} ${message.unit} ${message.type}/${message.kind}: ${message.body}`,
    )
    .join('\n');
}

export const internals = {
  roomIdForSession,
  openRoom,
  joinRoom,
  sendMessage,
  readInbox,
  roomState,
  closeUnit,
  recordEvidence,
  auditUnit,
  escalateRoom,
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
      const content = await handler(workspace, roomId, sessionID, asInputRecord(input));
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

    const sessionHook = ctx.session.hook;
    if (typeof sessionHook === 'function') {
      const noticeHook = createRoomNoticeHook(defaultDirectory, ctx.session);
      await sessionHook.call(ctx.session, 'context', noticeHook);
      await sessionHook.call(ctx.session, 'compaction', noticeHook);
    }

    const execute = createToolExecute(defaultDirectory);
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
          execute: createRoomToolExecute(defaultDirectory, ctx.session, handler),
        });
      };

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
            type: { enum: ['open', 'reply', 'challenge', 'propose_close'] },
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
        'Read unread room messages for the caller, optionally filtered by unit. Returned messages are marked read.',
        {
          type: 'object',
          properties: {
            unit: { type: 'string' },
            wait_s: { type: 'number' },
          },
          additionalProperties: false,
        },
        async (root, roomId, sessionID, input) => {
          const waitRaw = typeof input.wait_s === 'number' ? input.wait_s : 0;
          const messages = await readInbox(root, roomId, sessionID, {
            ...(typeof input.unit === 'string' ? { unit: input.unit } : {}),
            wait_s: waitRaw,
          });
          return messages.length === 0
            ? 'No unread messages.'
            : `Unread messages:\n${renderTranscript(messages)}`;
        },
      );

      registerRoomTool(
        'pas_room_state',
        'Return the pairing room summary: status, per-unit state, evidence counts, suite audit, unread counts and anomalies.',
        { type: 'object', properties: {}, additionalProperties: false },
        (root, roomId) => renderRoomState(roomState(root, roomId)),
      );

      registerRoomTool(
        'pas_room_evidence',
        'Record reproducible evidence for a unit (stage red|green|refactor|manual|suite). Requires a command, an integer exit_code and an output_excerpt. Green requires a preceding red; only the peer may record the full-suite audit.',
        {
          type: 'object',
          properties: {
            unit: { type: 'string' },
            stage: { enum: ['red', 'green', 'refactor', 'manual', 'suite'] },
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
        'Peer only: record an audit entry for a unit. Findings carry a valid category (process|evidence|quality|cruft|skill|ui|test|scope) and severity (blocking|major|minor|info); at least one finding is required. Blocking audits cap at MAX_CORRECTION_ROUNDS per unit.',
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
            ...(typeof input.note === 'string' ? { note: input.note } : {}),
          });
          return `Recorded audit #${message.seq} with ${message.findings?.length ?? 0} finding(s) for "${message.unit}".`;
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
  },
};
