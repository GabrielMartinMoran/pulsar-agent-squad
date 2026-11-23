import { statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RoomKind, RoomSummary } from './contract';
import { projectRoomList } from './project';

/** One discovered room file, parsed or defensively marked unreadable. */
export interface RoomStoreEntry {
  key: string;
  id: string;
  kind: RoomKind;
  generation: number;
  updatedAt: string;
  document?: unknown;
  unreadable?: string;
}

export class RoomStoreMissingError extends Error {
  readonly workspace: string;

  constructor(workspace: string) {
    super(
      `No PAS room store found at ${join(workspace, '.pas', 'rooms')}. ` +
        'Run this command from a PAS workspace root, or pass --workspace <directory> that contains .pas/rooms.',
    );
    this.name = 'RoomStoreMissingError';
    this.workspace = workspace;
  }
}

/**
 * Room ids name a file, so they are validated before any path is built. The
 * dot-segment cases are rejected explicitly even though the character class
 * would accept them.
 */
const ROOM_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export class InvalidRoomIdError extends Error {
  readonly id: string;

  constructor(id: string) {
    super(
      `Invalid room id '${id}'. Use only letters, digits, dot, underscore and hyphen (1-128 characters).`,
    );
    this.name = 'InvalidRoomIdError';
    this.id = id;
  }
}

export function isSafeRoomId(id: string): boolean {
  return typeof id === 'string' && ROOM_ID_PATTERN.test(id) && id !== '.' && id !== '..';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function roomStorePath(workspace: string): string {
  return join(workspace, '.pas', 'rooms');
}

/** Refuses to start a viewer that would silently show an empty workspace. */
export function assertRoomStore(workspace: string): void {
  const path = roomStorePath(workspace);
  let isDirectory = false;
  try {
    isDirectory = statSync(path).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new RoomStoreMissingError(workspace);
}

async function jsonFilesIn(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function directoriesIn(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function archiveGeneration(name: string): number | undefined {
  const match = /^generation-(\d+)-/.exec(name);
  return match ? Number(match[1]) : undefined;
}

/** One discovered room file; discovery never parses or writes the document. */
export interface RoomFileRef {
  path: string;
  id: string;
  kind: RoomKind;
  /** Set for archived generations, taken from `generation-<n>-…`. */
  generation?: number;
}

/**
 * Lists every live room file and archived generation file. Discovery only
 * enumerates the room store; it never follows a path supplied by a client.
 */
export async function listRoomFiles(workspace: string): Promise<RoomFileRef[]> {
  const rooms = roomStorePath(workspace);
  const files: RoomFileRef[] = [];

  for (const name of await jsonFilesIn(rooms)) {
    files.push({ path: join(rooms, name), id: name.slice(0, -'.json'.length), kind: 'live' });
  }

  const archiveRoot = join(rooms, 'archive');
  for (const roomId of await directoriesIn(archiveRoot)) {
    const directory = join(archiveRoot, roomId);
    for (const name of await jsonFilesIn(directory)) {
      const generation = archiveGeneration(name);
      if (generation === undefined) continue;
      files.push({ path: join(directory, name), id: roomId, kind: 'archive', generation });
    }
  }

  return files;
}

async function readEntry(
  path: string,
  fallbackId: string,
  kind: RoomKind,
  generationHint?: number,
): Promise<RoomStoreEntry> {
  let updatedAt = new Date(0).toISOString();
  try {
    updatedAt = (await stat(path)).mtime.toISOString();
  } catch {
    // A file that disappears between listing and reading is still reported.
  }

  try {
    const text = await readFile(path, 'utf8');
    const document: unknown = JSON.parse(text);
    if (!isObject(document)) throw new Error('room document is not a JSON object');

    const id = asString(document.id) ?? fallbackId;
    const generation =
      kind === 'archive'
        ? (generationHint ?? asNumber(document.generation) ?? 0)
        : (asNumber(document.generation) ?? 0);
    const key = kind === 'live' ? id : `${id}@${generation}`;

    return { key, id, kind, generation, updatedAt, document };
  } catch (error) {
    const generation = kind === 'archive' ? (generationHint ?? 0) : 0;
    const key = kind === 'live' ? fallbackId : `${fallbackId}@${generation}`;
    return {
      key,
      id: fallbackId,
      kind,
      generation,
      updatedAt,
      unreadable: messageOf(error),
    };
  }
}

/**
 * Discovers live rooms and archived generations. Reading is defensive: a
 * malformed file becomes an `unreadable` entry instead of failing the list.
 * Nothing in the room store is ever written.
 */
export async function loadRoomEntries(workspace: string): Promise<RoomStoreEntry[]> {
  assertRoomStore(workspace);
  const entries: RoomStoreEntry[] = [];

  for (const file of await listRoomFiles(workspace)) {
    entries.push(await readEntry(file.path, file.id, file.kind, file.generation));
  }

  return entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'live' ? -1 : 1;
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });
}

export async function listRooms(workspace: string): Promise<RoomSummary[]> {
  return projectRoomList(await loadRoomEntries(workspace));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Reads one room by id. Without a generation it selects the live file; with
 * one it selects exactly that archived generation (`generation-<n>-…`), never
 * a prefix match. Unknown valid ids and generations resolve to `undefined`, so
 * the server can answer 404; unsafe ids throw before touching the filesystem.
 */
export async function loadRoomEntry(
  workspace: string,
  id: string,
  generation?: number,
): Promise<RoomStoreEntry | undefined> {
  if (!isSafeRoomId(id)) throw new InvalidRoomIdError(id);
  assertRoomStore(workspace);

  const rooms = roomStorePath(workspace);
  if (generation === undefined) {
    const path = join(rooms, `${id}.json`);
    return (await isFile(path)) ? readEntry(path, id, 'live') : undefined;
  }

  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new RangeError(`Invalid generation '${generation}': expected a positive integer.`);
  }

  const directory = join(rooms, 'archive', id);
  const names = (await jsonFilesIn(directory))
    .filter((name) => archiveGeneration(name) === generation)
    .sort();
  const name = names.at(-1);
  if (!name) return undefined;

  return readEntry(join(directory, name), id, 'archive', generation);
}
