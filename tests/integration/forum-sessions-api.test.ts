import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type {
  RoomListResponse,
  SessionGeneration,
  SessionsResponse,
  SessionSummary,
} from '../../src/cli/forum/contract';
import { createForumServer, type ForumServer } from '../../src/cli/forum/server';

const roots: string[] = [];
const servers: ForumServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function roomDocument(
  id: string,
  generation: number,
  goal: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    status: 'open',
    generation,
    goal,
    scope: ['Session rail'],
    authorized_paths: [],
    created_at: '2026-10-25T09:00:00.000Z',
    members: [
      { sessionID: 'session-host', role: 'host' },
      { sessionID: 'session-driver', role: 'driver' },
      { sessionID: 'session-peer', role: 'peer' },
    ],
    messages: [],
    forum: { topics: [], posts: [], expected: {}, final_requested: false },
    activities: {
      driver: { sessionID: 'session-driver', availability: 'active', state: 'working' },
      peer: { sessionID: 'session-peer', availability: 'active', state: 'waiting_for_response' },
    },
    ...overrides,
  };
}

function writeRoom(
  workspace: string,
  relativePath: string,
  document: unknown,
  mtime: string,
): void {
  const path = join(workspace, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(document));
  const stamp = new Date(mtime);
  utimesSync(path, stamp, stamp);
}

interface Viewer {
  url: string;
  workspace: string;
}

interface ViewerOptions {
  titles: { resolve(): Promise<ReadonlyMap<string, string>> };
  titleDeadlineMs?: number;
}

function startViewer(options: ViewerOptions): Viewer {
  const workspace = mkdtempSync(join(tmpdir(), 'pas-forum-sessions-'));
  roots.push(workspace);

  writeRoom(
    workspace,
    '.pas/rooms/ses_alpha.json',
    roomDocument('ses_alpha', 3, 'Aggregate the room store\nsecond line of the objective', {
      created_at: '2026-10-25T09:00:00.000Z',
      forum: {
        topics: [
          { id: 't1', title: 'One', status: 'approved' },
          { id: 't2', title: 'Two', status: 'approved' },
          { id: 't3', title: 'Three', status: 'ready' },
          { id: 't4', title: 'Four', status: 'open' },
        ],
        posts: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' }],
        expected: {},
        final_requested: false,
      },
    }),
    '2026-11-03T12:00:00.000Z',
  );
  writeRoom(
    workspace,
    '.pas/rooms/archive/ses_alpha/generation-1-2026-10-20T09-00-00-000Z-a.json',
    roomDocument('ses_alpha', 1, 'Old alpha generation', {
      status: 'closed',
      created_at: '2026-10-20T09:00:00.000Z',
    }),
    '2026-10-20T09:05:00.000Z',
  );
  writeRoom(
    workspace,
    '.pas/rooms/archive/ses_alpha/generation-2-2026-10-22T09-00-00-000Z-b.json',
    roomDocument('ses_alpha', 2, 'Middle alpha generation', {
      status: 'closed',
      created_at: '2026-10-22T09:00:00.000Z',
    }),
    '2026-10-22T09:05:00.000Z',
  );
  writeRoom(
    workspace,
    '.pas/rooms/ses_beta.json',
    roomDocument('ses_beta', 1, 'Beta session goal', {
      created_at: '2026-10-24T09:00:00.000Z',
    }),
    '2026-11-02T12:00:00.000Z',
  );
  writeRoom(
    workspace,
    '.pas/rooms/archive/ses_gamma/generation-1-2026-10-23T09-00-00-000Z-a.json',
    roomDocument('ses_gamma', 1, 'Gamma archived goal', {
      status: 'closed',
      created_at: '2026-10-21T09:00:00.000Z',
    }),
    '2026-11-01T12:00:00.000Z',
  );
  writeRoom(
    workspace,
    '.pas/rooms/ses_delta.json',
    roomDocument('ses_delta', 1, '', { created_at: '2026-10-23T09:00:00.000Z' }),
    '2026-10-31T12:00:00.000Z',
  );

  const server = createForumServer({
    workspace,
    port: 0,
    watchIntervalMs: 1_000,
    heartbeatMs: 60_000,
    titles: options.titles,
    titleDeadlineMs: options.titleDeadlineMs,
  });
  servers.push(server);
  return { url: server.url, workspace };
}

function endpoint(url: string, path: string): URL {
  return new URL(path.replace(/^\//, ''), url);
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe('sessions API', () => {
  it('serves one entry per session with nested generations and honest labels', async () => {
    const titles = new Map([['ses_alpha', 'Session rail aggregation']]);
    const { url, workspace } = startViewer({
      titles: { resolve: async () => titles },
    });

    const response = await fetch(endpoint(url, '/api/sessions'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = (await response.json()) as SessionsResponse;
    expect(sortedKeys(body)).toEqual(['sessions']);

    const sessions = body.sessions;
    // Six room files (one live plus two archives for alpha, one live each for
    // beta and delta, one archive for gamma) become four sessions.
    expect(sessions.map((session) => session.id)).toEqual([
      'ses_alpha',
      'ses_beta',
      'ses_gamma',
      'ses_delta',
    ]);

    const rooms = (await (await fetch(endpoint(url, '/api/rooms'))).json()) as RoomListResponse;
    expect(rooms.rooms).toHaveLength(6);
    expect(rooms.rooms.map((room) => room.key).sort()).toEqual([
      'ses_alpha',
      'ses_alpha@1',
      'ses_alpha@2',
      'ses_beta',
      'ses_delta',
      'ses_gamma@1',
    ]);

    const alpha = sessions[0]!;
    expect(sortedKeys(alpha)).toEqual(
      [
        'id',
        'title',
        'titleSource',
        'project',
        'updatedAt',
        'createdAt',
        'phase',
        'generation',
        'generations',
        'counts',
        'participants',
        'hasForum',
      ].sort(),
    );
    expect(alpha).toMatchObject({
      id: 'ses_alpha',
      title: 'Session rail aggregation',
      titleSource: 'opencode',
      project: basename(workspace),
      updatedAt: '2026-11-03T12:00:00.000Z',
      createdAt: '2026-10-20T09:00:00.000Z',
      phase: 'active',
      generation: 3,
      counts: { approved: 2, total: 4, posts: 5 },
      hasForum: true,
    });
    expect(alpha.generations.map((entry) => entry.kind)).toEqual(['live', 'archive', 'archive']);
    expect(alpha.generations.map((entry) => entry.generation)).toEqual([3, 2, 1]);
    expect(alpha.generations.map((entry) => entry.key)).toEqual([
      'ses_alpha',
      'ses_alpha@2',
      'ses_alpha@1',
    ]);
    expect(alpha.participants?.driver).toMatchObject({
      sessionID: 'session-driver',
      availability: 'active',
    });
    for (const generation of alpha.generations as SessionGeneration[]) {
      expect(sortedKeys(generation)).toEqual(
        ['kind', 'generation', 'key', 'updatedAt', 'phase', 'topicCounts', 'postCount'].sort(),
      );
    }

    const beta = sessions[1]!;
    expect(beta.title).toBe('Beta session goal');
    expect(beta.titleSource).toBe('goal');

    // An archive-only session defaults to its newest (here only) generation.
    const gamma = sessions[2]!;
    expect(gamma.title).toBe('Gamma archived goal');
    expect(gamma.titleSource).toBe('goal');
    expect(gamma.phase).toBe('closed');
    expect(gamma.generation).toBe(1);
    expect(gamma.generations).toHaveLength(1);
    expect(gamma.generations[0]!.kind).toBe('archive');

    const delta = sessions[3]!;
    expect(delta.title).toBe('Untitled session');
    expect(delta.titleSource).toBe('goal');
  });

  it('answers within the deadline with goal labels when the resolver never settles', async () => {
    const { url } = startViewer({
      titles: { resolve: () => new Promise<ReadonlyMap<string, string>>(() => {}) },
      titleDeadlineMs: 80,
    });

    const started = Date.now();
    const response = await fetch(endpoint(url, '/api/sessions'));
    const elapsed = Date.now() - started;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(1_000);

    const body = (await response.json()) as SessionsResponse & { error?: unknown };
    expect(body.error).toBeUndefined();
    expect(body.sessions.length).toBe(4);
    for (const session of body.sessions as SessionSummary[]) {
      expect(session.titleSource).toBe('goal');
      expect(session.title.length).toBeGreaterThan(0);
    }
    expect(body.sessions.map((session) => session.id)).toEqual([
      'ses_alpha',
      'ses_beta',
      'ses_gamma',
      'ses_delta',
    ]);
  });

  it('answers with goal labels when the resolver rejects instead of failing the request', async () => {
    const { url } = startViewer({
      titles: {
        resolve: async () => {
          throw new Error('opencode is not installed');
        },
      },
      titleDeadlineMs: 80,
    });

    const response = await fetch(endpoint(url, '/api/sessions'));
    expect(response.status).toBe(200);

    const body = (await response.json()) as SessionsResponse & { error?: unknown };
    expect(body.error).toBeUndefined();
    expect(body.sessions).toHaveLength(4);
    for (const session of body.sessions as SessionSummary[]) {
      expect(session.titleSource).toBe('goal');
    }
  });
});
