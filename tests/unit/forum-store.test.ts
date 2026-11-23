import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertRoomStore,
  InvalidRoomIdError,
  isSafeRoomId,
  listRooms,
  loadRoomEntries,
  loadRoomEntry,
  RoomStoreMissingError,
} from '../../src/cli/forum/store';
import { projectRoomDetail } from '../../src/cli/forum/project';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'pas-forum-store-'));
  roots.push(root);
  return root;
}

function roomDocument(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    status: 'open',
    generation: 1,
    goal: 'Project the room store',
    scope: ['Discovery'],
    members: [{ sessionID: `${id}-host`, role: 'host' }],
    messages: [],
    forum: { topics: [], posts: [], expected: {}, final_requested: false },
    ...overrides,
  };
}

function writeRoom(path: string, document: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(document));
}

function snapshot(root: string): string[] {
  const lines: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        lines.push(`${full}:${statSync(full).mtimeMs}:${readFileSync(full, 'utf8')}`);
      }
    }
  };
  walk(root);
  return lines.sort();
}

describe('room store discovery', () => {
  it('discovers live and archived room files with their mtime and generation', async () => {
    const workspace = tempWorkspace();
    const livePath = join(workspace, '.pas', 'rooms', 'ses_live.json');
    const archivePath = join(
      workspace,
      '.pas',
      'rooms',
      'archive',
      'ses_live',
      'generation-2-2026-11-01T10-00-00-000Z-00000000-0000-0000-0000-000000000000.json',
    );
    writeRoom(livePath, roomDocument('ses_live', { generation: 3 }));
    writeRoom(archivePath, roomDocument('ses_live', { generation: 2 }));
    writeFileSync(join(workspace, '.pas', 'rooms', 'notes.txt'), 'not a room');

    const entries = await loadRoomEntries(workspace);
    const live = entries.find((entry) => entry.kind === 'live');
    const archive = entries.find((entry) => entry.kind === 'archive');

    expect(entries).toHaveLength(2);
    expect(live).toMatchObject({
      key: 'ses_live',
      id: 'ses_live',
      kind: 'live',
      generation: 3,
      updatedAt: statSync(livePath).mtime.toISOString(),
    });
    expect(live!.document).toMatchObject({ goal: 'Project the room store' });
    expect(archive).toMatchObject({
      key: 'ses_live@2',
      id: 'ses_live',
      kind: 'archive',
      generation: 2,
      updatedAt: statSync(archivePath).mtime.toISOString(),
    });
  });

  it('reports a malformed room file as unreadable and still lists the valid rooms', async () => {
    const workspace = tempWorkspace();
    const rooms = join(workspace, '.pas', 'rooms');
    mkdirSync(rooms, { recursive: true });
    writeFileSync(join(rooms, 'ses_broken.json'), '{ not json');
    writeRoom(join(rooms, 'ses_valid.json'), roomDocument('ses_valid'));

    const entries = await loadRoomEntries(workspace);
    const broken = entries.find((entry) => entry.id === 'ses_broken');

    expect(broken).toBeDefined();
    expect(broken!.unreadable).toBeString();
    expect(broken!.document).toBeUndefined();

    const listed = await listRooms(workspace);
    expect(listed.find((room) => room.id === 'ses_broken')?.unreadable).toBeString();
    expect(listed.find((room) => room.id === 'ses_valid')?.hasForum).toBe(true);
  });

  it('reports a JSON scalar as unreadable instead of throwing', async () => {
    const workspace = tempWorkspace();
    const rooms = join(workspace, '.pas', 'rooms');
    mkdirSync(rooms, { recursive: true });
    writeFileSync(join(rooms, 'ses_scalar.json'), '"just a string"');

    const [entry] = await loadRoomEntries(workspace);

    expect(entry!.unreadable).toContain('not a JSON object');
  });

  it('never writes to the room store while listing rooms', async () => {
    const workspace = tempWorkspace();
    const rooms = join(workspace, '.pas', 'rooms');
    writeRoom(join(rooms, 'ses_live.json'), roomDocument('ses_live'));
    writeRoom(
      join(rooms, 'archive', 'ses_live', 'generation-1-2026-11-01T10-00-00-000Z-x.json'),
      roomDocument('ses_live', { generation: 1 }),
    );
    const before = snapshot(rooms);

    await listRooms(workspace);

    expect(snapshot(rooms)).toEqual(before);
  });

  it('fails with actionable guidance when the workspace has no room store', () => {
    const workspace = tempWorkspace();

    expect(() => assertRoomStore(workspace)).toThrow(RoomStoreMissingError);
    try {
      assertRoomStore(workspace);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('No PAS room store');
      expect(message).toContain('.pas/rooms');
      expect(message).toContain('--workspace');
    }
  });
});

describe('generation selection', () => {
  function archivedWorkspace(): string {
    const workspace = tempWorkspace();
    const rooms = join(workspace, '.pas', 'rooms');
    const traffic = (id: string, body: string): Record<string, unknown>[] => [
      {
        id,
        seq: 0,
        role: 'driver',
        to: '*',
        type: 'comment',
        body,
        created_at: '2026-11-01T10:00:00.000Z',
        read_by: ['driver'],
      },
    ];
    writeRoom(
      join(rooms, 'ses_live.json'),
      roomDocument('ses_live', { generation: 3, messages: traffic('live-1', 'live traffic') }),
    );
    writeRoom(
      join(rooms, 'archive', 'ses_live', 'generation-1-2026-10-31T10-00-00-000Z-a.json'),
      roomDocument('ses_live', {
        generation: 1,
        goal: 'first generation',
        messages: traffic('gen1-1', 'first generation traffic'),
      }),
    );
    writeRoom(
      join(rooms, 'archive', 'ses_live', 'generation-2-2026-11-01T10-00-00-000Z-b.json'),
      roomDocument('ses_live', {
        generation: 2,
        goal: 'second generation',
        messages: traffic('gen2-1', 'second generation traffic'),
      }),
    );
    writeRoom(
      join(rooms, 'archive', 'ses_live', 'generation-2-2026-11-01T11-00-00-000Z-c.json'),
      roomDocument('ses_live', {
        generation: 2,
        goal: 'second generation, later snapshot',
        messages: traffic('gen2-later', 'later snapshot traffic'),
      }),
    );
    return workspace;
  }

  it('selects the live generation by default and an archived generation on request', async () => {
    const workspace = archivedWorkspace();

    const live = await loadRoomEntry(workspace, 'ses_live');
    const first = await loadRoomEntry(workspace, 'ses_live', 1);
    const second = await loadRoomEntry(workspace, 'ses_live', 2);

    expect(live).toMatchObject({ key: 'ses_live', kind: 'live', generation: 3 });
    expect(live!.document).toMatchObject({ goal: 'Project the room store' });

    expect(first).toMatchObject({ key: 'ses_live@1', kind: 'archive', generation: 1 });
    expect(first!.document).toMatchObject({ goal: 'first generation' });

    // Two snapshots share generation 2: the later timestamp wins deterministically.
    expect(second).toMatchObject({ key: 'ses_live@2', kind: 'archive', generation: 2 });
    expect(second!.document).toMatchObject({ goal: 'second generation, later snapshot' });
  });

  it('projects an archived generation with its own traffic, apart from the live room', async () => {
    const workspace = archivedWorkspace();

    const live = projectRoomDetail((await loadRoomEntry(workspace, 'ses_live'))!);
    const archived = projectRoomDetail((await loadRoomEntry(workspace, 'ses_live', 2))!);

    expect(live.room).toMatchObject({ key: 'ses_live', kind: 'live', generation: 3 });
    expect(live.timeline.map((entry) => entry.id)).toEqual(['live-1']);

    expect(archived.room).toMatchObject({
      key: 'ses_live@2',
      kind: 'archive',
      generation: 2,
    });
    expect(archived.timeline.map((entry) => entry.id)).toEqual(['gen2-later']);
  });

  it('returns undefined for a valid room id with no matching file or generation', async () => {
    const workspace = archivedWorkspace();

    expect(await loadRoomEntry(workspace, 'ses_absent')).toBeUndefined();
    expect(await loadRoomEntry(workspace, 'ses_live', 9)).toBeUndefined();
  });

  it('never writes while selecting a generation', async () => {
    const workspace = archivedWorkspace();
    const rooms = join(workspace, '.pas', 'rooms');
    const before = snapshot(rooms);

    await loadRoomEntry(workspace, 'ses_live');
    await loadRoomEntry(workspace, 'ses_live', 1);
    await loadRoomEntry(workspace, 'ses_live', 2);

    expect(snapshot(rooms)).toEqual(before);
  });

  it('refuses identifiers that could escape the room store', async () => {
    const workspace = archivedWorkspace();

    expect(isSafeRoomId('ses_abc-123.v2')).toBe(true);
    for (const unsafe of ['', '..', '.', '../etc', 'a/b', 'a\\b', 'a b', 'x'.repeat(129), '%2e%2e']) {
      expect(isSafeRoomId(unsafe)).toBe(false);
      await expect(loadRoomEntry(workspace, unsafe)).rejects.toThrow(InvalidRoomIdError);
    }
  });
});
