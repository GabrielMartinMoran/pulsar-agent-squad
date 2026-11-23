import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const CLI_ENTRY = join(REPO_ROOT, 'src/cli/index.ts');
const URL_PATTERN = /http:\/\/127\.0\.0\.1:\d+\//;

const roots: string[] = [];
const processes: Bun.Subprocess[] = [];

afterEach(() => {
  for (const process of processes.splice(0)) {
    if (process.exitCode === null) process.kill('SIGKILL');
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspaceWithRoom(): string {
  const root = mkdtempSync(join(tmpdir(), 'pas-forum-cli-'));
  roots.push(root);
  const rooms = join(root, '.pas', 'rooms');
  mkdirSync(rooms, { recursive: true });
  writeFileSync(
    join(rooms, 'ses_test.json'),
    JSON.stringify({
      id: 'ses_test',
      status: 'open',
      generation: 1,
      goal: 'Exercise the forum command',
      scope: ['Command lifecycle'],
      members: [
        { sessionID: 'session-host', role: 'host' },
        { sessionID: 'session-driver', role: 'driver' },
        { sessionID: 'session-peer', role: 'peer' },
      ],
      messages: [],
      forum: { topics: [], posts: [], expected: {}, final_requested: false },
      activities: {
        driver: { sessionID: 'session-driver', availability: 'active', state: 'working' },
        peer: { sessionID: 'session-peer', availability: 'active', state: 'working' },
      },
    }),
  );
  return root;
}

function spawnForum(workspace: string, extra: string[] = []): Bun.Subprocess {
  const child = Bun.spawn({
    cmd: [process.execPath, 'run', CLI_ENTRY, 'forum', '--workspace', workspace, '--no-open', ...extra],
    cwd: REPO_ROOT,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  processes.push(child);
  return child;
}

async function readUntil(
  stream: ReadableStream<Uint8Array> | number | undefined,
  pattern: RegExp,
  timeoutMs = 10_000,
): Promise<string> {
  if (!(stream instanceof ReadableStream)) throw new Error('expected a piped stdout stream');
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = '';

  try {
    while (Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout('timeout'), Math.max(1, deadline - Date.now()));
      });
      const result = await Promise.race([reader.read(), timeout]);
      if (timer) clearTimeout(timer);
      if (result === 'timeout') break;
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const match = buffer.match(pattern);
      if (match) return match[0];
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error(`Expected ${pattern} within ${timeoutMs}ms. Output so far: ${buffer.slice(-2_000)}`);
}

async function textOf(stream: ReadableStream<Uint8Array> | number | undefined): Promise<string> {
  if (!(stream instanceof ReadableStream)) throw new Error('expected a piped stream');
  return await new Response(stream).text();
}

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

describe('forum command', () => {
  it(
    'prints the served URL and answers with the viewer page',
    async () => {
      const workspace = workspaceWithRoom();
      const child = spawnForum(workspace, ['--port', '0']);

      const url = await readUntil(child.stdout, URL_PATTERN);
      const page = await fetch(url);

      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(page.headers.get('cache-control')).toBe('no-store');
      expect(page.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await page.text()).toContain('PAS forum viewer');

      const health = await fetch(new URL('/api/health', url));
      expect(await health.json()).toEqual({ ok: true });

      const rooms = (await (await fetch(new URL('/api/rooms', url))).json()) as {
        rooms: Array<{ id: string }>;
      };
      expect(rooms.rooms).toHaveLength(1);
      expect(rooms.rooms[0]!.id).toBe('ses_test');

      child.kill('SIGINT');
      expect(await child.exited).toBe(0);
    },
    15_000,
  );

  it(
    'fails with guidance when the workspace has no room store',
    async () => {
      const workspace = mkdtempSync(join(tmpdir(), 'pas-forum-empty-'));
      roots.push(workspace);
      const child = spawnForum(workspace, ['--port', '0']);

      const [stderr, exitCode] = await Promise.all([textOf(child.stderr), child.exited]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('No PAS room store');
      expect(stderr).toContain('.pas/rooms');
      expect(stderr).toContain('--workspace');
    },
    15_000,
  );

  it(
    'fails on an occupied port, names the port and leaves no viewer route answering',
    async () => {
      const workspace = workspaceWithRoom();
      const blocker = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => new Response('occupied', { headers: { 'content-type': 'text/plain' } }),
      });

      try {
        const port = blocker.port;
        const child = spawnForum(workspace, ['--port', String(port)]);
        const [stdout, stderr, exitCode] = await Promise.all([
          textOf(child.stdout),
          textOf(child.stderr),
          child.exited,
        ]);

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain(String(port));
        expect(stderr.toLowerCase()).toMatch(/in use|could not bind/);
        expect(stdout).not.toContain('PAS forum viewer:');

        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(await response.text()).toBe('occupied');
      } finally {
        await blocker.stop(true);
      }
    },
    15_000,
  );

  it(
    'stops the server and releases the port on interrupt',
    async () => {
      const workspace = workspaceWithRoom();
      const child = spawnForum(workspace, ['--port', '0']);

      const url = await readUntil(child.stdout, URL_PATTERN);
      expect(await isReachable(new URL('/api/health', url).href)).toBe(true);

      child.kill('SIGINT');
      const exitCode = await child.exited;

      expect(exitCode).toBe(0);
      expect(await isReachable(url)).toBe(false);
    },
    15_000,
  );
});
