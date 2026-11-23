import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pasToolkit, { internals } from '../../src/tools/pas-toolkit';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pas-forum-'));
  roots.push(root);
  await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one', 'two'], authorized_paths: [] });
  await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
  await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
  return root;
}

const spawned = {
  get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, parentID: 'lead' }),
};
const noWait = { now: () => 0, sleep: async (_ms: number) => {} };

async function approveTopic(root: string, id = 'a', scenarios = ['one', 'two']) {
  await internals.forumOpenTopics(root, 'lead', 'driver', [{ id, title: 'First', scenarios }]);
  await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: id, category: 'ready_for_review', message: 'ready' }] });
  await internals.forumPost(root, 'lead', 'peer', { posts: [{
    topic: id, category: 'approved', revision: 1, message: 'verified',
    evidence: { command: 'test', exit_code: 0, output: 'pass' },
  }] });
}

describe('pairing forum', () => {
  it('binds both spawned sessions and refuses work until the pair is active', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-expect-')); roots.push(root);
    await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: [] });
    const waiting = await internals.expectForumPair(root, 'lead', 'lead', {
      driver_session: 'driver', peer_session: 'peer', wait_s: 0,
    }, spawned, noWait);
    expect(waiting.phase).toBe('waiting_for_pair');
    expect(waiting.missing).toEqual(['driver', 'peer']);
    await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
    await expect(internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }])).rejects.toThrow(/pair phase/);
    await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
    expect(internals.forumPhase(internals.roomState(root, 'lead'))).toBe('active');
    await expect(internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }])).resolves.toHaveLength(1);
  });

  it('rejects a session the host did not spawn for the role', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-expect-intruder-')); roots.push(root);
    await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: [] });
    await internals.expectForumPair(root, 'lead', 'lead', {
      driver_session: 'driver', peer_session: 'peer', wait_s: 0,
    }, spawned, noWait);
    await expect(internals.joinRoom(root, 'lead', 'intruder', { role: 'driver' })).rejects.toThrow(/expected session/);
    await expect(internals.expectForumPair(root, 'lead', 'lead', {
      driver_session: 'driver', peer_session: 'peer', wait_s: 0,
    }, { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, parentID: 'unrelated' }) }, noWait)).rejects.toThrow(/child/);
  });

  it('requires both participants active before final review', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one', 'two'] }]);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'approved', revision: 1, message: 'verified', evidence: { command: 'test', exit_code: 0, output: 'pass' } }] });
    await internals.setParticipantActivity(root, 'lead', 'lead', {
      state: 'finished', target: 'peer', participant_session: 'peer', expected_generation: 1, reason: 'peer returned',
    });
    await expect(internals.forumRequestFinish(root, 'lead', 'driver', 'done')).rejects.toThrow(/phase|active/);
  });

  it('rejects final approval when reconciliation belongs to a previous participant', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one', 'two'] }]);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'approved', revision: 1, message: 'verified', evidence: { command: 'test', exit_code: 0, output: 'pass' } }] });
    await internals.forumRequestFinish(root, 'lead', 'driver', 'done');
    await internals.reconcileFiles(root, 'lead', 'driver', { files: [] });
    await internals.reconcileFiles(root, 'lead', 'peer', { files: [] });
    const room = internals.roomState(root, 'lead');
    room.reconciliation!.submissions.peer!.sessionID = 'retired-peer';
    writeFileSync(internals.roomFilePath(root, 'lead'), JSON.stringify(room));
    await expect(internals.forumPost(root, 'lead', 'peer', { posts: [{
      topic: 'a', category: 'final_approved', message: 'suite passed',
      evidence: { command: 'bun run test', exit_code: 0, output: 'pass' },
    }] })).rejects.toThrow(/current participants/);
  });

  it('holds an interruption as a pending stall until the grace passes, then clears it on restart', async () => {
    const root = await fixture();
    const at = Date.now();
    await internals.applyParticipantLifecycle(root, 'lead', 'peer', 'unavailable', at, 'runtime interrupted (user)');
    expect(internals.forumPhase(internals.roomState(root, 'lead'))).toBe('active');
    expect(internals.forumPairStatus(internals.roomState(root, 'lead')).pendingStalls.peer?.reason).toContain('interrupted');
    expect(await internals.promoteParticipantStall(root, 'lead', 'peer', at + 1)).toBe(true);
    expect(internals.forumPhase(internals.roomState(root, 'lead'))).toBe('stalled');
    expect(internals.forumPairStatus(internals.roomState(root, 'lead')).stalls.peer?.reason).toContain('interrupted');
    expect(internals.buildRoomNotice(internals.roomState(root, 'lead'), 'driver')).toContain('PAIR_BROKEN');
    const result = await internals.waitForUpdates(root, 'lead', 'driver', { wait_s: 0 });
    expect(result.notice).toBe('PAIR_BROKEN');
    await internals.applyParticipantLifecycle(root, 'lead', 'peer', 'active', at + 2);
    expect(internals.forumPhase(internals.roomState(root, 'lead'))).toBe('active');
    expect(internals.forumPairStatus(internals.roomState(root, 'lead')).stalls).toEqual({});
  });

  it('retires a stopped peer, clears its binding, and lets a replacement rebind', async () => {
    const root = await fixture();
    const at = Date.now();
    await internals.applyParticipantLifecycle(root, 'lead', 'peer', 'unavailable', at, 'runtime interrupted');
    await internals.promoteParticipantStall(root, 'lead', 'peer', at + 1);
    const retired = await internals.forumReplaceParticipant(root, 'lead', 'lead', {
      role: 'peer', participant_session: 'peer', generation: 1, reason: 'peer stopped responding',
    });
    expect(retired.members.some(member => member.role === 'peer')).toBe(false);
    expect(retired.forum?.expected?.peer).toBeUndefined();
    expect(retired.forum?.stalls?.peer).toBeUndefined();
    const waiting = await internals.expectForumPair(root, 'lead', 'lead', {
      driver_session: 'driver', peer_session: 'new-peer', wait_s: 0,
    }, spawned, noWait);
    expect(waiting.phase).toBe('waiting_for_pair');
    await internals.joinRoom(root, 'lead', 'new-peer', { role: 'peer' });
    expect(internals.forumPhase(internals.roomState(root, 'lead'))).toBe('active');
  });

  it('does not treat host binding noise as a wake for a waiting peer', async () => {
    const root = await fixture();
    let elapsed = 0;
    let bound = false;
    const result = await internals.waitForUpdates(root, 'lead', 'peer', { wait_s: 10 }, {
      now: () => elapsed,
      sleep: async (ms: number) => {
        elapsed += ms;
        if (!bound && elapsed >= 250) {
          bound = true;
          await internals.expectForumPair(root, 'lead', 'lead', {
            driver_session: 'driver', peer_session: 'peer', wait_s: 0,
          }, spawned, noWait);
        }
      },
    });
    expect(result.timed_out).toBe(true);
    expect(result.changed).toBe(false);
  });

  it('wakes the host once after an interrupted participant stays stalled', async () => {
    const root = await fixture();
    const synthetic: { sessionID: string; text: string }[] = [];
    const events = (async function* () {
      yield { type: 'session.execution.interrupted', created: Date.now(), data: { sessionID: 'peer', reason: 'user' } };
    })();
    await pasToolkit.setup({
      location: { directory: root },
      options: { pair_stall_grace_ms: 5 },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, ...(sessionID === 'lead' ? {} : { parentID: 'lead' }) }),
        synthetic: async (input: { sessionID: string; text: string }) => { synthetic.push(input); },
      },
      event: { subscribe: () => events },
      tool: { transform: async (callback: (editor: { add(tool: unknown): void }) => void) => callback({ add: () => {} }) },
    } as never);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]?.sessionID).toBe('lead');
    expect(synthetic[0]?.text).toContain('PAIR_BROKEN');
    expect(synthetic[0]?.text).toContain('peer');
  });

  it('collapses repeated interruptions into one candidate and one room event', async () => {
    const root = await fixture();
    const at = Date.now();
    expect(await internals.applyParticipantLifecycle(root, 'lead', 'peer', 'unavailable', at, 'interrupted')).toBe(true);
    expect(await internals.applyParticipantLifecycle(root, 'lead', 'peer', 'unavailable', at + 1, 'again')).toBe(false);
    const room = internals.roomState(root, 'lead');
    expect(room.forum?.pending_stalls?.peer?.since).toBe(at);
    expect(room.messages.filter(message => message.type === 'participant_stall_candidate')).toHaveLength(1);
  });

  it('ignores execution.failed bursts and does not wake the host', async () => {
    const root = await fixture();
    const synthetic: unknown[] = [];
    const events = (async function* () {
      yield { type: 'session.execution.failed', created: Date.now(), data: { sessionID: 'peer' } };
      yield { type: 'session.execution.failed', created: Date.now() + 1, data: { sessionID: 'peer' } };
    })();
    await pasToolkit.setup({
      location: { directory: root },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, ...(sessionID === 'lead' ? {} : { parentID: 'lead' }) }),
        synthetic: async (input: unknown) => { synthetic.push(input); },
      },
      event: { subscribe: () => events },
      tool: { transform: async (callback: (editor: { add(tool: unknown): void }) => void) => callback({ add: () => {} }) },
    } as never);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(synthetic).toHaveLength(0);
    expect(internals.roomState(root, 'lead').forum?.pending_stalls).toBeUndefined();
  });

  it('sends one host wake for repeated interruptions', async () => {
    const root = await fixture();
    const synthetic: { text: string }[] = [];
    const events = (async function* () {
      yield { type: 'session.execution.interrupted', created: Date.now(), data: { sessionID: 'peer', reason: 'user' } };
      yield { type: 'session.execution.interrupted', created: Date.now() + 1, data: { sessionID: 'peer', reason: 'user' } };
    })();
    await pasToolkit.setup({
      location: { directory: root },
      options: { pair_stall_grace_ms: 5 },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, ...(sessionID === 'lead' ? {} : { parentID: 'lead' }) }),
        synthetic: async (input: { text: string }) => { synthetic.push(input); },
      },
      event: { subscribe: () => events },
      tool: { transform: async (callback: (editor: { add(tool: unknown): void }) => void) => callback({ add: () => {} }) },
    } as never);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]?.text).toContain('replace the peer');
  });

  it('finishes with files and discards a pre-finish peer reconciliation', async () => {
    const root = await fixture();
    await approveTopic(root);
    await internals.reconcileFiles(root, 'lead', 'peer', { files: ['file.txt'] });
    const room = await internals.forumRequestFinish(root, 'lead', 'driver', 'done', ['file.txt']);
    expect(room.reconciliation?.submissions.driver?.files).toEqual(['file.txt']);
    expect(room.reconciliation?.submissions.peer).toBeUndefined();
  });

  it('validates finish files against the room changeset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-finish-files-')); roots.push(root);
    writeFileSync(join(root, 'file.txt'), 'before');
    await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: ['file.txt'] });
    await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
    writeFileSync(join(root, 'file.txt'), 'after');
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'], paths: ['file.txt'] }]);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'approved', revision: 1, message: 'verified', evidence: { command: 'test', exit_code: 0, output: 'pass' } }] });
    await expect(internals.forumRequestFinish(root, 'lead', 'driver', 'done', ['other.txt'])).rejects.toThrow(/changeset/);
    await expect(internals.forumRequestFinish(root, 'lead', 'driver', 'done', ['file.txt'])).resolves.toBeDefined();
  });

  it('keeps a driver reconciliation from before finish and requires a post-finish peer list', async () => {
    const root = await fixture();
    await approveTopic(root);
    await internals.reconcileFiles(root, 'lead', 'driver', { files: [] });
    await internals.reconcileFiles(root, 'lead', 'peer', { files: [] });
    const room = await internals.forumRequestFinish(root, 'lead', 'driver', 'done');
    expect(room.reconciliation?.submissions.driver).toBeDefined();
    expect(room.reconciliation?.submissions.peer).toBeUndefined();
  });

  it('accepts identical external paths in reconciliation', async () => {
    const root = await fixture();
    await internals.reconcileFiles(root, 'lead', 'driver', { files: ['/home/user/profile/a', '/home/user/profile/b'] });
    await internals.reconcileFiles(root, 'lead', 'peer', { files: ['/home/user/profile/a', '/home/user/profile/b'] });
    expect(internals.roomState(root, 'lead').reconciliation?.reconciled).toBe(true);
  });

  it('closes after finish with files and a post-finish peer reconciliation', async () => {
    const root = await fixture();
    await approveTopic(root);
    await internals.forumRequestFinish(root, 'lead', 'driver', 'done', []);
    await internals.reconcileFiles(root, 'lead', 'peer', { files: [] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{
      topic: 'a', category: 'final_approved', message: 'suite passed',
      evidence: { command: 'bun test', exit_code: 0, output: 'pass' },
    }] });
    expect(internals.roomState(root, 'lead').status).toBe('closed');
  });

  it('rejects expect when the expected participant is already finished', async () => {
    const root = await fixture();
    await internals.setParticipantActivity(root, 'lead', 'lead', {
      state: 'finished', target: 'peer', participant_session: 'peer', expected_generation: 1, reason: 'returned',
    });
    await expect(internals.expectForumPair(root, 'lead', 'lead', {
      driver_session: 'driver', peer_session: 'peer', wait_s: 0,
    }, spawned, noWait)).rejects.toThrow(/replace|restart/);
  });

  it('returns a bounded status summary and full transcript on request', async () => {
    const root = await fixture();
    const room = internals.roomState(root, 'lead');
    const summary = internals.forumRoomSummary(room) as {
      message_count: number;
      messages: unknown[];
      forum: { posts: unknown[]; post_count: number };
    };
    expect(summary.message_count).toBe(room.messages.length);
    expect(summary.messages.length).toBeLessThanOrEqual(5);
    expect(summary.forum.post_count).toBe(room.forum!.posts.length);
    expect(summary.forum.posts.length).toBeLessThanOrEqual(5);
    const full = internals.forumRoomSummary(room, true) as { messages: unknown[]; forum: { posts: unknown[] } };
    expect(full.messages.length).toBe(room.messages.length);
    expect(full.forum.posts.length).toBe(room.forum!.posts.length);
  });

  it('reads only unread posts per session and restores full history on request', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }]);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'comment', message: 'first' }] });
    const cursor = internals.roomUpdateCursor(internals.roomState(root, 'lead'));
    expect((await internals.forumReadTopic(root, 'lead', 'peer', 'a')).posts.map(p => p.message)).toEqual(['first']);
    expect(internals.roomUpdateCursor(internals.roomState(root, 'lead'))).toBe(cursor);
    expect((await internals.forumReadTopic(root, 'lead', 'peer', 'a')).posts).toEqual([]);
    expect((await internals.forumReadTopic(root, 'lead', 'driver', 'a')).posts).toHaveLength(1);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'comment', message: 'second' }] });
    expect((await internals.forumReadTopic(root, 'lead', 'peer', 'a')).posts.map(p => p.message)).toEqual(['second']);
    expect((await internals.forumReadTopic(root, 'lead', 'peer', 'a', true)).posts.map(p => p.message)).toEqual(['first', 'second']);
  });

  it('warns about long discussion without blocking posts or counting review status', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }]);
    await internals.forumPost(root, 'lead', 'driver', { posts: Array.from({ length: 19 }, () => ({ topic: 'a', category: 'comment' as const, message: 'discussion' })) });
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    expect((await internals.forumReadTopic(root, 'lead', 'peer', 'a')).discussion.warning).toBe(false);
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'comment', message: 'one more' }] });
    const read = await internals.forumReadTopic(root, 'lead', 'peer', 'a');
    expect(read.discussion.count).toBe(20);
    expect(read.discussion.warning).toBe(true);
    await expect(internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'comment', message: 'still allowed' }] })).resolves.toHaveLength(1);
  });

  it('warns on long discussion text even with few posts', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }]);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'comment', message: 'x'.repeat(32768) }] });
    const { discussion } = await internals.forumReadTopic(root, 'lead', 'peer', 'a');
    expect(discussion).toMatchObject({ count: 1, bytes: 32768, warning: true });
  });

  it('does not lose a post arriving concurrently with a topic read', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }]);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'comment', message: 'before' }] });
    const [first] = await Promise.all([
      internals.forumReadTopic(root, 'lead', 'peer', 'a'),
      internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'comment', message: 'concurrent' }] }),
    ]);
    const second = await internals.forumReadTopic(root, 'lead', 'peer', 'a');
    expect([...first.posts, ...second.posts].map(p => p.message)).toEqual(['before', 'concurrent']);
  });
  it('registers the four forum tools and routes calls to the shared session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-tools-')); roots.push(root);
    const tools = new Map<string, { execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> }>();
    await pasToolkit.setup({
      location: { directory: root },
      session: { get: async ({ sessionID }: { sessionID: string }) => ['driver', 'peer'].includes(sessionID) ? { id: sessionID, parentID: 'lead' } : { id: sessionID } },
      tool: { transform: async (callback: (editor: { add(tool: unknown): void }) => void) => callback({ add: (tool: unknown) => { const registered = tool as { name: string; execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> }; tools.set(registered.name, registered); } }) },
    } as never);
    for (const name of ['pas_pair_room', 'pas_pair_topic', 'pas_pair_post', 'pas_pair_feed']) expect(tools.has(name)).toBe(true);
    const create = await tools.get('pas_pair_room')!.execute({ action: 'create', goal: 'pair', scope: ['one'], authorized_paths: [] }, { sessionID: 'lead' });
    expect(create.content).not.toContain('ERROR:');
    const expected = await tools.get('pas_pair_room')!.execute({ action: 'expect', driver_session: 'driver', peer_session: 'peer', wait_s: 0 }, { sessionID: 'lead' });
    expect(expected.content).toContain('waiting_for_pair');
    const joinResult = await tools.get('pas_pair_room')!.execute({ action: 'join', role: 'driver' }, { sessionID: 'driver' });
    expect(joinResult.content).toContain('driver');
    await tools.get('pas_pair_room')!.execute({ action: 'join', role: 'peer' }, { sessionID: 'peer' });
    const legacy = await tools.get('pas_room_inbox')!.execute({ wait_s: 0 }, { sessionID: 'driver' });
    expect(legacy.content).toContain('legacy rooms');
    const opened = await tools.get('pas_pair_topic')!.execute({ action: 'open', topics: [{ id: 'a', title: 'First', scenarios: ['one'] }] }, { sessionID: 'driver' });
    expect(opened.content).toContain('"id":"a"');
    await tools.get('pas_pair_room')!.execute({ action: 'join', role: 'peer' }, { sessionID: 'peer' });
    await tools.get('pas_pair_post')!.execute({ posts: [{ topic: 'a', category: 'comment', message: 'unique forum message' }] }, { sessionID: 'driver' });
    const first = await tools.get('pas_pair_feed')!.execute({ wait_seconds: 0 }, { sessionID: 'peer' });
    const payload = JSON.parse(first.content).data;
    expect(payload.posts.map((post: { message: string }) => post.message)).toEqual(['unique forum message']);
    expect(JSON.stringify(payload.state)).not.toContain('unique forum message');
    const second = await tools.get('pas_pair_feed')!.execute({ cursor: payload.cursor, wait_seconds: 0 }, { sessionID: 'peer' });
    expect(second.content).not.toContain('unique forum message');
    const unread = await tools.get('pas_pair_topic')!.execute({ action: 'read', topic: 'a' }, { sessionID: 'peer' });
    expect(unread.content).not.toContain('unique forum message');
    const history = await tools.get('pas_pair_topic')!.execute({ action: 'read', topic: 'a', all: true }, { sessionID: 'peer' });
    expect(history.content).toContain('unique forum message');
  });

  it('wakes the host on escalation, infers replace target, and guards restart generation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-recovery-tools-')); roots.push(root);
    await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: [] });
    await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }]);
    const synthetic: { text: string }[] = [];
    const tools = new Map<string, { execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> }>();
    await pasToolkit.setup({
      location: { directory: root },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ['driver', 'peer'].includes(sessionID) ? { id: sessionID, parentID: 'lead' } : { id: sessionID },
        synthetic: async (input: { text: string }) => { synthetic.push(input); },
      },
      tool: { transform: async (callback: (editor: { add(tool: unknown): void }) => void) => callback({ add: (tool: unknown) => {
        const registered = tool as { name: string; execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> };
        tools.set(registered.name, registered);
      } }) },
    } as never);
    const escalated = await tools.get('pas_pair_post')!.execute({ posts: [{ topic: 'a', category: 'escalate', message: 'need host' }] }, { sessionID: 'driver' });
    expect(escalated.content).not.toContain('ERROR:');
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]?.text).toContain('ESCALATION');
    await internals.setParticipantActivity(root, 'lead', 'lead', {
      state: 'finished', target: 'peer', participant_session: 'peer', expected_generation: 1, reason: 'returned',
    });
    const replaced = await tools.get('pas_pair_room')!.execute({ action: 'replace', participant_session: 'peer', generation: 1, reason: 'returned' }, { sessionID: 'lead' });
    const replacedPayload = JSON.parse(replaced.content).data;
    expect(replacedPayload.members.some((member: { role: string }) => member.role === 'peer')).toBe(false);
    const stale = await tools.get('pas_pair_room')!.execute({ action: 'restart', generation: 99, reason: 'stale' }, { sessionID: 'lead' });
    expect(stale.content).toContain('stale');
  });

  it('flags an incomplete return and wakes the remaining participant once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-partner-finished-')); roots.push(root);
    await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: [] });
    await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
    const synthetic: { sessionID: string; text: string }[] = [];
    const tools = new Map<string, { execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> }>();
    await pasToolkit.setup({
      location: { directory: root },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ['driver', 'peer'].includes(sessionID)
          ? { id: sessionID, parentID: 'lead', time: { idle: 10 } }
          : { id: sessionID },
        synthetic: async (input: { sessionID: string; text: string }) => { synthetic.push(input); },
      },
      tool: { transform: async (callback: (editor: { add(tool: unknown): void }) => void) => callback({ add: (tool: unknown) => {
        const registered = tool as { name: string; execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> };
        tools.set(registered.name, registered);
      } }) },
    } as never);
    const report = { action: 'report_completion', target: 'driver', participant_session: 'driver', generation: 1, reason: 'returned before close' };
    const first = await tools.get('pas_pair_room')!.execute(report, { sessionID: 'lead' });
    const payload = JSON.parse(first.content).data;
    expect(payload.incomplete_return.role).toBe('driver');
    expect(payload.incomplete_return.pending).toContain('finish');
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]?.sessionID).toBe('peer');
    expect(synthetic[0]?.text).toContain('PARTNER_FINISHED');
    await tools.get('pas_pair_room')!.execute(report, { sessionID: 'lead' });
    expect(synthetic).toHaveLength(1);
    const peer = await tools.get('pas_pair_room')!.execute({ ...report, target: 'peer', participant_session: 'peer' }, { sessionID: 'lead' });
    expect(peer.content).toContain('incomplete_return');
    expect(synthetic).toHaveLength(1);
  });

  it('opens related topics and preserves simultaneous posts', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [
      { id: 'a', title: 'First', scenarios: ['one'] }, { id: 'b', title: 'Second', scenarios: ['two'] },
    ]);
    await Promise.all([
      internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'comment', message: 'working' }] }),
      internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'b', category: 'question', message: 'what changed?' }] }),
    ]);
    const room = internals.roomState(root, 'lead');
    expect(room.forum?.topics.map(t => t.id)).toEqual(['a', 'b']);
    expect(room.forum?.posts.map(p => p.message)).toEqual(expect.arrayContaining(['working', 'what changed?']));
  });

  it('records an escalation candidate without escalating or blocking other topics', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }]);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'escalation_candidate', message: 'Should we ask the host?' }] });
    expect(internals.roomState(root, 'lead').escalation).toBeUndefined();
    await internals.forumOpenTopics(root, 'lead', 'peer', [{ id: 'b', title: 'Second', scenarios: ['two'] }]);
    expect(internals.roomState(root, 'lead').forum?.topics).toHaveLength(2);
  });

  it('requires independent approval with evidence before finishing', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one', 'two'] }]);
    await expect(internals.forumRequestFinish(root, 'lead', 'driver', 'done')).rejects.toThrow(/approved|review/);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    await expect(internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'approved', message: 'approved', evidence: { command: 'bun test', exit_code: 0, output: 'pass' } }] })).rejects.toThrow(/peer/);
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'approved', revision: 1, message: 'verified', evidence: { command: 'bun test', exit_code: 0, output: 'pass' } }] });
    await expect(internals.forumRequestFinish(root, 'lead', 'driver', 'done')).resolves.toBeDefined();
  });

  it('rejects approval if the authorized files changed after review was requested', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-revision-')); roots.push(root);
    writeFileSync(join(root, 'code.txt'), 'before');
    await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: ['code.txt'] });
    await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'], paths: ['code.txt'] }]);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    writeFileSync(join(root, 'code.txt'), 'after');
    await expect(internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'approved', revision: 1, message: 'verified', evidence: { command: 'test', exit_code: 0, output: 'pass' } }] })).rejects.toThrow(/changed|stale/);
  });

  it('reports changes against a shared initial baseline, including previously dirty files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-baseline-')); roots.push(root);
    writeFileSync(join(root, 'existing'), 'already dirty');
    await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: ['existing', 'new'] });
    await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
    expect(internals.forumChanges(root, 'lead', 'driver')).toEqual([]);
    writeFileSync(join(root, 'existing'), 'changed again');
    writeFileSync(join(root, 'new'), 'added');
    expect(internals.forumChanges(root, 'lead', 'driver')).toEqual(['existing', 'new']);
  });

  it('keeps independent topic approvals valid when another scoped file changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-topics-')); roots.push(root);
    writeFileSync(join(root, 'a'), 'a1'); writeFileSync(join(root, 'b'), 'b1');
    await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one', 'two'], authorized_paths: ['a', 'b'] });
    await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
    await internals.forumOpenTopics(root, 'lead', 'driver', [
      { id: 'a', title: 'First', scenarios: ['one'], paths: ['a'] },
      { id: 'b', title: 'Second', scenarios: ['two'], paths: ['b'] },
    ]);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'approved', revision: 1, message: 'verified', evidence: { command: 'test a', exit_code: 0, output: 'pass' } }] });
    writeFileSync(join(root, 'b'), 'b2');
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'b', category: 'ready_for_review', message: 'ready' }] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'b', category: 'approved', revision: 1, message: 'verified', evidence: { command: 'test b', exit_code: 0, output: 'pass' } }] });
    await expect(internals.forumRequestFinish(root, 'lead', 'driver', 'done')).resolves.toBeDefined();
  });

  it('does not allow empty topic paths to bypass review freshness for writable work', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-empty-paths-')); roots.push(root);
    writeFileSync(join(root, 'code'), 'initial');
    await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: ['code'] });
    await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
    await expect(internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'], paths: [] }])).rejects.toThrow(/paths/);
  });

  it('retries an atomic batch without duplicate posts and rolls back invalid batches', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }]);
    const input = { request_id: 'retry', posts: [{ topic: 'a', category: 'comment' as const, message: 'hello' }] };
    const first = await internals.forumPost(root, 'lead', 'driver', input);
    expect(await internals.forumPost(root, 'lead', 'driver', input)).toEqual(first);
    await expect(internals.forumPost(root, 'lead', 'driver', { posts: [
      { topic: 'a', category: 'comment', message: 'not saved' },
      { topic: 'missing', category: 'comment', message: 'invalid' },
    ] })).rejects.toThrow(/unknown topic/);
    expect(internals.roomState(root, 'lead').forum?.posts).toHaveLength(1);
  });

  it('requires a real final review and blocks unresolved candidates', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one', 'two'] }]);
    const [candidate] = await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'escalation_candidate', message: 'Need help?' }] });
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'approved', revision: 1, message: 'verified', evidence: { command: 'test', exit_code: 0, output: 'pass' } }] });
    await expect(internals.forumRequestFinish(root, 'lead', 'driver', 'done')).rejects.toThrow(/candidate/);
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'candidate_resolved', reply_to: candidate!.id, message: 'resolved together' }] });
    await internals.forumRequestFinish(root, 'lead', 'driver', 'done');
    await expect(internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'final_approved', message: 'no suite' }] })).rejects.toThrow(/suite/);
    await expect(internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'final_approved', message: 'suite passed', evidence: { command: 'bun run test', exit_code: 0, output: 'pass' } }] })).rejects.toThrow(/reconcil/);
    await internals.reconcileFiles(root, 'lead', 'driver', { files: [] });
    await internals.reconcileFiles(root, 'lead', 'peer', { files: [] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'final_approved', message: 'suite passed', evidence: { command: 'bun run test', exit_code: 0, output: 'pass' } }] });
    expect(internals.roomState(root, 'lead').status).toBe('closed');
    await expect(internals.openForum(root, 'lead', 'lead', { goal: 'next', scope: ['next'], authorized_paths: [] })).rejects.toThrow(/termination is unconfirmed/);
    await internals.setParticipantActivity(root, 'lead', 'lead', { state: 'finished', target: 'driver', participant_session: 'driver', expected_generation: 1, reason: 'driver returned' });
    await internals.setParticipantActivity(root, 'lead', 'lead', { state: 'finished', target: 'peer', participant_session: 'peer', expected_generation: 1, reason: 'peer returned' });
    const next = await internals.openForum(root, 'lead', 'lead', { goal: 'next', scope: ['next'], authorized_paths: [] });
    expect(next.generation).toBe(2);
    expect(next.retired_sessions).toEqual(expect.arrayContaining(['driver', 'peer']));
  });

  it('starts a new forum over an aborted room with the new goal and scope', async () => {
    const root = await fixture();
    await internals.abortRoom(root, 'lead', 'lead', { reason: 'switch feature' });
    const next = await internals.openForum(root, 'lead', 'lead', {
      goal: 'next feature', scope: ['three'], authorized_paths: [],
    });
    expect(next.status).toBe('open');
    expect(next.generation).toBe(2);
    expect(next.goal).toBe('next feature');
    expect(next.scope).toEqual(['three']);
    expect(next.retired_sessions).toEqual(expect.arrayContaining(['driver', 'peer']));
  });

  it('does not finish with an unanswered question', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one', 'two'] }]);
    const [question] = await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'question', message: 'What happens on error?' }] });
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'approved', revision: 1, message: 'verified', evidence: { command: 'test', exit_code: 0, output: 'pass' } }] });
    await expect(internals.forumRequestFinish(root, 'lead', 'driver', 'done')).rejects.toThrow(/question/);
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'answer', reply_to: question!.id, message: 'It returns an error.' }] });
    await expect(internals.forumRequestFinish(root, 'lead', 'driver', 'done')).resolves.toBeDefined();
  });

  it('wakes a waiting reader for a concurrent forum post', async () => {
    const root = await fixture();
    await internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'a', title: 'First', scenarios: ['one'] }]);
    await internals.readInbox(root, 'lead', 'peer', { wait_s: 0 });
    const cursor = internals.roomUpdateCursor(internals.roomState(root, 'lead'));
    let elapsed = 0;
    const result = await internals.waitForUpdates(root, 'lead', 'peer', { cursor, wait_s: 10 }, {
      now: () => elapsed,
      sleep: async ms => {
        elapsed += ms;
        await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'comment', message: 'new update' }] });
      },
    });
    expect(result.timed_out).toBe(false);
    expect(elapsed).toBeLessThan(10_000);
    expect(result.messages.some(message => message.body.includes('new update'))).toBe(true);
  });

  it('does not claim freshness for an authorized symlink', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-forum-symlink-')); roots.push(root);
    writeFileSync(join(root, 'actual'), 'contents');
    symlinkSync('actual', join(root, 'linked'));
    await expect(internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one'], authorized_paths: ['linked'] })).rejects.toThrow(/symlink/);
  });
});
