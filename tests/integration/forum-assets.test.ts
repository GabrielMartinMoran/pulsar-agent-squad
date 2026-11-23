import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createForumServer, type ForumServer } from '../../src/cli/forum/server';

const roots: string[] = [];
const servers: ForumServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspaceWithRoom(): string {
  const root = mkdtempSync(join(tmpdir(), 'pas-forum-assets-'));
  roots.push(root);
  const rooms = join(root, '.pas', 'rooms');
  mkdirSync(rooms, { recursive: true });
  writeFileSync(
    join(rooms, 'ses_assets.json'),
    JSON.stringify({
      id: 'ses_assets',
      status: 'open',
      generation: 1,
      goal: 'Serve the viewer assets',
      scope: ['Static assets'],
      members: [
        { sessionID: 'session-host', role: 'host' },
        { sessionID: 'session-driver', role: 'driver' },
        { sessionID: 'session-peer', role: 'peer' },
      ],
      messages: [],
      forum: { topics: [], posts: [], expected: {}, final_requested: false },
    }),
  );
  return root;
}

function startViewer(): ForumServer {
  const server = createForumServer({ workspace: workspaceWithRoom(), port: 0 });
  servers.push(server);
  return server;
}

function urlFor(server: ForumServer, path: string): URL {
  return new URL(path, server.url);
}

describe('forum static assets', () => {
  it('serves the page, script, stylesheet and favicon with declared types and no-store', async () => {
    const server = startViewer();
    const cases: Array<[string, string]> = [
      ['/', 'text/html'],
      ['/app.js', 'text/javascript'],
      ['/styles.css', 'text/css'],
      ['/favicon.svg', 'image/svg+xml'],
    ];

    for (const [path, contentType] of cases) {
      const response = await fetch(urlFor(server, path));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(contentType);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toBe("default-src 'self'");
      expect((await response.text()).length).toBeGreaterThan(0);
    }
  });

  it('serves the page shell that references both same-origin assets', async () => {
    const server = startViewer();
    const page = await (await fetch(urlFor(server, '/'))).text();

    expect(page).toContain('PAS forum viewer');
    expect(page).toContain('src="/app.js"');
    expect(page).toContain('href="/styles.css"');
    expect(page).toContain('href="/favicon.svg"');
    expect(page).not.toMatch(/https?:\/\//);
  });

  it('serves a browser bundle with no node specifier', async () => {
    const server = startViewer();
    const response = await fetch(urlFor(server, '/app.js'));
    const script = await response.text();

    expect(response.status).toBe(200);
    expect(script).not.toContain('node:');
    expect(script.length).toBeGreaterThan(500);
  });

  it('serves the stylesheet and favicon from disk', async () => {
    const server = startViewer();
    const styles = await (await fetch(urlFor(server, '/styles.css'))).text();
    const favicon = await (await fetch(urlFor(server, '/favicon.svg'))).text();

    expect(styles).toContain(':root');
    expect(styles).toContain('--rail-width');
    expect(favicon).toContain('<svg');
  });

  it('serves a stylesheet whose tokens are exactly the documented ones', async () => {
    const server = startViewer();
    const css = await (await fetch(urlFor(server, '/styles.css'))).text();
    const guidelines = readFileSync(join(import.meta.dir, '../../docs/ui-guidelines.md'), 'utf8');

    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]!));
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]!));
    const documented = new Set(
      [...guidelines.matchAll(/(--[a-z0-9-]+)/g)].map((match) => match[1]!),
    );
    // A Markdown table separator is not a custom property.
    documented.delete('---');

    expect([...documented].sort()).toEqual([...defined].sort());
    expect([...used].sort()).toEqual([...defined].sort());
  });

  it('serves a shell with the documented landmarks and states', async () => {
    const server = startViewer();
    const page = await (await fetch(urlFor(server, '/'))).text();
    const css = await (await fetch(urlFor(server, '/styles.css'))).text();
    const script = await (await fetch(urlFor(server, '/app.js'))).text();

    for (const marker of [
      'class="skip-link"',
      'role="tablist"',
      'role="tabpanel"',
      'aria-live="polite"',
      'aria-modal="true"',
      'id="theme-toggle"',
      'aria-expanded="false"',
      'aria-label="Sessions"',
      'aria-label="Session content"',
    ]) {
      expect(page).toContain(marker);
    }

    for (const marker of [
      ':focus-visible',
      '@media (prefers-reduced-motion: reduce)',
      '@media (max-width: 900px)',
      '[data-theme="light"]',
      '.session-row',
      '.rail-project',
      '.generation-picker',
    ]) {
      expect(css).toContain(marker);
    }

    for (const marker of [
      'aria-current',
      'aria-selected',
      'dataset.theme',
      'prefers-reduced-motion',
      '/api/sessions',
      'goal title',
      'generation-select',
    ]) {
      expect(script).toContain(marker);
    }
  });

  it('returns not-found for an unknown asset path and never reads the filesystem for it', async () => {
    const server = startViewer();

    for (const path of ['/nope', '/app.json', '/styles.css/extra', '/assets/app.js']) {
      const response = await fetch(urlFor(server, path));
      expect(response.status).toBe(404);
      expect(response.headers.get('content-security-policy')).toBe("default-src 'self'");
    }
  });

  it('answers HEAD for assets without a body', async () => {
    const server = startViewer();

    for (const path of ['/', '/app.js', '/styles.css', '/favicon.svg']) {
      const response = await fetch(urlFor(server, path), { method: 'HEAD' });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    }
  });

  it('rejects mutations on assets like every other route', async () => {
    const server = startViewer();
    const response = await fetch(urlFor(server, '/app.js'), { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
