import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ApiErrorBody,
  EvidenceSummary,
  RoomDetail,
  RoomListResponse,
  RoomSummary,
  TimelineEntry,
  TopicSummary,
} from '../../src/cli/forum/contract';
import { createForumServer, type ForumServer } from '../../src/cli/forum/server';

const ROOM_ID = 'ses_live';
const LIVE_PATH = '.pas/rooms/ses_live.json';
const ARCHIVE_PATH = '.pas/rooms/archive/ses_live/generation-1-2026-11-01T10-00-00-000Z-a.json';

const roots: string[] = [];
const servers: ForumServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function roomDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROOM_ID,
    status: 'open',
    generation: 2,
    goal: 'Stream the forum transcript',
    scope: ['Transcript', 'HTTP API'],
    authorized_paths: [],
    created_at: '2026-11-02T09:00:00.000Z',
    members: [
      { sessionID: 'session-host', role: 'host' },
      { sessionID: 'session-driver', role: 'driver' },
      { sessionID: 'session-peer', role: 'peer' },
    ],
    messages: [
      {
        id: 'evt-reset',
        seq: 0,
        role: 'host',
        to: '*',
        type: 'reset',
        kind: 'discussion',
        body: 'started generation 2',
        created_at: '2026-11-02T09:00:01.000Z',
        read_by: ['host', 'driver', 'peer'],
      },
      {
        id: 'post-1',
        seq: 1,
        role: 'driver',
        to: '*',
        type: 'ready_for_review',
        kind: 'discussion',
        body: 'Ready for review.',
        created_at: '2026-11-02T09:05:00.000Z',
        read_by: ['driver'],
      },
    ],
    next_seq: 2,
    forum: {
      topics: [
        {
          id: 'transcript',
          title: 'Transcript',
          scenarios: ['The timeline merges posts with room events in sequence order'],
          paths: ['src/cli/forum/project.ts'],
          status: 'ready',
          revision: 1,
        },
      ],
      posts: [
        {
          id: 'post-1',
          seq: 1,
          topic: 'transcript',
          category: 'ready_for_review',
          message: 'Ready for review.',
          role: 'driver',
          revision: 1,
          evidence: { command: 'bun test tests/unit/forum-timeline.test.ts', exit_code: 0, output: 'ok' },
        },
      ],
      expected: { driver: 'session-driver', peer: 'session-peer' },
      final_requested: false,
    },
    activities: {
      driver: { sessionID: 'session-driver', availability: 'active', state: 'working' },
      peer: { sessionID: 'session-peer', availability: 'active', state: 'waiting_for_response' },
    },
    reconciliation: {
      submissions: {
        driver: {
          sessionID: 'session-driver',
          files: ['src/cli/forum/project.ts'],
          submitted_at: '2026-11-02T09:30:00.000Z',
        },
      },
      reconciled: false,
      files: [],
    },
    ...overrides,
  };
}

function writeRoom(workspace: string, relativePath: string, document: unknown): string {
  const path = join(workspace, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(document));
  return path;
}

interface Viewer {
  server: ForumServer;
  url: string;
  workspace: string;
}

function startViewer(): Viewer {
  const workspace = mkdtempSync(join(tmpdir(), 'pas-forum-api-'));
  roots.push(workspace);
  writeRoom(workspace, LIVE_PATH, roomDocument());
  writeRoom(
    workspace,
    ARCHIVE_PATH,
    roomDocument({
      generation: 1,
      goal: 'Archived generation one',
      messages: [
        {
          id: 'gen1-post',
          seq: 0,
          role: 'driver',
          to: '*',
          type: 'comment',
          body: 'First generation traffic',
          created_at: '2026-11-01T10:00:00.000Z',
          read_by: ['driver'],
        },
      ],
      forum: { topics: [], posts: [], expected: {}, final_requested: false },
    }),
  );
  writeFileSync(join(workspace, 'secret.txt'), 'OUTSIDE-THE-ROOM-STORE');

  const server = createForumServer({
    workspace,
    port: 0,
    watchIntervalMs: 20,
    heartbeatMs: 60,
  });
  servers.push(server);
  return { server, url: server.url, workspace };
}

function endpoint(url: string, path: string): URL {
  return new URL(path.replace(/^\//, ''), url);
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function expectErrorBody(body: unknown, code: string): void {
  const error = (body as ApiErrorBody).error;
  expect(error).toBeDefined();
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe('string');
}

interface SseFrame {
  event: string;
  data: string;
}

interface SseClient {
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
}

function frameFrom(buffer: string): { frame: SseFrame; rest: string } | undefined {
  const boundary = buffer.indexOf('\n\n');
  if (boundary < 0) return undefined;

  const block = buffer.slice(0, boundary);
  const rest = buffer.slice(boundary + 2);
  let event = 'message';
  const data: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart());
  }

  return { frame: { event, data: data.join('\n') }, rest };
}

async function subscribe(url: string): Promise<SseClient> {
  const controller = new AbortController();
  const response = await fetch(endpoint(url, '/api/events'), {
    signal: controller.signal,
    headers: { accept: 'text/event-stream' },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('cache-control')).toBe('no-store');

  if (!response.body) throw new Error('the event stream response has no body');
  return {
    controller,
    reader: response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>,
    decoder: new TextDecoder(),
    buffer: '',
  };
}

function timeout(ms: number): Promise<'timeout'> {
  return new Promise((resolveTimeout) => {
    const timer = setTimeout(() => resolveTimeout('timeout'), ms);
    timer.unref?.();
  });
}

async function nextFrame(client: SseClient, timeoutMs: number): Promise<SseFrame> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const parsed = frameFrom(client.buffer);
    if (parsed) {
      client.buffer = parsed.rest;
      return parsed.frame;
    }

    const result = await Promise.race([
      client.reader.read(),
      timeout(Math.max(1, deadline - Date.now())),
    ]);
    if (result === 'timeout') break;
    if (result.done) break;
    client.buffer += client.decoder.decode(result.value, { stream: true });
  }

  throw new Error(`No SSE frame within ${timeoutMs}ms. Buffer: ${client.buffer}`);
}

async function awaitFrame(
  client: SseClient,
  predicate: (frame: SseFrame) => boolean,
  timeoutMs = 4_000,
): Promise<SseFrame> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const frame = await nextFrame(client, Math.max(1, deadline - Date.now()));
    if (predicate(frame)) return frame;
  }

  throw new Error(`No matching SSE frame within ${timeoutMs}ms`);
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

describe('forum API contract', () => {
  it('serves the room list and a room detail with the documented shapes', async () => {
    const { url } = startViewer();

    const listResponse = await fetch(endpoint(url, '/api/rooms'));
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get('content-type')).toContain('application/json');
    expect(listResponse.headers.get('cache-control')).toBe('no-store');
    expect(listResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(listResponse.headers.get('content-security-policy')).toBe("default-src 'self'");

    const list = (await listResponse.json()) as RoomListResponse;
    expect(sortedKeys(list)).toEqual(['rooms']);
    expect(list.rooms).toHaveLength(2);

    const live = list.rooms.find((room) => room.kind === 'live')!;
    expect(sortedKeys(live)).toEqual(
      [
        'key',
        'id',
        'kind',
        'generation',
        'goal',
        'scopeCount',
        'phase',
        'status',
        'createdAt',
        'updatedAt',
        'topicCounts',
        'postCount',
        'participants',
        'hasForum',
        'lastPost',
      ].sort(),
    );
    expect(sortedKeys(live.topicCounts)).toEqual(['approved', 'open', 'ready', 'total']);
    expect(live).toMatchObject({
      key: ROOM_ID,
      id: ROOM_ID,
      kind: 'live',
      generation: 2,
      phase: 'active',
      status: 'open',
      hasForum: true,
      postCount: 1,
    });

    const response = await fetch(endpoint(url, `/api/rooms/${ROOM_ID}`));
    expect(response.status).toBe(200);
    const detail = (await response.json()) as RoomDetail;

    expect(sortedKeys(detail)).toEqual(
      ['room', 'topics', 'timeline', 'reconciliation', 'finalReview'].sort(),
    );
    const room: RoomSummary = detail.room;
    expect(room.id).toBe(ROOM_ID);

    const topic: TopicSummary = detail.topics[0]!;
    expect(sortedKeys(topic)).toEqual(
      ['id', 'title', 'scenarios', 'paths', 'status', 'revision', 'lastPost', 'blockers'].sort(),
    );
    expect(topic.blockers).toEqual(['peer approval pending']);

    expect(detail.timeline).toHaveLength(2);
    for (const entry of detail.timeline as TimelineEntry[]) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.seq).toBe('number');
      expect(entry.at === null || typeof entry.at === 'string').toBe(true);
      expect(typeof entry.role).toBe('string');
      expect(typeof entry.category).toBe('string');
      expect(['post', 'event']).toContain(entry.kind);
      expect(typeof entry.message).toBe('string');
      expect(Array.isArray(entry.seenBy)).toBe(true);
    }

    const post = detail.timeline.find((entry) => entry.id === 'post-1')!;
    expect(post).toMatchObject({
      kind: 'post',
      category: 'ready_for_review',
      revision: 1,
      topic: 'transcript',
      at: '2026-11-02T09:05:00.000Z',
      seenBy: ['driver'],
    });
    const evidence: EvidenceSummary = post.evidence!;
    expect(sortedKeys(evidence)).toEqual(['command', 'exitCode', 'output', 'truncated'].sort());
    expect(evidence).toEqual({
      command: 'bun test tests/unit/forum-timeline.test.ts',
      exitCode: 0,
      output: 'ok',
      truncated: false,
    });
  });

  it('round-trips an archived generation through the generation parameter', async () => {
    const { url } = startViewer();

    const response = await fetch(endpoint(url, `/api/rooms/${ROOM_ID}?generation=1`));
    expect(response.status).toBe(200);

    const detail = (await response.json()) as RoomDetail;
    expect(detail.room).toMatchObject({
      key: `${ROOM_ID}@1`,
      kind: 'archive',
      generation: 1,
      goal: 'Archived generation one',
    });
    expect(detail.timeline.map((entry) => entry.id)).toEqual(['gen1-post']);
  });

  it('answers an unknown room with a JSON not-found error', async () => {
    const { url } = startViewer();

    const response = await fetch(endpoint(url, '/api/rooms/ses_absent'));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expectErrorBody(await response.json(), 'room_not_found');
  });

  it('supports HEAD and rejects other methods', async () => {
    const { url } = startViewer();

    const head = await fetch(endpoint(url, '/api/rooms'), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const post = await fetch(endpoint(url, '/api/rooms'), { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    expectErrorBody(await post.json(), 'method_not_allowed');
  });
});

describe('unsafe room identifiers', () => {
  const unsafeIds = [
    '..%2F..%2Fetc%2Fpasswd',
    '..%2Fsecret.txt',
    'a%2Fb',
    'a%5Cb',
    'ses_live%00',
    'bad%20id',
    'x'.repeat(129),
  ];

  // The URL parser turns an encoded dot segment into path structure before the
  // router sees it (`%2e%2e` -> `/api/`, `%2e` -> `/api/rooms/`), so it can
  // never name an id. It must still never resolve a file outside the store.
  const normalizedDotSegments = ['%2e%2e', '%2e'];

  it('rejects traversal, separators and malformed ids before touching the filesystem', async () => {
    const { url } = startViewer();

    for (const id of unsafeIds) {
      const response = await fetch(endpoint(url, `/api/rooms/${id}`));
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
      expectErrorBody(await response.json(), 'invalid_room_id');
    }
  });

  it('never resolves a path outside the room store', async () => {
    const { url } = startViewer();

    for (const id of [...unsafeIds, ...normalizedDotSegments]) {
      const response = await fetch(endpoint(url, `/api/rooms/${id}`));
      expect(await response.text()).not.toContain('OUTSIDE-THE-ROOM-STORE');
    }

    const dotDot = await fetch(endpoint(url, '/api/rooms/%2e%2e'));
    expect(dotDot.status).toBe(404);
    expectErrorBody(await dotDot.json(), 'not_found');
  });

  it('rejects malformed generations with a client error', async () => {
    const { url } = startViewer();

    for (const generation of ['0', '-1', 'abc', '1.5', '']) {
      const response = await fetch(endpoint(url, `/api/rooms/${ROOM_ID}?generation=${generation}`));
      expect(response.status).toBe(400);
      expectErrorBody(await response.json(), 'invalid_generation');
    }
  });

  it('reports a valid but unknown generation as not found', async () => {
    const { url } = startViewer();

    const response = await fetch(endpoint(url, `/api/rooms/${ROOM_ID}?generation=99`));
    expect(response.status).toBe(404);
    expectErrorBody(await response.json(), 'room_not_found');
  });
});

describe('event stream', () => {
  it('announces a room change to every client and keeps heartbeats flowing', async () => {
    const { server, url, workspace } = startViewer();
    await server.ready();
    const first = await subscribe(url);
    const second = await subscribe(url);

    expect((await nextFrame(first, 2_000)).event).toBe('hello');
    expect((await nextFrame(second, 2_000)).event).toBe('hello');
    expect(server.streamClients()).toBe(2);

    // Change the file with a different size so the watcher sees a real change.
    writeFileSync(
      join(workspace, LIVE_PATH),
      JSON.stringify(roomDocument({ goal: 'Stream the forum transcript, now changed' })),
    );

    for (const client of [first, second]) {
      const frame = await awaitFrame(client, (candidate) => candidate.event === 'room');
      expect(JSON.parse(frame.data)).toEqual({
        key: ROOM_ID,
        id: ROOM_ID,
        kind: 'live',
        change: 'changed',
      });
    }

    const heartbeat = await awaitFrame(first, (candidate) => candidate.event === 'heartbeat');
    expect(typeof JSON.parse(heartbeat.data).now).toBe('string');

    const thirdPath = join(
      workspace,
      '.pas',
      'rooms',
      'archive',
      ROOM_ID,
      'generation-3-2026-11-02T10-00-00-000Z-z.json',
    );
    writeFileSync(thirdPath, JSON.stringify(roomDocument({ generation: 3, goal: 'Third generation' })));

    for (const client of [first, second]) {
      const frame = await awaitFrame(
        client,
        (candidate) => candidate.event === 'room' && candidate.data.includes('"generation":3'),
      );
      expect(JSON.parse(frame.data)).toEqual({
        key: `${ROOM_ID}@3`,
        id: ROOM_ID,
        kind: 'archive',
        generation: 3,
        change: 'added',
      });
    }
  });

  it('removes a client from the hub when the connection aborts', async () => {
    const { server, url } = startViewer();
    const client = await subscribe(url);
    expect((await nextFrame(client, 2_000)).event).toBe('hello');
    expect(server.streamClients()).toBe(1);

    client.controller.abort();
    await waitFor(() => server.streamClients() === 0);

    const health = await fetch(endpoint(url, '/api/health'));
    expect(await health.json()).toEqual({ ok: true });
  });
});
