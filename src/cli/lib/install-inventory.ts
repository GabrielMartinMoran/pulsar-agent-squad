import { createHash } from 'crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import type { Stats } from 'fs';
import { join } from 'path';

/** Destination-local record of the agent files the installer actually wrote. */
export const INSTALL_INVENTORY_FILENAME = '.pas-install-inventory.json';

const INVENTORY_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface InstallInventoryEntry {
  name: string;
  sha256: string;
}

export interface InstallInventory {
  version: 1;
  files: InstallInventoryEntry[];
}

export type RemovalCandidateKind = 'file' | 'symlink' | 'other';

export interface RemovalCandidate {
  name: string;
  kind: RemovalCandidateKind;
  sha256?: string;
}

export type PreservedReason = 'modified' | 'not-regular-file' | 'missing';

export interface RemovalClassification {
  eligible: InstallInventoryEntry[];
  preserved: Array<{ entry: InstallInventoryEntry; reason: PreservedReason }>;
}

export interface InventorySyncResult {
  pruned: string[];
  preserved: RemovalClassification['preserved'];
  recorded: InstallInventoryEntry[];
}

export class InstallInventoryError extends Error {
  constructor(message: string) {
    super(`invalid install inventory: ${message}`);
    this.name = 'InstallInventoryError';
  }
}

/**
 * A destination directory or shipped path that cannot be written safely
 * without following a link or replacing a non-regular entry.
 */
export class InstallDestinationError extends Error {
  constructor(message: string) {
    super(`conflicting path at install destination: ${message}`);
    this.name = 'InstallDestinationError';
  }
}

function lstatIfExists(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function hashBytes(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * An inventory entry may only name a regular file directly inside the
 * destination. Separators, traversal names, control characters and the
 * inventory file itself can never authorize a removal.
 */
export function isValidDirectChildBasename(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  if (name === INSTALL_INVENTORY_FILENAME) return false;
  if (/[/\\\u0000-\u001f]/.test(name)) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse a stored inventory. Any invalid shape, name, digest or duplicate is a
 * hard error: a malformed inventory must never authorize a deletion.
 */
export function parseInstallInventory(raw: string): InstallInventory {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstallInventoryError('not valid JSON');
  }

  if (!isRecord(parsed)) {
    throw new InstallInventoryError('top level must be an object');
  }
  if (parsed.version !== INVENTORY_VERSION) {
    throw new InstallInventoryError(`unsupported version '${String(parsed.version)}'`);
  }
  if (!Array.isArray(parsed.files)) {
    throw new InstallInventoryError("'files' must be an array");
  }

  const seen = new Set<string>();
  const files: InstallInventoryEntry[] = [];

  for (const [index, entry] of parsed.files.entries()) {
    if (!isRecord(entry)) {
      throw new InstallInventoryError(`file ${index} must be an object`);
    }
    const { name, sha256 } = entry;
    if (typeof name !== 'string' || !isValidDirectChildBasename(name)) {
      throw new InstallInventoryError(
        `file ${index} has an invalid direct child name`,
      );
    }
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
      throw new InstallInventoryError(`file ${index} has an invalid SHA-256 digest`);
    }
    if (seen.has(name)) {
      throw new InstallInventoryError(`duplicate file '${name}'`);
    }
    seen.add(name);
    files.push({ name, sha256 });
  }

  return { version: INVENTORY_VERSION, files };
}

/**
 * Read `<dest>/.pas-install-inventory.json` without following symlinks.
 * A missing inventory means a pre-inventory installation. A symlink or any
 * non-regular inventory path is malformed, not an empty inventory.
 */
export function readInstallInventory(destDir: string): InstallInventory | null {
  const path = join(destDir, INSTALL_INVENTORY_FILENAME);
  const stat = lstatIfExists(path);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new InstallInventoryError(`'${path}' is not a regular file`);
  }
  return parseInstallInventory(readFileSync(path, 'utf-8'));
}

/**
 * Reject a destination directory or shipped agent path that is not a plain
 * regular path. Only lstat is used, so a symbolic link is reported instead of
 * followed; the caller aborts before copying any artifact.
 */
export function assertSafeAgentDestination(
  destDir: string,
  shippedNames: Iterable<string>,
): void {
  const destStat = lstatIfExists(destDir);
  if (destStat) {
    if (destStat.isSymbolicLink()) {
      throw new InstallDestinationError(
        `'${destDir}' is a symbolic link; refusing to follow it`,
      );
    }
    if (!destStat.isDirectory()) {
      throw new InstallDestinationError(`'${destDir}' is not a directory`);
    }
  }

  for (const name of new Set(shippedNames)) {
    if (!isValidDirectChildBasename(name)) {
      throw new InstallDestinationError(`invalid agent file name '${name}'`);
    }
    const path = join(destDir, name);
    const stat = lstatIfExists(path);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new InstallDestinationError(
        `'${path}' is a symbolic link; refusing to follow it`,
      );
    }
    if (!stat.isFile()) {
      throw new InstallDestinationError(`'${path}' is not a regular file`);
    }
  }
}

/**
 * Atomically replace the destination inventory. Entries are sorted so repeated
 * installs from the same artifacts produce the same bytes.
 */
export function writeInstallInventory(
  destDir: string,
  entries: InstallInventoryEntry[],
): InstallInventory {
  const seen = new Set<string>();
  const files: InstallInventoryEntry[] = [];

  for (const entry of entries) {
    if (!isValidDirectChildBasename(entry.name)) {
      throw new InstallInventoryError(
        `refusing to record invalid name '${entry.name}'`,
      );
    }
    if (!SHA256_PATTERN.test(entry.sha256)) {
      throw new InstallInventoryError(
        `refusing to record an invalid digest for '${entry.name}'`,
      );
    }
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    files.push({ name: entry.name, sha256: entry.sha256 });
  }

  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  mkdirSync(destDir, { recursive: true });
  const path = join(destDir, INSTALL_INVENTORY_FILENAME);
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: INVENTORY_VERSION, files }, null, 2)}\n`,
  );
  renameSync(temporary, path);

  return { version: INVENTORY_VERSION, files };
}

/**
 * Inspect the regular files currently present in the destination without
 * writing anything. Symlinks and other non-regular entries are never followed
 * or recorded.
 */
function inspectInstalledInventoryEntries(
  destDir: string,
  names: Iterable<string>,
): InstallInventoryEntry[] {
  const entries: InstallInventoryEntry[] = [];

  for (const name of new Set(names)) {
    if (!isValidDirectChildBasename(name)) {
      throw new InstallInventoryError(`refusing to record invalid name '${name}'`);
    }
    const stat = lstatIfExists(join(destDir, name));
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) continue;
    entries.push({
      name,
      sha256: hashBytes(readFileSync(join(destDir, name))),
    });
  }

  return entries;
}

/** Inspect one candidate without following a symlink. */
export function collectRemovalCandidate(
  destDir: string,
  name: string,
): RemovalCandidate | null {
  if (!isValidDirectChildBasename(name)) {
    throw new InstallInventoryError(`refusing to inspect invalid name '${name}'`);
  }
  const path = join(destDir, name);
  const stat = lstatIfExists(path);
  if (!stat) return null;
  if (stat.isSymbolicLink()) {
    return { name, kind: 'symlink' };
  }
  if (!stat.isFile()) {
    return { name, kind: 'other' };
  }
  return { name, kind: 'file', sha256: hashBytes(readFileSync(path)) };
}

export function collectRemovalCandidates(
  destDir: string,
  names: Iterable<string>,
): RemovalCandidate[] {
  const candidates: RemovalCandidate[] = [];
  for (const name of names) {
    const candidate = collectRemovalCandidate(destDir, name);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

/**
 * Pure classification for scenario D4: only an inventory-recorded, still
 * unmodified regular file that the current roster no longer ships is eligible.
 */
export function classifyRetiredFiles(
  inventory: InstallInventory,
  shippedNames: Iterable<string>,
  candidates: Iterable<RemovalCandidate>,
): RemovalClassification {
  const shipped = new Set(shippedNames);
  const byName = new Map<string, RemovalCandidate>();
  for (const candidate of candidates) byName.set(candidate.name, candidate);

  const eligible: InstallInventoryEntry[] = [];
  const preserved: RemovalClassification['preserved'] = [];

  for (const entry of inventory.files) {
    if (shipped.has(entry.name)) continue;

    const candidate = byName.get(entry.name);
    if (!candidate) {
      preserved.push({ entry, reason: 'missing' });
      continue;
    }
    if (candidate.kind !== 'file') {
      preserved.push({ entry, reason: 'not-regular-file' });
      continue;
    }
    if (!candidate.sha256 || candidate.sha256 !== entry.sha256) {
      preserved.push({ entry, reason: 'modified' });
      continue;
    }
    eligible.push(entry);
  }

  return { eligible, preserved };
}

/**
 * Pure metadata merge for a managed destination: keep the original digest of
 * every protected record that still exists, drop missing ones, and let the
 * freshly recorded shipped files win. Retaining the record keeps a later
 * uninstall on the inventory path instead of name-based fallback, while the
 * file itself stays protected until it is resolved.
 */
export function mergeProtectedInventoryRecords(
  shipped: Iterable<InstallInventoryEntry>,
  protectedRecords: Iterable<{
    entry: InstallInventoryEntry;
    reason: PreservedReason;
  }>,
): InstallInventoryEntry[] {
  const byName = new Map<string, InstallInventoryEntry>();

  for (const { entry, reason } of protectedRecords) {
    if (reason === 'missing') continue;
    byName.set(entry.name, { name: entry.name, sha256: entry.sha256 });
  }
  for (const entry of shipped) {
    byName.set(entry.name, { name: entry.name, sha256: entry.sha256 });
  }

  return [...byName.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/**
 * Re-verify each eligible entry immediately before deletion, so a file swapped
 * for a symlink or edited after classification is preserved. This is the only
 * code path that deletes inventory-owned agent files.
 */
export function removeVerifiedInventoryFiles(
  destDir: string,
  entries: Iterable<InstallInventoryEntry>,
): { removed: string[]; preserved: RemovalClassification['preserved'] } {
  const removed: string[] = [];
  const preserved: RemovalClassification['preserved'] = [];

  for (const entry of entries) {
    const candidate = collectRemovalCandidate(destDir, entry.name);
    if (!candidate) {
      preserved.push({ entry, reason: 'missing' });
      continue;
    }
    if (candidate.kind !== 'file') {
      preserved.push({ entry, reason: 'not-regular-file' });
      continue;
    }
    if (!candidate.sha256 || candidate.sha256 !== entry.sha256) {
      preserved.push({ entry, reason: 'modified' });
      continue;
    }
    rmSync(join(destDir, entry.name));
    removed.push(entry.name);
  }

  return { removed, preserved };
}

/**
 * Reconcile one OpenCode agent destination after a successful copy: prune
 * recorded retired files that are still unmodified, then record the shipped
 * set. A dry run classifies and returns the plan without deleting or writing.
 */
export function syncInstallInventory(
  destDir: string,
  shippedNames: Iterable<string>,
  options: { dryRun: boolean; prior: InstallInventory | null },
): InventorySyncResult {
  const shipped = [...shippedNames];
  const classification = options.prior
    ? classifyRetiredFiles(
        options.prior,
        shipped,
        collectRemovalCandidates(
          destDir,
          options.prior.files.map((entry) => entry.name),
        ),
      )
    : { eligible: [], preserved: [] };

  if (options.dryRun) {
    return {
      pruned: classification.eligible.map((entry) => entry.name),
      preserved: classification.preserved,
      recorded: [],
    };
  }

  const removal = removeVerifiedInventoryFiles(destDir, classification.eligible);
  const inventory = writeInstallInventory(
    destDir,
    mergeProtectedInventoryRecords(
      inspectInstalledInventoryEntries(destDir, shipped),
      [...classification.preserved, ...removal.preserved],
    ),
  );

  return {
    pruned: removal.removed,
    preserved: [...classification.preserved, ...removal.preserved],
    recorded: inventory.files,
  };
}
