import { describe, expect, it } from 'bun:test';
import {
  createTitleResolver,
  TITLE_CACHE_TTL_MS,
  TITLE_COMMAND,
  TITLE_DEADLINE_MS,
  type TitleCommandOutcome,
  type TitleRunner,
} from '../../src/cli/forum/titles';

interface Call {
  command: readonly string[];
  cwd: string;
  timeoutMs: number;
}

function runnerReturning(
  outcome: TitleCommandOutcome | (() => TitleCommandOutcome),
  calls: Call[] = [],
): TitleRunner {
  return (command, options) => {
    calls.push({ command, cwd: options.cwd, timeoutMs: options.timeoutMs });
    return typeof outcome === 'function' ? outcome() : outcome;
  };
}

function jsonOutcome(payload: unknown, exitCode = 0): TitleCommandOutcome {
  return { exitCode, stdout: JSON.stringify(payload) };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('session title resolution', () => {
  it('parses a successful listing with the documented command, workspace and budget', async () => {
    const calls: Call[] = [];
    const runner = runnerReturning(
      jsonOutcome([
        { id: 'ses_a', title: 'Panel en tiempo real' },
        { id: 'ses_b', title: '' },
        { id: 'ses_c' },
        { id: 'ses_d', title: '   ' },
        { id: 'ses_e', title: 'Second title' },
        { id: 42, title: 'not a session' },
        { title: 'no id' },
        null,
      ]),
      calls,
    );
    const resolver = createTitleResolver({ workspace: '/tmp/pulsar', runner });

    const titles = await resolver.resolve();

    expect([...titles.entries()]).toEqual([
      ['ses_a', 'Panel en tiempo real'],
      ['ses_e', 'Second title'],
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toEqual(TITLE_COMMAND);
    expect(calls[0]!.command).toEqual([
      'opencode',
      'session',
      'list',
      '--format',
      'json',
      '--max-count',
      '500',
    ]);
    expect(calls[0]!.cwd).toBe('/tmp/pulsar');
    expect(calls[0]!.timeoutMs).toBe(TITLE_DEADLINE_MS);
    expect(TITLE_DEADLINE_MS).toBe(2_500);
    expect(TITLE_CACHE_TTL_MS).toBe(30_000);
  });

  it('never throws and yields an empty map for a failed exit, invalid JSON or a foreign shape', async () => {
    const outcomes: TitleCommandOutcome[] = [
      { exitCode: 1, stdout: '[]' },
      { exitCode: null, stdout: '' },
      { exitCode: 0, stdout: 'not json at all' },
      { exitCode: 0, stdout: '{"sessions":[{"id":"ses_a","title":"Wrong shape"}]}' },
      { exitCode: 0, stdout: 'null' },
    ];

    for (const outcome of outcomes) {
      const resolver = createTitleResolver({
        workspace: '/tmp/pulsar',
        runner: runnerReturning(outcome),
      });
      await expect(resolver.resolve()).resolves.toEqual(new Map());
    }
  });

  it('turns a throwing runner into an empty map instead of an exception', async () => {
    const resolver = createTitleResolver({
      workspace: '/tmp/pulsar',
      runner: () => {
        throw new Error('opencode not found');
      },
    });

    await expect(resolver.resolve()).resolves.toEqual(new Map());
  });

  it('reuses the cached titles for the TTL and retries once it expires', async () => {
    let now = 1_000;
    let attempt = 0;
    const calls: Call[] = [];
    const runner: TitleRunner = (command, options) => {
      calls.push({ command, cwd: options.cwd, timeoutMs: options.timeoutMs });
      attempt += 1;
      return jsonOutcome([{ id: 'ses_a', title: `Attempt ${attempt}` }]);
    };
    const resolver = createTitleResolver({
      workspace: '/tmp/pulsar',
      runner,
      now: () => now,
    });

    expect((await resolver.resolve()).get('ses_a')).toBe('Attempt 1');
    expect((await resolver.resolve()).get('ses_a')).toBe('Attempt 1');
    expect(calls).toHaveLength(1);

    now += TITLE_CACHE_TTL_MS - 1;
    expect((await resolver.resolve()).get('ses_a')).toBe('Attempt 1');
    expect(calls).toHaveLength(1);

    now += 1;
    expect((await resolver.resolve()).get('ses_a')).toBe('Attempt 2');
    expect(calls).toHaveLength(2);
  });

  it('answers at its deadline when the runner never settles and keeps a late result for the next request', async () => {
    const pending = deferred<TitleCommandOutcome>();
    let calls = 0;
    const runner: TitleRunner = () => {
      calls += 1;
      return pending.promise;
    };
    const resolver = createTitleResolver({
      workspace: '/tmp/pulsar',
      runner,
      deadlineMs: 30,
      cacheTtlMs: 30_000,
    });

    const started = Date.now();
    const [first, second] = await Promise.all([resolver.resolve(), resolver.resolve()]);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1_000);
    expect(first.size).toBe(0);
    expect(second.size).toBe(0);
    // One attempt is shared by concurrent requests.
    expect(calls).toBe(1);
    expect(resolver.cached().size).toBe(0);

    // The attempt keeps running after the deadline; its result is cached for
    // the next request instead of being thrown away.
    pending.resolve(jsonOutcome([{ id: 'ses_a', title: 'Arrived late' }]));
    await Bun.sleep(5);

    expect(resolver.cached().get('ses_a')).toBe('Arrived late');
    expect((await resolver.resolve()).get('ses_a')).toBe('Arrived late');
    expect(calls).toBe(1);
  });
});
