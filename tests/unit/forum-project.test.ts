import { describe, expect, it } from 'bun:test';
import { projectRoomDetail, projectRoomList } from '../../src/cli/forum/project';
import type { RoomStoreEntry } from '../../src/cli/forum/store';

const UPDATED_AT = '2026-11-02T10:00:00.000Z';

function entry(id: string, document: unknown, overrides: Partial<RoomStoreEntry> = {}): RoomStoreEntry {
  return { key: id, id, kind: 'live', generation: 1, updatedAt: UPDATED_AT, document, ...overrides };
}

function forumRoom(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ses_active',
    status: 'open',
    generation: 3,
    goal: 'Ship the read-only forum viewer',
    scope: ['Room discovery', 'Command lifecycle'],
    authorized_paths: [],
    created_at: '2026-11-02T09:00:00.000Z',
    members: [
      { sessionID: 'session-host', role: 'host' },
      { sessionID: 'session-driver', role: 'driver' },
      { sessionID: 'session-peer', role: 'peer' },
    ],
    messages: [],
    forum: {
      topics: [
        { id: 'lifecycle', title: 'Lifecycle', scenarios: ['Starting'], status: 'approved' },
        { id: 'discovery', title: 'Discovery', scenarios: ['Listing'], status: 'ready' },
        { id: 'legacy', title: 'Legacy', scenarios: ['Legacy'], status: 'open' },
      ],
      posts: [
        {
          id: 'post-1',
          seq: 4,
          topic: 'discovery',
          category: 'ready_for_review',
          message: 'Room discovery is ready for review with fixtures pinned.',
          role: 'driver',
          revision: 2,
        },
      ],
      expected: { driver: 'session-driver', peer: 'session-peer' },
      final_requested: false,
    },
    activities: {
      driver: { sessionID: 'session-driver', availability: 'active', state: 'working' },
      peer: {
        sessionID: 'session-peer',
        availability: 'active',
        state: 'waiting_for_response',
        waiting_for: 'review',
      },
    },
    ...overrides,
  };
}

describe('room list projection', () => {
  it('derives active, closing, stalled, closed and aborted phases from persisted fields', () => {
    const closing = forumRoom({
      forum: {
        ...(forumRoom().forum as Record<string, unknown>),
        final_requested: true,
      },
    });
    const stalledByAvailability = forumRoom({
      activities: {
        driver: { sessionID: 'session-driver', availability: 'active', state: 'working' },
        peer: { sessionID: 'session-peer', availability: 'unavailable', state: 'unavailable' },
      },
    });
    const stalledByStall = forumRoom({
      forum: {
        ...(forumRoom().forum as Record<string, unknown>),
        stalls: { driver: { role: 'driver', at: 1 } },
      },
    });
    const waitingForPair = forumRoom({
      members: [{ sessionID: 'session-host', role: 'host' }],
    });
    const waitingForPresence = forumRoom({ activities: {} });
    const closed = forumRoom({ status: 'closed' });
    const aborted = forumRoom({ status: 'aborted' });

    const rooms = projectRoomList([
      entry('active', forumRoom()),
      entry('closing', closing),
      entry('stalled-availability', stalledByAvailability),
      entry('stalled-stall', stalledByStall),
      entry('waiting-members', waitingForPair),
      entry('waiting-presence', waitingForPresence),
      entry('closed', closed),
      entry('aborted', aborted),
    ]);

    expect(rooms.map((room) => [room.key, room.phase])).toEqual([
      ['active', 'active'],
      ['closing', 'closing'],
      ['stalled-availability', 'stalled'],
      ['stalled-stall', 'stalled'],
      ['waiting-members', 'waiting_for_pair'],
      ['waiting-presence', 'waiting_for_pair'],
      ['closed', 'closed'],
      ['aborted', 'aborted'],
    ]);
  });

  it('reports generation, participants, topic counts and the last post', () => {
    const [room] = projectRoomList([entry('ses_active', forumRoom())]);

    expect(room).toBeDefined();
    expect(room!.generation).toBe(3);
    expect(room!.goal).toBe('Ship the read-only forum viewer');
    expect(room!.scopeCount).toBe(2);
    expect(room!.status).toBe('open');
    expect(room!.createdAt).toBe('2026-11-02T09:00:00.000Z');
    expect(room!.updatedAt).toBe(UPDATED_AT);
    expect(room!.hasForum).toBe(true);
    expect(room!.unreadable).toBeUndefined();
    expect(room!.participants.driver?.sessionID).toBe('session-driver');
    expect(room!.participants.driver?.availability).toBe('active');
    expect(room!.participants.peer?.state).toBe('waiting_for_response');
    expect(room!.participants.peer?.waitingFor).toBe('review');
    expect(room!.participants.host?.sessionID).toBe('session-host');
    expect(room!.topicCounts).toEqual({ open: 1, ready: 1, approved: 1, total: 3 });
    expect(room!.postCount).toBe(1);
    expect(room!.lastPost).toEqual({
      seq: 4,
      category: 'ready_for_review',
      role: 'driver',
      preview: 'Room discovery is ready for review with fixtures pinned.',
      at: null,
    });
  });

  it('labels a room without a structural forum as legacy and keeps its message count', () => {
    const legacy = {
      id: 'ses_legacy',
      status: 'open',
      generation: 2,
      goal: 'Legacy pairing',
      scope: ['One'],
      members: [
        { sessionID: 'session-host', role: 'host' },
        { sessionID: 'session-driver', role: 'driver' },
        { sessionID: 'session-peer', role: 'peer' },
      ],
      messages: [{ id: 'm1', seq: 0 }, { id: 'm2', seq: 1 }],
      activities: {
        driver: { sessionID: 'session-driver', availability: 'active', state: 'working' },
        peer: { sessionID: 'session-peer', availability: 'active', state: 'working' },
      },
    };

    const [room] = projectRoomList([entry('ses_legacy', legacy)]);

    expect(room!.hasForum).toBe(false);
    expect(room!.postCount).toBe(2);
    expect(room!.topicCounts).toEqual({ open: 0, ready: 0, approved: 0, total: 0 });
    expect(room!.participants.driver?.sessionID).toBe('session-driver');
  });

  it('treats a forum object without topic and post arrays as legacy', () => {
    const malformedForum = forumRoom({ forum: { topics: [] } });
    const [room] = projectRoomList([entry('ses_partial', malformedForum)]);

    expect(room!.hasForum).toBe(false);
  });

  it('degrades unreadable rooms and keeps valid rooms listed with their own data', () => {
    const rooms = projectRoomList([
      entry('ses_broken', undefined, { unreadable: 'Unexpected token in JSON at position 0' }),
      entry('ses_legacy', { id: 'ses_legacy', status: 'open', generation: 1 }),
      entry('ses_active', forumRoom()),
    ]);

    expect(rooms[0]!.unreadable).toContain('Unexpected token');
    expect(rooms[0]!.hasForum).toBe(false);
    expect(rooms[0]!.phase).toBeNull();
    expect(rooms[0]!.postCount).toBe(0);
    expect(rooms[1]!.hasForum).toBe(false);
    expect(rooms[2]!.hasForum).toBe(true);
    expect(rooms[2]!.id).toBe('ses_active');
    expect(rooms[2]!.topicCounts.total).toBe(3);
  });

  it('does not derive presence from forum.expected; the join gate owns that check', () => {
    // The protocol uses forum.expected only when the host binds sessions in
    // `pas_pair_room expect`; the phase needs members *and* activities.
    const [room] = projectRoomList([entry('ses_expected', forumRoom({ activities: {} }))]);

    expect(room!.phase).toBe('waiting_for_pair');
    expect(room!.participants.driver?.availability).toBeUndefined();
  });

  it('counts only the persisted topic statuses open, ready and approved', () => {
    const [room] = projectRoomList([
      entry(
        'ses_topic_statuses',
        forumRoom({
          forum: {
            ...(forumRoom().forum as Record<string, unknown>),
            topics: [
              { id: 'a', status: 'open' },
              { id: 'b', status: 'ready' },
              { id: 'c', status: 'approved' },
              { id: 'd', status: 'ready_for_review' },
            ],
          },
        }),
      ),
    ]);

    expect(room!.topicCounts).toEqual({ open: 2, ready: 1, approved: 1, total: 4 });
  });
});

function detailDocument(): Record<string, unknown> {
  const base = forumRoom();
  const forum = base.forum as Record<string, unknown>;

  return {
    ...base,
    status: 'closed',
    messages: [
      {
        id: 'p-review',
        seq: 2,
        role: 'driver',
        type: 'ready_for_review',
        body: 'Ready',
        created_at: '2026-11-02T10:02:00.000Z',
        read_by: ['driver'],
      },
      {
        id: 'p-escalate',
        seq: 3,
        role: 'driver',
        type: 'escalate',
        body: 'Need a decision',
        created_at: '2026-11-02T10:03:00.000Z',
        read_by: [],
      },
      {
        id: 'p-resolved',
        seq: 4,
        role: 'peer',
        type: 'escalation_resolved',
        body: 'Resolved',
        created_at: '2026-11-02T10:04:00.000Z',
        read_by: [],
      },
      {
        id: 'p-final',
        seq: 6,
        role: 'peer',
        type: 'final_approved',
        body: 'Final',
        created_at: '2026-11-02T10:06:00.000Z',
        read_by: [],
      },
    ],
    forum: {
      ...forum,
      topics: [
        {
          id: 'discovery',
          title: 'Discovery',
          scenarios: ['Listing'],
          paths: ['src/a.ts'],
          status: 'ready',
          revision: 2,
        },
        { id: 'other', title: 'Other', scenarios: [], status: 'approved', revision: 1 },
      ],
      posts: [
        {
          id: 'p-review',
          seq: 2,
          topic: 'discovery',
          category: 'ready_for_review',
          message: 'Ready',
          role: 'driver',
          revision: 2,
        },
        {
          id: 'p-escalate',
          seq: 3,
          topic: 'discovery',
          category: 'escalate',
          message: 'Need a decision',
          role: 'driver',
          revision: 2,
        },
        {
          id: 'p-resolved',
          seq: 4,
          topic: 'discovery',
          category: 'escalation_resolved',
          message: 'Resolved',
          role: 'peer',
          revision: 2,
          reply_to: 'p-escalate',
        },
        {
          id: 'p-final',
          seq: 6,
          topic: 'discovery',
          category: 'final_approved',
          message: 'Final',
          role: 'peer',
          revision: 2,
        },
      ],
      final_requested: true,
      final_fingerprint: 'abc123',
    },
    reconciliation: {
      submissions: {
        driver: {
          sessionID: 'session-driver',
          files: ['src/a.ts'],
          submitted_at: '2026-11-02T10:10:00.000Z',
        },
      },
      reconciled: false,
      files: ['src/a.ts'],
    },
  };
}

describe('room detail projection', () => {
  it('projects topics with their last post, declared paths and pending review step', () => {
    const detail = projectRoomDetail(entry('ses_detail', detailDocument()));

    expect(detail.room.status).toBe('closed');
    expect(detail.topics).toHaveLength(2);
    expect(detail.topics[0]).toMatchObject({
      id: 'discovery',
      title: 'Discovery',
      scenarios: ['Listing'],
      paths: ['src/a.ts'],
      status: 'ready',
      revision: 2,
      blockers: ['peer approval pending'],
      lastPost: {
        seq: 6,
        category: 'final_approved',
        role: 'peer',
        preview: 'Final',
        at: '2026-11-02T10:06:00.000Z',
      },
    });
    expect(detail.topics[1]!.blockers).toEqual([]);
  });

  it('projects reconciliation, final review, escalation and stop state', () => {
    const detail = projectRoomDetail(entry('ses_detail', detailDocument()));

    expect(detail.reconciliation).toEqual({
      submissions: {
        driver: {
          sessionID: 'session-driver',
          files: ['src/a.ts'],
          submittedAt: '2026-11-02T10:10:00.000Z',
        },
      },
      reconciled: false,
      files: ['src/a.ts'],
    });
    expect(detail.finalReview).toEqual({
      requested: true,
      fingerprint: 'abc123',
      approvedAt: '2026-11-02T10:06:00.000Z',
      approvedRole: 'peer',
    });
    expect(detail.escalation).toEqual({
      id: 'p-escalate',
      seq: 3,
      category: 'escalate',
      role: 'driver',
      message: 'Need a decision',
      at: '2026-11-02T10:03:00.000Z',
      resolved: true,
    });
    expect(detail.stop).toBeUndefined();
  });

  it('reports an abort reason and pending stalls when the room stopped', () => {
    const aborted = detailDocument();
    aborted.status = 'aborted';
    aborted.abort_reason = 'Host cancelled the delegation';
    aborted.aborted_at = '2026-11-02T10:20:00.000Z';
    (aborted.forum as Record<string, unknown>).pending_stalls = {
      peer: { sessionID: 'session-peer', since: 1793600000000, reason: 'runtime failed' },
    };

    const detail = projectRoomDetail(entry('ses_aborted', aborted));

    expect(detail.room.phase).toBe('aborted');
    expect(detail.stop).toEqual({
      aborted: true,
      reason: 'Host cancelled the delegation',
      at: '2026-11-02T10:20:00.000Z',
      pendingStalls: {
        peer: { sessionID: 'session-peer', since: 1793600000000, reason: 'runtime failed' },
      },
    });
  });

  it('degrades a legacy room to a plain message timeline with a notice', () => {
    const legacy = {
      id: 'ses_legacy',
      status: 'open',
      generation: 1,
      messages: [
        {
          id: 'm1',
          seq: 0,
          role: 'host',
          type: 'reset',
          body: 'started',
          created_at: '2026-11-02T09:00:00.000Z',
          read_by: [],
        },
      ],
    };

    const detail = projectRoomDetail(entry('ses_legacy', legacy));

    expect(detail.room.hasForum).toBe(false);
    expect(detail.topics).toEqual([]);
    expect(detail.timeline).toHaveLength(1);
    expect(detail.timeline[0]!.kind).toBe('event');
    expect(detail.legacyNotice).toContain('legacy');
    expect(detail.finalReview).toBeUndefined();
  });

  it('keeps an unreadable entry renderable with no topics or timeline', () => {
    const detail = projectRoomDetail(
      entry('ses_broken', undefined, { unreadable: 'Unexpected token in JSON' }),
    );

    expect(detail.room.phase).toBeNull();
    expect(detail.topics).toEqual([]);
    expect(detail.timeline).toEqual([]);
    expect(detail.legacyNotice).toBeUndefined();
  });
});
