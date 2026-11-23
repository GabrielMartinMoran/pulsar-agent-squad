import { stat } from 'node:fs/promises';
import type { RoomChange, RoomKind } from './contract';
import { listRoomFiles } from './store';

const DEFAULT_WATCH_INTERVAL_MS = 400;

export interface WatchRoomsOptions {
  workspace: string;
  /** Poll cadence; the viewer treats under half a second as live. */
  intervalMs?: number;
  onChange: (changes: RoomChange[]) => void;
}

export interface RoomWatcher {
  /** Resolves after the baseline scan; only later changes are reported. */
  ready: Promise<void>;
  stop(): void;
}

interface FileStamp {
  key: string;
  id: string;
  kind: RoomKind;
  generation?: number;
  mtimeMs: number;
  size: number;
}

async function stampOf(
  path: string,
  id: string,
  kind: RoomKind,
  generation?: number,
): Promise<FileStamp | undefined> {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) return undefined;
    const stamp: FileStamp = {
      key: kind === 'live' ? id : `${id}@${generation ?? 0}`,
      id,
      kind,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
    if (generation !== undefined) stamp.generation = generation;
    return stamp;
  } catch {
    // A file that disappears between listing and stat is reported on the next
    // scan as removed, or simply skipped when it never existed.
    return undefined;
  }
}

async function scan(workspace: string): Promise<Map<string, FileStamp>> {
  const stamps = new Map<string, FileStamp>();

  for (const file of await listRoomFiles(workspace)) {
    const stamp = await stampOf(file.path, file.id, file.kind, file.generation);
    if (stamp) stamps.set(stamp.key, stamp);
  }

  return stamps;
}

function changeOf(stamp: FileStamp, change: RoomChange['change']): RoomChange {
  const payload: RoomChange = { key: stamp.key, id: stamp.id, kind: stamp.kind, change };
  if (stamp.generation !== undefined) payload.generation = stamp.generation;
  return payload;
}

/** A room changed when its modification time or its size differs. */
function diff(previous: Map<string, FileStamp>, current: Map<string, FileStamp>): RoomChange[] {
  const changes: RoomChange[] = [];

  for (const [key, stamp] of current) {
    const before = previous.get(key);
    if (!before) changes.push(changeOf(stamp, 'added'));
    else if (before.mtimeMs !== stamp.mtimeMs || before.size !== stamp.size) {
      changes.push(changeOf(stamp, 'changed'));
    }
  }

  for (const [key, stamp] of previous) {
    if (!current.has(key)) changes.push(changeOf(stamp, 'removed'));
  }

  return changes.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
}

/**
 * Polls the room store and reports what changed since the previous scan.
 * A burst inside one interval coalesces into a single change per room file.
 * Stopping the watcher clears its timer and suppresses any in-flight result.
 */
export function watchRooms(options: WatchRoomsOptions): RoomWatcher {
  const { workspace, onChange } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;

  let stopped = false;
  let scanning = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let previous: Map<string, FileStamp> | undefined;

  const poll = async (): Promise<void> => {
    if (scanning || stopped) return;
    scanning = true;
    try {
      const current = await scan(workspace);
      if (previous !== undefined) {
        const changes = diff(previous, current);
        if (changes.length > 0 && !stopped) onChange(changes);
      }
      previous = current;
    } catch {
      // A transient filesystem error must not kill the watcher; the next scan
      // re-reads the whole store.
    } finally {
      scanning = false;
    }
  };

  const ready = poll().then(() => {
    if (stopped) return;
    timer = setInterval(() => {
      void poll();
    }, intervalMs);
  });

  return {
    ready,
    stop(): void {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}
