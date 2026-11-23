import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin, { internals } from '../../src/tools/pas-toolkit';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const evidence = { command: 'test', exit_code: 0, output: 'passed' };

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pas-recovery-')); roots.push(root);
  for (const file of ['a', 'b']) writeFileSync(join(root, file), 'initial');
  await internals.openForum(root, 'lead', 'lead', { goal: 'pair', scope: ['one', 'two'], authorized_paths: ['a', 'b'] });
  await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
  await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
  await internals.forumOpenTopics(root, 'lead', 'driver', [
    { id: 'a', title: 'First', scenarios: ['one'], paths: ['a'] },
    { id: 'b', title: 'Second', scenarios: ['two'], paths: ['b'] },
  ]);
  return root;
}

async function approve(root: string, topic: string, revision = 1) {
  await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic, category: 'ready_for_review', message: 'formatted and tested' }] });
  await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic, category: 'approved', revision, message: 'verified', evidence }] });
}

async function tools(root: string) {
  type Tool = { name: string; execute(input: unknown, context: { sessionID: string }): Promise<{ content: string }> };
  const registered = new Map<string, Tool>();
  await plugin.setup({
    location: { directory: root },
    session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, ...(sessionID === 'lead' ? {} : { parentID: 'lead' }) }) },
    tool: { transform: (callback: (editor: { add(tool: Tool): void }) => void) => callback({ add: tool => registered.set(tool.name, tool) }) },
  } as never);
  return async (name: string, input: unknown, sessionID = 'driver') => JSON.parse((await registered.get(name)!.execute(input, { sessionID })).content);
}

describe('forum recovery', () => {
  it('repairs a final finding and closes without host intervention or unrelated reapproval', async () => {
    const root = await fixture();
    await approve(root, 'a'); await approve(root, 'b');
    await internals.forumRequestFinish(root, 'lead', 'driver', 'ready', []);
    await internals.reconcileFiles(root, 'lead', 'peer', { files: [] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'changes_requested', revision: 1, message: 'formatter failed', evidence: { ...evidence, exit_code: 1 } }] });
    let room = internals.roomState(root, 'lead');
    expect(internals.forumPhase(room)).toBe('active');
    expect(room.reconciliation).toBeUndefined();
    expect(room.forum?.final_fingerprint).toBeUndefined();
    expect(room.forum?.topics.find(t => t.id === 'b')?.status).toBe('approved');
    writeFileSync(join(root, 'a'), 'formatted');
    await approve(root, 'a', 2);
    await internals.forumRequestFinish(root, 'lead', 'driver', 'fixed', ['a']);
    await internals.reconcileFiles(root, 'lead', 'peer', { files: ['a'] });
    await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'final_approved', message: 'fresh final suite passed', evidence }] });
    room = internals.roomState(root, 'lead');
    expect(room.status).toBe('closed');
    expect(room.forum?.posts.some(p => p.role === 'host' || p.category === 'escalate')).toBe(false);
  });

  it('returns every finish blocker with exact changed paths in status, feed and errors', async () => {
    const root = await fixture(); await approve(root, 'a');
    writeFileSync(join(root, 'a'), 'changed');
    const [question] = await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'b', category: 'question', message: 'clarify' }] });
    const call = await tools(root);
    const status = await call('pas_pair_room', { action: 'status' });
    expect(status.ok).toBe(true); expect(status.workspace).toBe(root);
    const blockers = status.data.review.finish_blockers;
    expect(blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'REVIEW_STALE', topic: 'a', changed_paths: ['a'], actor: 'driver', next_action: 'ready_for_review' }),
      expect.objectContaining({ code: 'TOPIC_NOT_APPROVED', topic: 'b' }),
      expect.objectContaining({ code: 'UNANSWERED_QUESTION', reply_to: question!.id }),
    ]));
    const finish = await call('pas_pair_room', { action: 'finish', summary: 'done', files: ['a'] });
    expect(finish.ok).toBe(false); expect(finish.blockers).toEqual(blockers);
    const feed = await call('pas_pair_feed', { wait_seconds: 0 });
    expect(feed.data.state.review.finish_blockers).toEqual(blockers);
  });

  it('requires review paths for new writable topics, without changing authorization', async () => {
    const root = await fixture();
    await expect(internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'c', title: 'Third', scenarios: ['one'] }])).rejects.toThrow(/paths/);
    await expect(internals.forumOpenTopics(root, 'lead', 'driver', [{ id: 'c', title: 'Third', scenarios: ['one'], paths: ['../outside'] }])).rejects.toThrow(/paths/);
  });

  it('derives resolution category from the referenced post while preserving host authority', async () => {
    const root = await fixture(); const call = await tools(root);
    const [candidate] = await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'escalation_candidate', message: 'discuss' }] });
    const resolved = await call('pas_pair_post', { posts: [{ topic: 'a', category: 'resolve', reply_to: candidate!.id, message: 'settled' }] }, 'peer');
    expect(resolved.ok).toBe(true); expect(resolved.data[0].category).toBe('candidate_resolved');
    const [escalation] = await internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'escalate', message: 'authority needed' }] });
    const denied = await call('pas_pair_post', { posts: [{ topic: 'a', category: 'resolve', reply_to: escalation!.id, message: 'settled' }] }, 'driver');
    expect(denied.ok).toBe(false);
    const allowed = await call('pas_pair_post', { posts: [{ topic: 'a', category: 'resolve', reply_to: escalation!.id, message: 'authorized' }] }, 'lead');
    expect(allowed.ok).toBe(true); expect(allowed.data[0].category).toBe('escalation_resolved');
  });

  it('rejects a stale final finding without reopening the room', async () => {
    const root = await fixture(); await approve(root, 'a'); await approve(root, 'b');
    await internals.forumRequestFinish(root, 'lead', 'driver', 'done', []);
    await expect(internals.forumPost(root, 'lead', 'peer', { posts: [{ topic: 'a', category: 'changes_requested', revision: 0, message: 'old finding' }] })).rejects.toThrow(/stale/);
    expect(internals.forumPhase(internals.roomState(root, 'lead'))).toBe('closing');
  });

  it('keeps old whole-room topic approvals readable and freshness-protected', async () => {
    const root = await fixture();
    const room = internals.roomState(root, 'lead');
    delete room.forum!.topics[0]!.paths;
    writeFileSync(internals.roomFilePath(root, 'lead'), JSON.stringify(room));
    await approve(root, 'a'); await approve(root, 'b');
    const approved = internals.roomState(root, 'lead');
    delete approved.forum!.topics[0]!.snapshot;
    writeFileSync(internals.roomFilePath(root, 'lead'), JSON.stringify(approved));
    writeFileSync(join(root, 'b'), 'changed');
    const call = await tools(root);
    const status = await call('pas_pair_room', { action: 'status' });
    expect(status.data.review.finish_blockers.filter((b: { code: string }) => b.code === 'REVIEW_STALE').map((b: { topic: string }) => b.topic)).toEqual(['a', 'b']);
    const finish = await call('pas_pair_room', { action: 'finish', summary: 'done' });
    expect(finish.ok).toBe(false);
  });

  it('does not accept earlier suite evidence after a final tree changes', async () => {
    const root = await fixture(); await approve(root, 'a'); await approve(root, 'b');
    await internals.forumRequestFinish(root, 'lead', 'driver', 'done', []);
    await internals.reconcileFiles(root, 'lead', 'peer', { files: [] });
    writeFileSync(join(root, 'a'), 'late edit');
    const call = await tools(root);
    const final = await call('pas_pair_post', { posts: [{ topic: 'a', category: 'final_approved', message: 'old suite', evidence }] }, 'peer');
    expect(final.ok).toBe(false);
    expect(final.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FINAL_REVIEW_STALE' })]));
    const finding = await call('pas_pair_post', { posts: [{ topic: 'a', category: 'changes_requested', revision: 1, message: 'tree changed during audit' }] }, 'peer');
    expect(finding.ok).toBe(true);
    expect(internals.forumPhase(internals.roomState(root, 'lead'))).toBe('active');
  });

  it('does not let the driver reopen final review by impersonating the peer', async () => {
    const root = await fixture(); await approve(root, 'a'); await approve(root, 'b');
    await internals.forumRequestFinish(root, 'lead', 'driver', 'done', []);
    const call = await tools(root);
    const finding = await call('pas_pair_post', { posts: [{ topic: 'a', category: 'changes_requested', revision: 1, message: 'reopen' }] });
    expect(finding.ok).toBe(false);
    expect(internals.forumPhase(internals.roomState(root, 'lead'))).toBe('closing');
  });

  it('recommends only legal recovery actions when readiness or the final tree is stale', async () => {
    const root = await fixture();
    await internals.forumPost(root, 'lead', 'driver', { posts: [{ topic: 'a', category: 'ready_for_review', message: 'ready' }] });
    writeFileSync(join(root, 'a'), 'late edit');
    const call = await tools(root);
    let status = await call('pas_pair_room', { action: 'status' });
    expect(status.data.review.next_actions.filter((a: { topic: string }) => a.topic === 'a')).toEqual([
      expect.objectContaining({ actor: 'driver', next_action: 'ready_for_review' }),
    ]);
    await approve(root, 'a', 2); await approve(root, 'b');
    await internals.forumRequestFinish(root, 'lead', 'driver', 'done', ['a']);
    writeFileSync(join(root, 'b'), 'late final edit');
    status = await call('pas_pair_room', { action: 'status' });
    expect(status.data.review.next_actions).toEqual([
      expect.objectContaining({ actor: 'peer', next_action: 'changes_requested', topic: 'b' }),
    ]);
  });
});
