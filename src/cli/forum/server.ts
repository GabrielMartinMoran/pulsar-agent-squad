import { basename } from 'node:path';
import type {
  ApiErrorBody,
  RoomChange,
  RoomDetail,
  RoomListResponse,
  SessionsResponse,
  StreamEventName,
  StreamTick,
} from './contract';
import { isAssetPath, loadAssets, type AssetPath, type ForumAsset } from './assets';
import { projectRoomDetail } from './project';
import { buildSessions } from './sessions';
import {
  assertRoomStore,
  InvalidRoomIdError,
  isSafeRoomId,
  listRooms,
  loadRoomEntry,
} from './store';
import { createTitleResolver, TITLE_DEADLINE_MS } from './titles';
import { watchRooms, type RoomWatcher } from './watch';

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'",
} as const;

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'",
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const;

const DEFAULT_HEARTBEAT_MS = 15_000;

export class PortUnavailableError extends Error {
  readonly port: number;
  readonly host: string;

  constructor(port: number, host: string, cause?: unknown) {
    super(`Could not bind ${host}:${port}: the port is already in use.`);
    this.name = 'PortUnavailableError';
    this.port = port;
    this.host = host;
    if (cause !== undefined) this.cause = cause;
  }
}

/** The part of a title resolver the server needs; injectable in tests. */
export interface ForumSessionTitles {
  resolve(): Promise<ReadonlyMap<string, string>>;
}

export interface ForumServerOptions {
  workspace: string;
  port?: number;
  host?: string;
  /** Room polling cadence; 400 ms keeps live updates under half a second. */
  watchIntervalMs?: number;
  /** Idle heartbeat cadence on the event stream. */
  heartbeatMs?: number;
  /**
   * OpenCode title resolver. Defaults to one CLI spawn per server, cached for
   * 30 s; tests inject a resolver so they never touch the real binary.
   */
  titles?: ForumSessionTitles;
  /** Hard cap on waiting for titles inside one request. */
  titleDeadlineMs?: number;
}

export interface ForumServer {
  url: string;
  port: number;
  host: string;
  /** Resolves once the first room scan finished and change tracking is live. */
  ready(): Promise<void>;
  /** Connected SSE clients, for diagnostics and lifecycle tests. */
  streamClients(): number;
  stop(): Promise<void>;
}

interface EventHub {
  subscribe(): ReadableStream<Uint8Array>;
  broadcast(change: RoomChange): void;
  close(): void;
  clientCount(): number;
}

function createEventHub(heartbeatMs: number): EventHub {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const frame = (event: StreamEventName, data: unknown): Uint8Array =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const stopTimer = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  const detach = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    clients.delete(controller);
    if (clients.size === 0) stopTimer();
  };

  const send = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    payload: Uint8Array,
  ): void => {
    try {
      controller.enqueue(payload);
    } catch {
      detach(controller);
    }
  };

  const startTimer = (): void => {
    if (timer !== undefined) return;
    timer = setInterval(() => {
      const tick: StreamTick = { now: new Date().toISOString() };
      for (const controller of [...clients]) send(controller, frame('heartbeat', tick));
    }, heartbeatMs);
  };

  return {
    subscribe(): ReadableStream<Uint8Array> {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

      return new ReadableStream<Uint8Array>({
        start(target) {
          controller = target;
          clients.add(target);
          const hello: StreamTick = { now: new Date().toISOString() };
          send(target, frame('hello', hello));
          startTimer();
        },
        cancel() {
          if (controller) detach(controller);
          controller = undefined;
        },
      });
    },
    broadcast(change: RoomChange): void {
      for (const controller of [...clients]) send(controller, frame('room', change));
    },
    close(): void {
      stopTimer();
      // The runtime closes the HTTP connections on server.stop(); closing the
      // controllers here as well leaves the response pipe waiting, so shutdown
      // only drops the hub's references.
      clients.clear();
    },
    clientCount(): number {
      return clients.size;
    },
  };
}

interface RequestContext {
  workspace: string;
  hub: EventHub;
  assets: () => Promise<ReadonlyMap<AssetPath, ForumAsset>>;
  titles: ForumSessionTitles;
  titleDeadlineMs: number;
}

function responseWithBody(
  body: string | null,
  contentType: string,
  status: number,
  head: boolean,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(head ? null : body, {
    status,
    headers: {
      'content-type': contentType,
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function jsonResponse(data: unknown, status: number, head: boolean): Response {
  return responseWithBody(
    JSON.stringify(data),
    'application/json; charset=utf-8',
    status,
    head,
  );
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  head: boolean,
  extraHeaders: Record<string, string> = {},
): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return new Response(head ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function sseResponse(head: boolean, hub: EventHub): Response {
  if (head) return new Response(null, { status: 200, headers: SSE_HEADERS });
  return new Response(hub.subscribe(), { status: 200, headers: SSE_HEADERS });
}

async function assetResponse(
  pathname: AssetPath,
  head: boolean,
  context: RequestContext,
): Promise<Response> {
  try {
    const asset = (await context.assets()).get(pathname);
    if (!asset) return errorResponse('not_found', `No route matches ${pathname}.`, 404, head);
    return responseWithBody(asset.body, asset.contentType, 200, head);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'The viewer assets could not be built.';
    console.error(`PAS forum viewer: ${message}`);
    return errorResponse('asset_build_failed', message, 500, head);
  }
}

function pathSegments(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment.length > 0);
}

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

const GENERATION_PATTERN = /^[1-9][0-9]*$/;

/** `undefined` when absent, `null` when present but not a positive integer. */
function parseGeneration(raw: string | null): number | null | undefined {
  if (raw === null) return undefined;
  if (!GENERATION_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Titles are optional decoration: a rejection, a synchronous throw or a slow
 * resolver all degrade to an empty map so `/api/sessions` still answers. The
 * timer is never left running, and a late resolver result is not awaited.
 */
async function titlesWithinDeadline(
  resolver: ForumSessionTitles,
  deadlineMs: number,
): Promise<ReadonlyMap<string, string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ReadonlyMap<string, string>>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(new Map()), deadlineMs);
  });

  try {
    const pending = Promise.resolve()
      .then(() => resolver.resolve())
      .catch(() => new Map<string, string>());
    return await Promise.race([pending, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function handleRequest(request: Request, context: RequestContext): Promise<Response> {
  const method = request.method.toUpperCase();
  const head = method === 'HEAD';

  if (method !== 'GET' && method !== 'HEAD') {
    return errorResponse('method_not_allowed', 'Only GET and HEAD are supported.', 405, head, {
      allow: 'GET, HEAD',
    });
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  try {
    if (isAssetPath(pathname)) {
      return await assetResponse(pathname, head, context);
    }
    if (pathname === '/api/health') {
      return jsonResponse({ ok: true }, 200, head);
    }
    if (pathname === '/api/events') {
      return sseResponse(head, context.hub);
    }

    const segments = pathSegments(pathname);
    if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'sessions') {
      const [rooms, titles] = await Promise.all([
        listRooms(context.workspace),
        titlesWithinDeadline(context.titles, context.titleDeadlineMs),
      ]);
      const body: SessionsResponse = {
        sessions: buildSessions(rooms, { project: basename(context.workspace), titles }),
      };
      return jsonResponse(body, 200, head);
    }

    if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'rooms') {
      const body: RoomListResponse = { rooms: await listRooms(context.workspace) };
      return jsonResponse(body, 200, head);
    }

    if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'rooms') {
      const id = decodeSegment(segments[2]!);
      if (id === undefined || !isSafeRoomId(id)) {
        return errorResponse(
          'invalid_room_id',
          'A room id may contain only letters, digits, dot, underscore and hyphen (1-128 characters).',
          400,
          head,
        );
      }

      const generation = parseGeneration(url.searchParams.get('generation'));
      if (generation === null) {
        return errorResponse(
          'invalid_generation',
          'The generation query parameter must be a positive integer.',
          400,
          head,
        );
      }

      const entry = await loadRoomEntry(context.workspace, id, generation);
      if (!entry) {
        const suffix = generation === undefined ? '' : ` at generation ${generation}`;
        return errorResponse('room_not_found', `No room '${id}'${suffix}.`, 404, head);
      }

      const detail: RoomDetail = projectRoomDetail(entry);
      return jsonResponse(detail, 200, head);
    }

    return errorResponse('not_found', `No route matches ${pathname}.`, 404, head);
  } catch (error) {
    if (error instanceof InvalidRoomIdError) {
      return errorResponse('invalid_room_id', error.message, 400, head);
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return errorResponse('internal_error', message, 500, head);
  }
}

function isAddressInUse(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === 'EADDRINUSE' || /in use/i.test(error.message);
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * Starts the loopback server. The room store is validated before any socket is
 * bound, so a failed startup never leaves a half-started viewer behind.
 */
export function createForumServer(options: ForumServerOptions): ForumServer {
  const workspace = options.workspace;
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4780;

  assertRoomStore(workspace);

  const hub = createEventHub(options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  const titles = options.titles ?? createTitleResolver({ workspace });
  const titleDeadlineMs = options.titleDeadlineMs ?? TITLE_DEADLINE_MS;
  const watcher: RoomWatcher = watchRooms({
    workspace,
    intervalMs: options.watchIntervalMs,
    onChange: (changes) => {
      for (const change of changes) hub.broadcast(change);
    },
  });

  let server: Bun.Server<undefined>;
  try {
    server = Bun.serve({
      hostname: host,
      port,
      fetch: (request) =>
        handleRequest(request, { workspace, hub, assets: loadAssets, titles, titleDeadlineMs }),
    });
  } catch (error) {
    watcher.stop();
    hub.close();
    if (isAddressInUse(error)) throw new PortUnavailableError(port, host, error);
    throw error;
  }

  const boundPort = server.port ?? port;

  return {
    url: `http://${formatHost(host)}:${boundPort}/`,
    port: boundPort,
    host,
    ready: () => watcher.ready,
    streamClients: () => hub.clientCount(),
    async stop(): Promise<void> {
      watcher.stop();
      hub.close();
      await server.stop(true);
    },
  };
}
