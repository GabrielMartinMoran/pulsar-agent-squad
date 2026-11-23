import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Static assets for the read-only viewer.
 *
 * Paths are a fixed allowlist resolved from this module's directory, never
 * from the caller's working directory, and no client-supplied path reaches the
 * filesystem. The browser bundle is built in memory on the first request and
 * cached for the life of the process.
 */

export interface ForumAsset {
  body: string;
  contentType: string;
}

export const ASSET_PATHS = ['/', '/app.js', '/styles.css', '/favicon.svg'] as const;
export type AssetPath = (typeof ASSET_PATHS)[number];

const WEB_ROOT = join(import.meta.dir, 'web');
const CLIENT_ENTRY = join(WEB_ROOT, 'client', 'main.ts');

const FILE_ASSETS: Record<Exclude<AssetPath, '/app.js'>, { file: string; contentType: string }> = {
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', contentType: 'text/css; charset=utf-8' },
  '/favicon.svg': { file: 'favicon.svg', contentType: 'image/svg+xml' },
};

export class AssetBuildError extends Error {
  readonly logs: string[];

  constructor(message: string, logs: string[] = []) {
    super(message);
    this.name = 'AssetBuildError';
    this.logs = logs;
  }
}

export function isAssetPath(pathname: string): pathname is AssetPath {
  return (ASSET_PATHS as readonly string[]).includes(pathname);
}

let cache: Promise<ReadonlyMap<AssetPath, ForumAsset>> | undefined;

/** Builds once and caches; a failed build is retried on the next request. */
export function loadAssets(): Promise<ReadonlyMap<AssetPath, ForumAsset>> {
  if (!cache) {
    cache = buildAssets().catch((error: unknown) => {
      cache = undefined;
      throw error;
    });
  }
  return cache;
}

function formatLog(log: unknown): string {
  if (typeof log === 'string') return log;
  if (log && typeof log === 'object' && 'message' in log) {
    return String((log as { message: unknown }).message);
  }
  return String(log);
}

async function bundleClient(): Promise<string> {
  // `write` is a Bun runtime option that the bundled bun-types version omitted
  // from BuildConfig; without it an `outdir` would be required, and the bundle
  // must stay in memory.
  type BuildOptions = Parameters<typeof Bun.build>[0] & { write?: boolean };
  const options: BuildOptions = {
    entrypoints: [CLIENT_ENTRY],
    target: 'browser',
    format: 'esm',
    write: false,
  };

  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build(options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AssetBuildError(`The forum client bundle failed: ${detail}`);
  }

  if (!result.success) {
    throw new AssetBuildError(
      'The forum client bundle failed to build.',
      result.logs.map(formatLog),
    );
  }

  const output = result.outputs[0];
  if (!output) throw new AssetBuildError('The forum client bundle produced no output.');
  return await output.text();
}

async function buildAssets(): Promise<ReadonlyMap<AssetPath, ForumAsset>> {
  const [index, styles, favicon, script] = await Promise.all([
    readFile(join(WEB_ROOT, 'index.html'), 'utf8'),
    readFile(join(WEB_ROOT, 'styles.css'), 'utf8'),
    readFile(join(WEB_ROOT, 'favicon.svg'), 'utf8'),
    bundleClient(),
  ]);

  return new Map<AssetPath, ForumAsset>([
    ['/', { body: index, contentType: FILE_ASSETS['/'].contentType }],
    ['/styles.css', { body: styles, contentType: FILE_ASSETS['/styles.css'].contentType }],
    ['/favicon.svg', { body: favicon, contentType: FILE_ASSETS['/favicon.svg'].contentType }],
    ['/app.js', { body: script, contentType: 'text/javascript; charset=utf-8' }],
  ]);
}
