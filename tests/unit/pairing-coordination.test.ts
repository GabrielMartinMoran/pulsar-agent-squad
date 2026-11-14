import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pasToolkit, { internals, type Room, type RoomMessage } from '../../src/tools/pas-toolkit';

const roots: string[] = [];
const coordination = internals as typeof internals & {
  roomUpdateCursor(room: Room): string;
  waitForUpdates(root: string, room: string, session: string,
    input?: { cursor?: string; wait_s?: number; unit?: string },
    timing?: { now(): number; sleep(ms: number): Promise<void>; signal?: { readonly aborted: boolean } }):
    Promise<{ messages: RoomMessage[]; state: Room; cursor: string; changed: boolean; timed_out: boolean }>;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pas-coordination-'));
  roots.push(root);
  await internals.openRoom(root, 'lead', 'lead', {
    goal: 'pairing', scope: ['one'], authorized_paths: ['src', 'tests'],
  });
  await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
  await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
  await internals.sendMessage(root, 'lead', 'driver', {
    to: '*', unit: 'one', type: 'open', body: 'starting',
  });
  await internals.readInbox(root, 'lead', 'peer', { wait_s: 0 });
  return root;
}

function clock(onPoll?: () => Promise<void>) {
  let elapsed = 0;
  let polled = false;
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
      if (!polled && onPoll) { polled = true; await onPoll(); }
    },
  };
}

async function evidence(root: string, stage: 'red' | 'green' | 'refactor') {
  return internals.recordEvidence(root, 'lead', 'driver', {
    unit: 'one', stage, command: 'bun test one',
    exit_code: stage === 'red' ? 1 : 0,
    output_excerpt: stage === 'red' ? 'assertion failed' : '1 pass',
  });
}

async function review(root: string, blocking = false, resolves: string[] = []) {
  return internals.auditUnit(root, 'lead', 'peer', {
    unit: 'one', command: 'bun test one', exit_code: blocking ? 1 : 0,
    output_excerpt: blocking ? 'assertion failed' : '1 pass', resolves,
    findings: [{ category: 'test', severity: blocking ? 'blocking' : 'info', detail: blocking ? 'needs correction' : 'independently verified' }],
  });
}

async function closeReviewed(root: string) {
  await evidence(root, 'red');
  await evidence(root, 'green');
  await review(root);
  await internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'verified' });
}

describe('waiting for meaningful room updates', () => {
  it('waits 10 seconds by default and allows another wait after timeout', async () => {
    const root = await fixture();
    const timing = clock();
    const first = await coordination.waitForUpdates(root, 'lead', 'peer', {}, timing);
    expect(timing.now()).toBe(10_000);
    expect(first).toMatchObject({ changed: false, timed_out: true, messages: [] });
    const second = await coordination.waitForUpdates(root, 'lead', 'peer', { cursor: first.cursor }, timing);
    expect(timing.now()).toBe(20_000);
    expect(second.cursor).toBe(first.cursor);
    expect(second.timed_out).toBe(true);
  });

  it('returns early for a message and marks only delivered messages read', async () => {
    const root = await fixture();
    const timing = clock(async () => {
      await internals.sendMessage(root, 'lead', 'driver', {
        to: 'peer', unit: 'one', type: 'reply', body: 'ready for review',
      });
    });
    const result = await coordination.waitForUpdates(root, 'lead', 'peer', {}, timing);
    expect(timing.now()).toBeLessThan(30_000);
    expect(result).toMatchObject({ changed: true, timed_out: false });
    expect(result.messages.map(m => m.body)).toEqual(['ready for review']);
    expect(await internals.readInbox(root, 'lead', 'peer', { wait_s: 0 })).toEqual([]);
  });

  it('returns on evidence already marked read, without a discussion message', async () => {
    const root = await fixture();
    const before = coordination.roomUpdateCursor(internals.roomState(root, 'lead'));
    const timing = clock(async () => { await evidence(root, 'red'); });
    const result = await coordination.waitForUpdates(root, 'lead', 'peer', { cursor: before }, timing);
    expect(result.messages).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.cursor).not.toBe(before);
    expect(timing.now()).toBeLessThan(30_000);
  });

  it('detects a state-only unit closure between wait calls', async () => {
    const root = await fixture();
    await evidence(root, 'red'); await evidence(root, 'green'); await review(root);
    const before = coordination.roomUpdateCursor(internals.roomState(root, 'lead'));
    await internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'verified' });
    const timing = clock();
    const result = await coordination.waitForUpdates(root, 'lead', 'peer', { cursor: before }, timing);
    expect(result.changed).toBe(true);
    expect(result.state.units.one.status).toBe('closed');
    expect(timing.now()).toBe(0);
  });

  it('does not treat read receipts or identical file rewrites as updates', async () => {
    const root = await fixture();
    await internals.sendMessage(root, 'lead', 'peer', {
      to: 'driver', unit: 'one', type: 'reply', body: 'question',
    });
    const before = coordination.roomUpdateCursor(internals.roomState(root, 'lead'));
    const timing = clock(async () => {
      await internals.readInbox(root, 'lead', 'driver', { wait_s: 0 });
      const path = internals.roomFilePath(root, 'lead');
      writeFileSync(path, readFileSync(path));
    });
    const result = await coordination.waitForUpdates(root, 'lead', 'peer', { cursor: before }, timing);
    expect(result.timed_out).toBe(true);
    expect(result.cursor).toBe(before);
    expect(timing.now()).toBe(10_000);
  });

  it('returns promptly on abort and reset instead of waiting out the timeout', async () => {
    for (const reset of [false, true]) {
      const root = await fixture();
      const timing = clock(async () => {
        if (reset) await internals.resetRoom(root, 'lead', 'lead', { reason: 'replace pair' });
        else await internals.abortRoom(root, 'lead', 'lead', { reason: 'cancelled' });
      });
      const result = await coordination.waitForUpdates(root, 'lead', 'peer', {}, timing);
      expect(result.changed).toBe(true);
      expect(result.state.status).toBe(reset ? 'open' : 'aborted');
      expect(timing.now()).toBeLessThan(30_000);
    }
  });

  it('keeps an explicit nonblocking read and caps waits at 60 seconds', async () => {
    const root = await fixture();
    const immediate = clock();
    await coordination.waitForUpdates(root, 'lead', 'peer', { wait_s: 0 }, immediate);
    expect(immediate.now()).toBe(0);
    const capped = clock();
    await coordination.waitForUpdates(root, 'lead', 'peer', { wait_s: 300 }, capped);
    expect(capped.now()).toBe(60_000);
  });

  it('stops a cancelled tool wait without waiting for the full deadline', async () => {
    const root = await fixture();
    const controller = new AbortController();
    const timing = { ...clock(async () => controller.abort()), signal: controller.signal };
    await expect(coordination.waitForUpdates(root, 'lead', 'peer', {}, timing))
      .rejects.toThrow(/cancelled/);
    expect(timing.now()).toBeLessThan(30_000);
  });

  it('wakes on audit, reconciliation, escalation, and membership updates', async () => {
    for (const update of ['audit', 'reconcile', 'escalate', 'join']) {
      const root = await fixture();
      await evidence(root, 'red'); await evidence(root, 'green');
      const timing = clock(async () => {
        if (update === 'audit') await review(root);
        if (update === 'reconcile') await internals.reconcileFiles(root, 'lead', 'driver', { files: ['src/one.ts'] });
        if (update === 'escalate') await internals.escalateRoom(root, 'lead', 'driver', { action: 'fix_brief', reason: 'necessary contradiction' });
        if (update === 'join') {
          const path = internals.roomFilePath(root, 'lead');
          const state = internals.roomState(root, 'lead');
          state.members = state.members.filter(member => member.role !== 'peer');
          writeFileSync(path, JSON.stringify(state));
          await internals.joinRoom(root, 'lead', 'replacement', { role: 'peer' });
        }
      });
      const result = await coordination.waitForUpdates(root, 'lead', 'driver', {}, timing);
      expect(result.changed).toBe(true);
      expect(timing.now()).toBeLessThan(30_000);
    }
  });
});

describe('independent unit review', () => {
  it('cannot close without peer review, even with dissent', async () => {
    const root = await fixture();
    await evidence(root, 'red'); await evidence(root, 'green');
    await expect(internals.closeUnit(root, 'lead', 'driver', {
      unit: 'one', resolution: 'done', dissent: 'peer is still working',
    })).rejects.toThrow(/peer.*audit|peer.*review/);
  });

  it('requires a fresh executable review after the latest driver evidence', async () => {
    const root = await fixture();
    await evidence(root, 'red'); await evidence(root, 'green'); await review(root);
    await evidence(root, 'refactor');
    await expect(internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'done' }))
      .rejects.toThrow(/peer.*audit|peer.*review/);
    await review(root);
    expect((await internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'done' })).status).toBe('closed');
  });

  it('does not let a command-only observation substitute for executed review', async () => {
    const root = await fixture();
    await evidence(root, 'red'); await evidence(root, 'green');
    await internals.auditUnit(root, 'lead', 'peer', {
      unit: 'one', command: 'bun test one',
      findings: [{ category: 'evidence', severity: 'info', detail: 'observed command name' }],
    });
    await expect(internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'done' }))
      .rejects.toThrow(/executable peer audit/);
  });

  it('counts repeated blocking reviews of the same revision once', async () => {
    const root = await fixture();
    await evidence(root, 'red'); await evidence(root, 'green');
    for (let i = 0; i < 5; i++) await review(root, true);
    expect(internals.roomState(root, 'lead').units.one.correction_rounds).toBe(1);
    await evidence(root, 'refactor'); await review(root, true);
    expect(internals.roomState(root, 'lead').units.one.correction_rounds).toBe(2);
  });

  it('lets a verified peer resolution clear an existing finding without driver override', async () => {
    const root = await fixture();
    await evidence(root, 'red'); await evidence(root, 'green');
    const failing = await review(root, true);
    await evidence(root, 'refactor');
    await review(root, false, [failing.findings![0]!.id]);
    expect((await internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'fixed and verified' })).dissent).toBeUndefined();
  });

  it('rejects unresolved IDs from another unit and unsupported resolution claims', async () => {
    const root = await fixture();
    await evidence(root, 'red'); await evidence(root, 'green');
    const failing = await review(root, true);
    await expect(review(root, false, ['unknown-id'])).rejects.toThrow(/not in this unit/);
    await expect(internals.auditUnit(root, 'lead', 'peer', {
      unit: 'one', resolves: [failing.findings![0]!.id],
      findings: [{ category: 'test', severity: 'info', detail: 'claimed fixed' }],
    })).rejects.toThrow(/successful peer command evidence/);
  });
});

describe('stable final verification', () => {
  it('rejects a suite from before the final-ready handshake', async () => {
    const root = await fixture(); await closeReviewed(root);
    await internals.recordEvidence(root, 'lead', 'peer', {
      unit: 'one', stage: 'suite', command: 'bun run test', exit_code: 0, output_excerpt: 'all pass',
    });
    await internals.sendMessage(root, 'lead', 'driver', {
      unit: 'one', to: 'peer', type: 'ready_for_final_audit', body: 'tree stable; no more edits',
    });
    await expect(internals.endRoom(root, 'lead', 'driver', { wait_s: 0 })).rejects.toThrow(/final|stable/);
  });

  it('completes final handshake, reconciliation, end, and peer ack', async () => {
    const root = await fixture(); await closeReviewed(root);
    await internals.sendMessage(root, 'lead', 'driver', {
      unit: 'one', to: 'peer', type: 'ready_for_final_audit', body: 'tree stable',
    });
    await internals.readInbox(root, 'lead', 'peer', { wait_s: 0 });
    await internals.recordEvidence(root, 'lead', 'peer', {
      unit: 'one', stage: 'suite', command: 'bun run test', exit_code: 0, output_excerpt: 'all pass',
    });
    await internals.reconcileFiles(root, 'lead', 'driver', { files: ['src/one.ts'] });
    await internals.reconcileFiles(root, 'lead', 'peer', { files: ['src/one.ts'] });
    expect((await internals.endRoom(root, 'lead', 'driver', { wait_s: 0 })).status).toBe('awaiting_ack');
    const timing = clock();
    const ready = await coordination.waitForUpdates(root, 'lead', 'peer', {}, timing);
    expect(ready.state.status).toBe('awaiting_ack');
    expect(timing.now()).toBe(0);
    expect((await internals.ackRoom(root, 'lead', 'peer')).status).toBe('closed');
  });

  it('reopens a unit for an in-scope final correction and invalidates final readiness', async () => {
    const root = await fixture(); await closeReviewed(root);
    await internals.sendMessage(root, 'lead', 'driver', {
      unit: 'one', to: 'peer', type: 'ready_for_final_audit', body: 'tree stable',
    });
    await internals.sendMessage(root, 'lead', 'driver', {
      unit: 'one', to: 'peer', type: 'reopen', body: 'correct final finding',
    });
    expect(internals.roomState(root, 'lead').units.one.status).toBe('open');
    await expect(internals.endRoom(root, 'lead', 'driver', { wait_s: 0 })).rejects.toThrow(/closed|final/);
    await evidence(root, 'refactor'); await review(root);
    expect((await internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'corrected' })).status).toBe('closed');
  });
});

describe('coordination tool boundary', () => {
  it('exposes cursor waiting and executable audit evidence to installed agents', async () => {
    const root = await fixture();
    const tools = new Map<string, { input: { properties: Record<string, unknown> }; execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> }>();
    await pasToolkit.setup({
      location: { directory: root },
      session: { get: async ({ sessionID }: { sessionID: string }) =>
        sessionID === 'lead' ? { id: 'lead' } : { id: sessionID, parentID: 'lead' } },
      tool: { transform: async (register: (editor: { add(tool: unknown): void }) => void) =>
        register({ add: (tool: unknown) => {
          const entry = tool as { name: string } & NonNullable<ReturnType<typeof tools.get>>;
          tools.set(entry.name, entry);
        } }) },
    });
    expect(tools.get('pas_room_inbox')!.input.properties.cursor).toBeDefined();
    const inbox = await tools.get('pas_room_inbox')!.execute({ wait_s: 0 }, { sessionID: 'peer' });
    expect(inbox.content).toContain('Update cursor:');
    expect(inbox.content).toContain('wait again');
    const verification = await tools.get('pas_room_evidence')!.execute({
      unit: 'one', stage: 'verification', command: 'bun test one',
      exit_code: 0, output_excerpt: '1 pass',
    }, { sessionID: 'driver' });
    expect(verification.content).toContain('Recorded verification');
    const audit = await tools.get('pas_room_audit')!.execute({
      unit: 'one', command: 'bun test one', exit_code: 0, output_excerpt: '1 pass',
      findings: [{ category: 'test', severity: 'info', detail: 'verified' }],
    }, { sessionID: 'peer' });
    expect(audit.content).toContain('Recorded audit');
    const recorded = internals.transcript(root, 'lead').at(-1)!;
    expect(recorded.exit_code).toBe(0);
    expect(recorded.output_excerpt).toBe('1 pass');
    expect(audit.content).toContain(recorded.findings![0]!.id);
    expect((await internals.closeUnit(root, 'lead', 'driver', { unit: 'one', resolution: 'done' })).status).toBe('closed');
  });
});

describe('pairing prompts', () => {
  it('keeps both workers aboard until completion, real blockage, or budget exhaustion', () => {
    for (const name of ['pas_engineer', 'pas_copilot']) {
      const text = readFileSync(`src/agents/${name}.md`, 'utf-8').replace(/\s+/g, ' ');
      expect(text).toContain('Pending work by your partner is not a blocker');
      expect(text).toContain('wait_s: 10');
      expect(text).toContain('ready_for_final_audit');
    }
  });
});
