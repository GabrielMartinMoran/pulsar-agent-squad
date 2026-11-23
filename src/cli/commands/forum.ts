import { defineCommand } from 'citty';
import { resolve } from 'node:path';
import { openBrowser } from '../forum/open';
import {
  createForumServer,
  PortUnavailableError,
  type ForumServer,
} from '../forum/server';
import { assertRoomStore, RoomStoreMissingError } from '../forum/store';

const DEFAULT_PORT = '4780';
const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function parsePort(raw: string | undefined): number {
  const value = Number(raw ?? DEFAULT_PORT);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(
      `Invalid --port '${raw ?? ''}'. Use an integer between 0 and 65535 (0 picks a free port).`,
    );
  }
  return value;
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function startViewer(workspace: string, host: string, port: number): ForumServer {
  try {
    return createForumServer({ workspace, port, host });
  } catch (error) {
    if (error instanceof PortUnavailableError) {
      fail(`${error.message} Stop the process using that port, or pass --port 0 to pick a free port.`);
    }
    fail(`Could not start the PAS forum viewer: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function waitForSignal(): Promise<void> {
  return new Promise((resolveSignal) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolveSignal();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

export const forumCommand = defineCommand({
  meta: {
    name: 'forum',
    description: 'Start the read-only local viewer for PAS pairing forums',
  },
  args: {
    port: {
      type: 'string',
      default: DEFAULT_PORT,
      description: 'Port to listen on (0 picks a free port)',
    },
    host: {
      type: 'string',
      default: DEFAULT_HOST,
      description: 'Interface to bind (loopback by default)',
    },
    open: {
      type: 'boolean',
      default: true,
      description: 'Open the viewer in the browser',
      negativeDescription: 'Do not open a browser',
    },
    workspace: {
      type: 'string',
      description: 'Workspace root (defaults to the current directory)',
    },
  },
  async run({ args }) {
    let port: number;
    try {
      port = parsePort(args.port);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }

    const workspace = resolve(args.workspace ?? process.cwd());
    const host = args.host?.trim() || DEFAULT_HOST;

    try {
      assertRoomStore(workspace);
    } catch (error) {
      if (error instanceof RoomStoreMissingError) fail(error.message);
      fail(
        `Could not read the room store in ${workspace}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const viewer = startViewer(workspace, host, port);

    console.log(`PAS forum viewer: ${viewer.url}`);
    if (!LOOPBACK_HOSTS.has(host)) {
      console.warn(`Warning: binding ${host} exposes the read-only viewer beyond loopback.`);
    }
    if (args.open !== false) openBrowser(viewer.url);

    await waitForSignal();
    await viewer.stop();
    console.log('PAS forum viewer stopped.');
    process.exit(0);
  },
});
