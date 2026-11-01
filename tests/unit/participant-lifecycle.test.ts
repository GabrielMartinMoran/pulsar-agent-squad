import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pasToolkit, { internals, type Room, type RoomUpdateResult } from '../../src/tools/pas-toolkit';

const roots: string[] = [];
const lifecycle = internals as typeof internals & {
  setParticipantActivity(root: string, room: string, session: string, input: Record<string, unknown>, at?: number): Promise<Room>;
  applyParticipantLifecycle(root: string, room: string, session: string, state: 'active' | 'finished' | 'unavailable', observedAt: number): Promise<void>;
  stopRoom(root: string, room: string, session: string, input: Record<string, unknown>, api: unknown, timers?: unknown): Promise<Room>;
  waitForUpdates(root: string, room: string, session: string, input?: Record<string, unknown>, timing?: unknown): Promise<RoomUpdateResult & { notice?: string; action_owner?: string }>;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pas-presence-'));
  roots.push(root);
  await internals.openRoom(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: ['src'] });
  await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
  await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
  await internals.sendMessage(root, 'lead', 'driver', { to: 'peer', unit: 'one', type: 'open', body: 'starting' });
  await internals.readInbox(root, 'lead', 'peer', { wait_s: 0 });
  return root;
}

function clock() {
  let elapsed = 0;
  return { now: () => elapsed, sleep: async (ms: number) => { elapsed += ms; } };
}

async function readyForFinal(root: string) {
  await internals.recordEvidence(root, 'lead', 'driver', { unit: 'one', stage: 'verification', command: 'bun test one', exit_code: 0, output_excerpt: '1 pass' });
  await internals.auditUnit(root, 'lead', 'peer', { unit: 'one', command: 'bun test one', exit_code: 0, output_excerpt: '1 pass', findings: [{ category: 'test', severity: 'info', detail: 'verified' }] });
  await internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'verified' });
  await internals.sendMessage(root, 'lead', 'driver', { unit: 'one', to: 'peer', type: 'ready_for_final_audit', body: 'tree stable' });
  await internals.readInbox(root, 'lead', 'peer', { wait_s: 0 });
}

describe('activity-aware waits', () => {
  it('uses a 10-second default and does not treat its own activity as progress', async () => {
    const root = await fixture();
    const timing = clock();
    const result = await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, timing);
    expect(timing.now()).toBe(10_000);
    expect(result.timed_out).toBe(true);
  });

  it('returns mutual wait promptly and elects the peer when review is ready', async () => {
    const root = await fixture();
    await internals.sendMessage(root, 'lead', 'driver', { to: 'peer', unit: 'one', type: 'propose_close', body: 'ready' });
    await internals.readInbox(root, 'lead', 'peer', { wait_s: 0 });
    await lifecycle.setParticipantActivity(root, 'lead', 'driver', { state: 'waiting_for_response', waiting_for: 'peer_review', unit: 'one' });
    const timing = clock();
    const result = await lifecycle.waitForUpdates(root, 'lead', 'peer', { waiting_for: 'driver_changes', unit: 'one' }, timing);
    expect(result.notice).toBe('MUTUAL_WAIT');
    expect(result.action_owner).toBe('peer');
    expect(timing.now()).toBe(0);
  });

  it('elects the peer when a later open unit is ready for review', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-multiple-units-'));
    roots.push(root);
    await internals.openRoom(root, 'lead', 'lead', { goal: 'pair', scope: ['one', 'two'], authorized_paths: ['src'] });
    await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
    for (const unit of ['one', 'two']) {
      await internals.sendMessage(root, 'lead', 'driver', { to: 'peer', unit, type: 'open', body: 'starting' });
    }
    await internals.sendMessage(root, 'lead', 'driver', { to: 'peer', unit: 'two', type: 'propose_close', body: 'ready' });
    await internals.readInbox(root, 'lead', 'peer', { wait_s: 0 });
    await lifecycle.setParticipantActivity(root, 'lead', 'driver', { state: 'waiting_for_response', waiting_for: 'peer_review' });
    const result = await lifecycle.waitForUpdates(root, 'lead', 'peer', { waiting_for: 'driver_changes' }, clock());
    expect(result.notice).toBe('MUTUAL_WAIT');
    expect(result.action_owner).toBe('peer');
  });

  it('reports each mutual-wait episode once per participant, not on every read', async () => {
    const root = await fixture();
    await lifecycle.setParticipantActivity(root, 'lead', 'peer', { state: 'waiting_for_response', waiting_for: 'driver_changes' });
    const timing = clock();
    const first = await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, timing);
    expect(first.notice).toBe('MUTUAL_WAIT');
    expect(first.action_owner).toBe('driver');
    const second = await lifecycle.waitForUpdates(root, 'lead', 'driver', { cursor: first.cursor }, timing);
    expect(second.notice).toBeUndefined();
    expect(second.action_owner).toBe('driver');
    expect(second.timed_out).toBe(true);
    expect(timing.now()).toBe(10_000);
  });

  it('does not confuse working with mutual waiting or wake on activity-only changes', async () => {
    const root = await fixture();
    const before = internals.roomUpdateCursor(internals.roomState(root, 'lead'));
    await lifecycle.setParticipantActivity(root, 'lead', 'peer', { state: 'working' });
    expect(internals.roomUpdateCursor(internals.roomState(root, 'lead'))).toBe(before);
    const result = await lifecycle.waitForUpdates(root, 'lead', 'driver', { cursor: before }, clock());
    expect(result.notice).toBeUndefined();
    expect(result.timed_out).toBe(true);
  });

  it('only lets a worker declare its own state', async () => {
    const root = await fixture();
    await expect(lifecycle.setParticipantActivity(root, 'lead', 'driver', { state: 'finished', target: 'peer' }))
      .rejects.toThrow(/own|host/);
    await expect(lifecycle.setParticipantActivity(root, 'lead', 'lead', { state: 'finished', target: 'peer', reason: 'returned' }))
      .rejects.toThrow(/session|generation/);
  });

  it('elects the driver to close an already audited unit and the peer for final checks', async () => {
    const root = await fixture();
    await internals.recordEvidence(root, 'lead', 'driver', { unit: 'one', stage: 'verification', command: 'bun test one', exit_code: 0, output_excerpt: '1 pass' });
    await internals.auditUnit(root, 'lead', 'peer', { unit: 'one', command: 'bun test one', exit_code: 0, output_excerpt: '1 pass', findings: [{ category: 'test', severity: 'info', detail: 'verified' }] });
    await lifecycle.setParticipantActivity(root, 'lead', 'peer', { state: 'waiting_for_response' });
    const close = await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, clock());
    expect(close.action_owner).toBe('driver');
    await internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'verified' });
    await internals.sendMessage(root, 'lead', 'driver', { unit: 'one', to: 'peer', type: 'ready_for_final_audit', body: 'tree stable' });
    await internals.readInbox(root, 'lead', 'peer', { wait_s: 0 });
    const final = await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, clock());
    expect(final.action_owner).toBe('peer');
  });

  it('does not declare a nonblocking peek as waiting and ignores stale waiting state', async () => {
    const root = await fixture();
    await lifecycle.waitForUpdates(root, 'lead', 'driver', { wait_s: 0 }, clock());
    expect(internals.renderRoomState(internals.roomState(root, 'lead'))).toContain('driver: active / working');
    await lifecycle.setParticipantActivity(root, 'lead', 'peer', { state: 'waiting_for_response' });
    let now = Date.now() + 121_000;
    const result = await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, { now: () => now, sleep: async (ms: number) => { now += ms; } });
    expect(result.notice).toBeUndefined();
    expect(result.timed_out).toBe(true);
  });

  it('clears a cancelled wait without presenting it as progress', async () => {
    const root = await fixture();
    const controller = new AbortController();
    const before = internals.roomUpdateCursor(internals.roomState(root, 'lead'));
    const timing = { now: () => 0, sleep: async () => controller.abort(), signal: controller.signal };
    await expect(lifecycle.waitForUpdates(root, 'lead', 'driver', {}, timing)).rejects.toThrow(/cancelled/);
    expect(internals.renderRoomState(internals.roomState(root, 'lead'))).toContain('driver: active / working');
    expect(internals.roomUpdateCursor(internals.roomState(root, 'lead'))).toBe(before);
  });
});

describe('availability is not room membership', () => {
  it('never infers finished from a per-step execution event or idle timestamp', async () => {
    const root = await fixture();
    await lifecycle.applyParticipantLifecycle(root, 'lead', 'peer', 'finished', Date.now() + 1000);
    expect(internals.renderRoomState(internals.roomState(root, 'lead'))).toContain('peer: active');
    expect((await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, clock())).notice).toBeUndefined();
  });

  it('lets the host mark the exact returned session finished without pretending to resume it', async () => {
    const root = await fixture();
    await lifecycle.setParticipantActivity(root, 'lead', 'lead', {
      state: 'finished', target: 'peer', participant_session: 'peer', expected_generation: 1, reason: 'child returned BLOCKED',
    });
    const result = await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, clock());
    expect(result.notice).toBe('PEER_UNAVAILABLE');
    const notice = internals.buildRoomNotice(internals.roomState(root, 'lead'), 'driver');
    expect(notice).toContain('peer (session peer, generation 1)');
    expect(internals.buildRoomNotice(internals.roomState(root, 'lead'), 'peer') ?? '').not.toContain('PEER_UNAVAILABLE');
    await expect(lifecycle.setParticipantActivity(root, 'lead', 'lead', {
      state: 'finished', target: 'peer', participant_session: 'old-peer', expected_generation: 1, reason: 'late old result',
    })).rejects.toThrow(/session/);
  });

  it('lets a live worker reactivate itself after a stale availability report', async () => {
    const root = await fixture();
    await lifecycle.setParticipantActivity(root, 'lead', 'lead', {
      state: 'finished', target: 'peer', participant_session: 'peer', expected_generation: 1, reason: 'stale report',
    });
    expect((await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, clock())).notice).toBe('PEER_UNAVAILABLE');
    await lifecycle.setParticipantActivity(root, 'lead', 'peer', { state: 'working' });
    expect(internals.renderRoomState(internals.roomState(root, 'lead'))).toContain('peer: active');
    expect((await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, clock())).notice).toBeUndefined();
  });

  it('ignores execution-started events older than the member join', async () => {
    const root = await fixture();
    const joinedAt = internals.roomState(root, 'lead').activities?.peer?.joined_at ?? Date.now();
    await lifecycle.setParticipantActivity(root, 'lead', 'lead', {
      state: 'finished', target: 'peer', participant_session: 'peer', expected_generation: 1, reason: 'returned',
    }, joinedAt + 1000);
    await lifecycle.applyParticipantLifecycle(root, 'lead', 'peer', 'active', joinedAt - 1);
    expect(internals.renderRoomState(internals.roomState(root, 'lead'))).toContain('peer: finished');
    await lifecycle.applyParticipantLifecycle(root, 'lead', 'peer', 'active', joinedAt + 1001);
    expect(internals.renderRoomState(internals.roomState(root, 'lead'))).toContain('peer: active');
  });

  it('ignores late lifecycle events for retired members', async () => {
    const root = await fixture();
    await internals.resetRoom(root, 'lead', 'lead', { reason: 'fresh pair' });
    await lifecycle.applyParticipantLifecycle(root, 'lead', 'peer', 'active', Date.now());
    expect(internals.roomState(root, 'lead').generation).toBe(2);
    expect(internals.roomState(root, 'lead').members).toEqual([{ sessionID: 'lead', role: 'host' }]);
  });

  it('does not report an unavailable peer after successful end and ack', async () => {
    const root = await fixture(); await readyForFinal(root);
    await internals.recordEvidence(root, 'lead', 'peer', { unit: 'one', stage: 'suite', command: 'bun run test', exit_code: 0, output_excerpt: 'all pass' });
    await internals.reconcileFiles(root, 'lead', 'driver', { files: [] });
    await internals.reconcileFiles(root, 'lead', 'peer', { files: [] });
    await internals.endRoom(root, 'lead', 'driver', { wait_s: 0 });
    await internals.ackRoom(root, 'lead', 'peer');
    await lifecycle.applyParticipantLifecycle(root, 'lead', 'peer', 'finished', Date.now());
    expect((await lifecycle.waitForUpdates(root, 'lead', 'driver', {}, clock())).notice).toBeUndefined();
    expect(internals.buildRoomNotice(internals.roomState(root, 'lead'), 'lead')).toBeNull();
  });
});

describe('host killswitch', () => {
  it('aborts before interrupting both sessions and never targets the host', async () => {
    const root = await fixture();
    const called: string[] = [];
    const api = { interrupt: async ({ sessionID, resume }: { sessionID: string; resume: boolean }) => {
      expect(internals.roomState(root, 'lead').status).toBe('aborted');
      expect(resume).toBe(false); called.push(sessionID); return { interrupted: true };
    } };
    const stopped = await lifecycle.stopRoom(root, 'lead', 'lead', { reason: 'pair hung' }, api);
    expect(called.sort()).toEqual(['driver', 'peer']);
    expect(stopped.status).toBe('aborted');
    expect(internals.renderRoomState(stopped)).toContain('interrupted');
    await lifecycle.stopRoom(root, 'lead', 'lead', { reason: 'already stopped' }, api);
    expect(called).toHaveLength(2);
  });

  it('supports selective stop and reports an already idle session truthfully', async () => {
    const root = await fixture();
    const called: string[] = [];
    const api = { interrupt: async ({ sessionID }: { sessionID: string }) => { called.push(sessionID); return { interrupted: false }; } };
    const result = await lifecycle.stopRoom(root, 'lead', 'lead', { target: 'peer', reason: 'peer stopped responding' }, api);
    expect(called).toEqual(['peer']);
    expect(internals.renderRoomState(result)).toContain('already_finished');
  });

  it('rejects workers, stale generations, invalid targets and empty reasons before interrupting', async () => {
    const root = await fixture();
    let calls = 0;
    const api = { interrupt: async () => { calls++; return { interrupted: true }; } };
    for (const [session, input] of [
      ['driver', { reason: 'kill peer' }],
      ['lead', { expected_generation: 0, reason: 'stale stop' }],
      ['lead', { target: 'outside-session', reason: 'invalid' }],
      ['lead', { reason: ' ' }],
    ] as const) await expect(lifecycle.stopRoom(root, 'lead', session, input, api)).rejects.toThrow();
    expect(calls).toBe(0);
    expect(internals.roomState(root, 'lead').status).toBe('open');
  });

  it('records partial failures rather than claiming both sessions were stopped', async () => {
    const root = await fixture();
    const api = { interrupt: async ({ sessionID }: { sessionID: string }) => {
      if (sessionID === 'peer') throw new Error('runtime refused');
      return { interrupted: true };
    } };
    const result = await lifecycle.stopRoom(root, 'lead', 'lead', { reason: 'hang' }, api);
    const text = internals.renderRoomState(result);
    expect(text).toContain('driver: interrupted');
    expect(text).toContain('peer: failed');
    await expect(internals.resetRoom(root, 'lead', 'lead', { reason: 'unsafe replacement' })).rejects.toThrow(/stop|interrupt/);
  });

  it('times out a hung interrupt and requests cancellation instead of hanging itself', async () => {
    const root = await fixture();
    let signal: AbortSignal | undefined;
    const api = { interrupt: async (_input: unknown, options: { signal: AbortSignal }) => {
      signal = options.signal; return await new Promise(() => {});
    } };
    const timers = { setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1; }, clearTimeout: () => {} };
    const result = await lifecycle.stopRoom(root, 'lead', 'lead', { target: 'peer', reason: 'hang' }, api, timers);
    expect(signal?.aborted).toBe(true);
    expect(internals.renderRoomState(result)).toContain('peer: timeout');
  });

  it('does not modify a replacement generation when an old interrupt finishes late', async () => {
    const root = await fixture();
    const called: string[] = [];
    const api = { interrupt: async ({ sessionID }: { sessionID: string }) => {
      called.push(sessionID);
      const room = internals.roomState(root, 'lead');
      room.generation = 2; room.status = 'open'; delete room.stop;
      room.members = [{ role: 'host', sessionID: 'lead' }, { role: 'peer', sessionID: 'new-peer' }];
      writeFileSync(internals.roomFilePath(root, 'lead'), JSON.stringify(room));
      return { interrupted: true };
    } };
    await expect(lifecycle.stopRoom(root, 'lead', 'lead', { target: 'peer', reason: 'stop old peer' }, api)).rejects.toThrow(/retired generation/);
    expect(called).toEqual(['peer']);
    expect(internals.roomState(root, 'lead').status).toBe('open');
    expect(internals.roomState(root, 'lead').members.at(-1)?.sessionID).toBe('new-peer');
  });

  it('invalidates stop confirmation if execution restarts and does not spam duplicate events', async () => {
    const root = await fixture();
    const api = { interrupt: async () => ({ interrupted: true }) };
    await lifecycle.stopRoom(root, 'lead', 'lead', { reason: 'stop pair' }, api);
    const at = Date.now() + 10;
    await lifecycle.applyParticipantLifecycle(root, 'lead', 'driver', 'active', at);
    const count = internals.transcript(root, 'lead').length;
    await lifecycle.applyParticipantLifecycle(root, 'lead', 'driver', 'active', at);
    expect(internals.transcript(root, 'lead')).toHaveLength(count);
    await expect(internals.resetRoom(root, 'lead', 'lead', { reason: 'unsafe' })).rejects.toThrow(/unconfirmed/);
  });

  it('reports missing runtime capability and requires stopping an unselected writer before reset', async () => {
    const root = await fixture();
    const missing = await lifecycle.stopRoom(root, 'lead', 'lead', { target: 'peer', reason: 'hang' }, {});
    expect(internals.renderRoomState(missing)).toContain('peer: failed');
    const called: string[] = [];
    const api = { interrupt: async ({ sessionID }: { sessionID: string }) => { called.push(sessionID); return { interrupted: true }; } };
    await lifecycle.stopRoom(root, 'lead', 'lead', { target: 'peer', reason: 'retry' }, api);
    await expect(internals.resetRoom(root, 'lead', 'lead', { reason: 'writer still running' })).rejects.toThrow(/unconfirmed/);
    await lifecycle.stopRoom(root, 'lead', 'lead', { reason: 'stop remaining writer' }, api);
    expect(called).toEqual(['peer', 'driver']);
    expect((await internals.resetRoom(root, 'lead', 'lead', { reason: 'safe fresh pair' })).room.generation).toBe(2);
  });

  it('can independently confirm already finished participants after a failed stop request', async () => {
    const root = await fixture();
    await lifecycle.stopRoom(root, 'lead', 'lead', { reason: 'stop pair' }, {});
    for (const role of ['driver', 'peer']) {
      await lifecycle.setParticipantActivity(root, 'lead', 'lead', {
        state: 'finished', target: role, participant_session: role, expected_generation: 1,
        reason: 'parent received the returned child result',
      }, Date.now() + 10);
    }
    expect((await internals.resetRoom(root, 'lead', 'lead', { reason: 'host confirmed both returned' })).room.generation).toBe(2);
  });
});

describe('runtime adapter and permissions', () => {
  it('does not let a late host completion report mark a running or different session finished', async () => {
    const root = await fixture();
    const tools = new Map<string, { execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> }>();
    const reads: string[] = [];
    let idle = 100;
    let busy: number | undefined = 200;
    await pasToolkit.setup({
      location: { directory: root },
      session: { get: async ({ sessionID }: { sessionID: string }) => {
        reads.push(sessionID);
        return sessionID === 'lead' ? { id: sessionID } : { id: sessionID, parentID: 'lead', time: { idle, busy } };
      } },
      tool: { transform: async (callback: (editor: { add(tool: unknown): void }) => void) => callback({ add: (tool: unknown) => {
        const entry = tool as { name: string } & NonNullable<ReturnType<typeof tools.get>>;
        tools.set(entry.name, entry);
      } }) },
    });
    const report = { state: 'finished', target: 'peer', participant_session: 'peer', expected_generation: 1, reason: 'old completion' };
    const active = await tools.get('pas_room_activity')!.execute(report, { sessionID: 'lead' });
    expect(active.content).toContain('does not confirm');
    await tools.get('pas_room_activity')!.execute({ ...report, participant_session: 'outside-session' }, { sessionID: 'lead' });
    expect(reads).not.toContain('outside-session');
    busy = undefined;
    idle = Date.now() + 5000;
    const finished = await tools.get('pas_room_activity')!.execute(report, { sessionID: 'lead' });
    expect(finished.content).toContain('peer: finished');
  });

  it('registers real stop and activity tools and disposes its lifecycle subscription', async () => {
    const root = await fixture();
    const registered = new Map<string, { execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> }>();
    const interrupted: string[] = [];
    let subscriptionSignal: AbortSignal | undefined;
    let eventProcessed!: () => void;
    const processed = new Promise<void>(resolve => { eventProcessed = resolve; });
    const eventAt = Date.now();
    const cleanup = await pasToolkit.setup({
      location: { directory: root },
      session: { get: async ({ sessionID }: { sessionID: string }) => ({
        id: sessionID, ...(sessionID === 'lead' ? {} : { parentID: 'lead', time: { idle: Date.now() + 5000 } }),
      }), interrupt: async ({ sessionID, resume }: { sessionID: string; resume: boolean }) => {
          expect(internals.roomState(root, 'lead').status).toBe('aborted');
          expect(resume).toBe(false);
          interrupted.push(sessionID);
          return { interrupted: true };
        } },
      event: { subscribe: ({ signal }: { signal: AbortSignal }) => {
        subscriptionSignal = signal;
        return (async function* () {
          yield { type: 'session.execution.started', created: eventAt, data: { sessionID: 'peer' } };
          yield { type: 'session.execution.succeeded', created: eventAt + 1, data: { sessionID: 'peer' } };
          eventProcessed();
        })();
      } },
      tool: { transform: async (callback: (editor: { add(tool: unknown): void }) => void) => callback({ add: (tool: unknown) => {
        const entry = tool as { name: string } & NonNullable<ReturnType<typeof registered.get>>;
        registered.set(entry.name, entry);
      } }) },
    } as Parameters<typeof pasToolkit.setup>[0]);
    expect(registered.has('pas_room_stop')).toBe(true);
    expect(registered.has('pas_room_activity')).toBe(true);
    await processed;
    expect(internals.buildRoomNotice(internals.roomState(root, 'lead'), 'lead')).toBeNull();
    await registered.get('pas_room_activity')!.execute({
      state: 'finished', target: 'peer', participant_session: 'peer', expected_generation: 1, reason: 'returned',
    }, { sessionID: 'lead' });
    expect(internals.buildRoomNotice(internals.roomState(root, 'lead'), 'lead')).toContain('PEER_UNAVAILABLE');
    const denied = await registered.get('pas_room_stop')!.execute({ reason: 'worker attempt' }, { sessionID: 'driver' });
    expect(denied.content).toContain('only the host');
    const stopped = await registered.get('pas_room_stop')!.execute({ reason: 'fixture hung', expected_generation: 1 }, { sessionID: 'lead' });
    expect(stopped.content).toContain('Killswitch recorded');
    expect(interrupted.sort()).toEqual(['driver', 'peer']);
    expect(typeof cleanup).toBe('function');
    if (typeof cleanup === 'function') cleanup();
    expect(subscriptionSignal?.aborted).toBe(true);
  });

  it('grants killswitch only to primaries and gives workers coordination guidance', () => {
    for (const name of ['Pulsar Agent Squad', 'Pulsar Agent Turbo', 'pas_engineer', 'pas_copilot']) {
      const text = readFileSync(`src/agents/${name}.md`, 'utf-8');
      expect(text).toContain('pas_room_stop');
      expect(text).toContain('PEER_UNAVAILABLE');
      expect(text).toContain('MUTUAL_WAIT');
      const effect = name.startsWith('pas_') ? 'deny' : 'allow';
      expect(text).toMatch(new RegExp(`action: pas_room_stop\\s+resource: "\\*"\\s+effect: ${effect}`));
    }
  });
});
