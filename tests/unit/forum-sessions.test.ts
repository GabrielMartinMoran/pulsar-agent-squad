import { describe, expect, it } from 'bun:test';
import type { RoomSummary } from '../../src/cli/forum/contract';
import { buildSessions } from '../../src/cli/forum/sessions';

const SESSION_ID = 'ses_rail';

function room(overrides: Partial<RoomSummary> = {}): RoomSummary {
  const id = overrides.id ?? SESSION_ID;
  return {
    key: id,
    id,
    kind: 'live',
    generation: 1,
    goal: 'Ship the session rail',
    scopeCount: 0,
    phase: 'active',
    status: 'open',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    topicCounts: { open: 0, ready: 0, approved: 0, total: 0 },
    postCount: 0,
    participants: {},
    hasForum: true,
    ...overrides,
  };
}

function archive(generation: number, overrides: Partial<RoomSummary> = {}): RoomSummary {
  return room({
    kind: 'archive',
    key: `${SESSION_ID}@${generation}`,
    generation,
    ...overrides,
  });
}

const EMPTY_TITLES = new Map<string, string>();

describe('session aggregation', () => {
  it('groups one session per room id and nests live plus archived generations', () => {
    const summaries = [
      archive(1, {
        updatedAt: '2026-10-30T08:00:00.000Z',
        createdAt: '2026-10-30T07:00:00.000Z',
        phase: 'closed',
      }),
      room({
        generation: 3,
        phase: 'active',
        updatedAt: '2026-11-02T12:00:00.000Z',
        createdAt: '2026-11-02T09:00:00.000Z',
        topicCounts: { open: 1, ready: 1, approved: 2, total: 4 },
        postCount: 7,
        participants: {
          driver: { sessionID: 'session-driver', role: 'driver' },
          peer: { sessionID: 'session-peer', role: 'peer' },
        },
      }),
      archive(2, { updatedAt: '2026-11-01T08:00:00.000Z', phase: 'closed' }),
    ];

    const sessions = buildSessions(summaries, {
      project: 'pulsar-agent-squad',
      titles: EMPTY_TITLES,
    });

    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;

    expect(session.id).toBe(SESSION_ID);
    expect(session.project).toBe('pulsar-agent-squad');
    expect(session.generations.map((entry) => entry.kind)).toEqual(['live', 'archive', 'archive']);
    expect(session.generations.map((entry) => entry.generation)).toEqual([3, 2, 1]);
    expect(session.generations.map((entry) => entry.key)).toEqual([
      SESSION_ID,
      `${SESSION_ID}@2`,
      `${SESSION_ID}@1`,
    ]);
    // The first generation is the default one the room view opens.
    expect(session.generations[0]!.kind).toBe('live');
    expect(session.generation).toBe(3);

    // Session freshness spans every room file of the session.
    expect(session.updatedAt).toBe('2026-11-02T12:00:00.000Z');
    expect(session.createdAt).toBe('2026-10-30T07:00:00.000Z');

    // Phase, counts and participants come from the default generation only.
    expect(session.phase).toBe('active');
    expect(session.counts).toEqual({ approved: 2, total: 4, posts: 7 });
    expect(session.participants).toEqual({
      driver: { sessionID: 'session-driver', role: 'driver' },
      peer: { sessionID: 'session-peer', role: 'peer' },
    });
    expect(session.hasForum).toBe(true);

    expect(session.generations[1]).toEqual({
      kind: 'archive',
      generation: 2,
      key: `${SESSION_ID}@2`,
      updatedAt: '2026-11-01T08:00:00.000Z',
      phase: 'closed',
      topicCounts: { open: 0, ready: 0, approved: 0, total: 0 },
      postCount: 0,
    });
  });
});

describe('session ordering', () => {
  it('sorts by last update descending and breaks ties by label then id, without locale collation', () => {
    const summaries = [
      room({
        id: 'ses_b',
        key: 'ses_b',
        goal: 'Beta',
        updatedAt: '2026-11-02T10:00:00.000Z',
      }),
      room({
        id: 'ses_a',
        key: 'ses_a',
        goal: 'alpha',
        updatedAt: '2026-11-02T10:00:00.000Z',
      }),
      room({
        id: 'ses_c',
        key: 'ses_c',
        goal: 'alpha',
        updatedAt: '2026-11-02T10:00:00.000Z',
      }),
      room({
        id: 'ses_new',
        key: 'ses_new',
        goal: 'Newest',
        updatedAt: '2026-11-03T10:00:00.000Z',
      }),
    ];

    const sessions = buildSessions(summaries, { project: 'pulsar', titles: EMPTY_TITLES });

    // `B` (U+0042) sorts before `a` (U+0061) by code unit; locale collation
    // would invert that, so this also pins the deterministic comparator.
    expect(sessions.map((session) => session.id)).toEqual([
      'ses_new',
      'ses_b',
      'ses_a',
      'ses_c',
    ]);
  });

  it('uses the session-level maximum update time, not the newest file only', () => {
    const sessions = buildSessions(
      [
        room({ id: 'ses_old', key: 'ses_old', updatedAt: '2026-11-01T10:00:00.000Z' }),
        room({ id: 'ses_other', key: 'ses_other', updatedAt: '2026-11-01T11:00:00.000Z' }),
        archive(4, {
          id: 'ses_old',
          key: 'ses_old@4',
          updatedAt: '2026-11-02T10:00:00.000Z',
        }),
      ],
      { project: 'pulsar', titles: EMPTY_TITLES },
    );

    expect(sessions.map((session) => session.id)).toEqual(['ses_old', 'ses_other']);
    expect(sessions[0]!.updatedAt).toBe('2026-11-02T10:00:00.000Z');
  });
});

describe('session labels', () => {
  it('uses the OpenCode title when known and falls back to the goal first line, marked as such', () => {
    const titles = new Map([['ses_known', 'Panel en tiempo real para foros de agentes']]);
    const sessions = buildSessions(
      [
        room({
          id: 'ses_known',
          key: 'ses_known',
          goal: 'A five hundred character objective that is not a name',
        }),
        room({
          id: 'ses_fallback',
          key: 'ses_fallback',
          goal: 'Aggregate the room store\nwith generations nested inside',
        }),
      ],
      { project: 'pulsar', titles },
    );

    const known = sessions.find((session) => session.id === 'ses_known')!;
    expect(known.title).toBe('Panel en tiempo real para foros de agentes');
    expect(known.titleSource).toBe('opencode');

    const fallback = sessions.find((session) => session.id === 'ses_fallback')!;
    expect(fallback.title).toBe('Aggregate the room store');
    expect(fallback.titleSource).toBe('goal');
    expect(fallback.id).toBe('ses_fallback');
  });

  it('treats a blank OpenCode title as unavailable instead of showing an empty label', () => {
    const sessions = buildSessions(
      [
        room({ id: 'ses_blank', key: 'ses_blank', goal: 'Goal from the room document' }),
        room({ id: 'ses_space', key: 'ses_space', goal: 'Another goal' }),
      ],
      {
        project: 'pulsar',
        titles: new Map([
          ['ses_blank', ''],
          ['ses_space', '   '],
        ]),
      },
    );

    for (const session of sessions) {
      expect(session.titleSource).toBe('goal');
      expect(session.title.trim().length).toBeGreaterThan(0);
    }
    expect(sessions.find((session) => session.id === 'ses_blank')!.title).toBe(
      'Goal from the room document',
    );
  });

  it('keeps a stable fallback label and the goal source when a session has no goal at all', () => {
    const sessions = buildSessions([room({ id: 'ses_goalless', key: 'ses_goalless', goal: '' })], {
      project: 'pulsar',
      titles: EMPTY_TITLES,
    });

    const session = sessions[0]!;
    expect(session.id).toBe('ses_goalless');
    expect(session.title).toBe('Untitled session');
    expect(session.titleSource).toBe('goal');
  });

  it('takes the fallback goal from the default generation, not an archive', () => {
    const sessions = buildSessions(
      [
        archive(1, {
          id: 'ses_mixed',
          key: 'ses_mixed@1',
          goal: 'Old archived goal',
          updatedAt: '2026-11-01T10:00:00.000Z',
        }),
        room({ id: 'ses_mixed', key: 'ses_mixed', goal: 'Current live goal\nsecond line' }),
      ],
      { project: 'pulsar', titles: EMPTY_TITLES },
    );

    expect(sessions[0]!.title).toBe('Current live goal');
    expect(sessions[0]!.titleSource).toBe('goal');
  });
});
