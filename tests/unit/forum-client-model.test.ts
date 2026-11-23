import { describe, expect, it } from 'bun:test';
import type {
  RoomDetail,
  RoomSummary,
  SessionSummary,
  TimelineEntry,
  TopicCounts,
} from '../../src/cli/forum/contract';
import {
  EMPTY_FILTERS,
  INITIAL_STATE,
  addedEntries,
  auditReconciliation,
  buildRoute,
  defaultGenerationKey,
  defaultSelectionKey,
  filterOptions,
  filterTimeline,
  findGeneration,
  findSessionByKey,
  isFilterActive,
  isNearBottom,
  nextTheme,
  parseRoute,
  reconcileSelectedKey,
  reduce,
  resolveGenerationKey,
  resolveInitialTheme,
  sameGenerationKeys,
  sameRailState,
  sessionIdOfKey,
  suiteEvidence,
  usesFallbackTitle,
} from '../../src/cli/forum/web/client/model';
import {
  formatAbsoluteTime,
  formatCategory,
  formatExitCode,
  formatPhase,
  formatProgress,
  formatRelativeTime,
  formatReviewProgress,
  formatRole,
  phaseTone,
  pluralize,
  roleTone,
  shortFingerprint,
  truncateText,
} from '../../src/cli/forum/web/client/format';
import { connectLive, nextBackoff } from '../../src/cli/forum/web/client/live';

function entry(partial: Partial<TimelineEntry> & { id: string; seq: number }): TimelineEntry {
  return {
    at: null,
    role: 'driver',
    to: '*',
    category: 'comment',
    kind: 'post',
    message: '',
    seenBy: [],
    ...partial,
  };
}

const ROOM: RoomSummary = {
  key: 'ses_a',
  id: 'ses_a',
  kind: 'live',
  generation: 3,
  goal: 'Follow the delegation',
  scopeCount: 2,
  phase: 'active',
  status: 'open',
  createdAt: '2026-11-02T09:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
  topicCounts: { open: 1, ready: 1, approved: 2, total: 4 },
  postCount: 9,
  participants: {},
  hasForum: true,
};

const DETAIL: RoomDetail = {
  room: ROOM,
  topics: [],
  timeline: [],
};

const SESSION: SessionSummary = {
  id: 'ses_a',
  title: 'Session name',
  titleSource: 'opencode',
  project: 'pulsar-agent-squad',
  updatedAt: '2026-11-02T10:00:00.000Z',
  createdAt: '2026-11-02T09:00:00.000Z',
  phase: 'active',
  generation: 3,
  generations: [
    {
      kind: 'live',
      generation: 3,
      key: 'ses_a',
      updatedAt: '2026-11-02T10:00:00.000Z',
      phase: 'active',
      topicCounts: { open: 1, ready: 1, approved: 2, total: 4 },
      postCount: 9,
    },
    {
      kind: 'archive',
      generation: 2,
      key: 'ses_a@2',
      updatedAt: '2026-11-01T10:00:00.000Z',
      phase: 'closed',
      topicCounts: { open: 0, ready: 0, approved: 1, total: 1 },
      postCount: 4,
    },
  ],
  counts: { approved: 2, total: 4, posts: 9 },
  hasForum: true,
};

const ARCHIVED_SESSION: SessionSummary = {
  id: 'ses_b',
  title: 'Older session',
  titleSource: 'goal',
  project: 'pulsar-agent-squad',
  updatedAt: '2026-11-01T10:00:00.000Z',
  createdAt: '2026-10-20T09:00:00.000Z',
  phase: 'closed',
  generation: 1,
  generations: [
    {
      kind: 'archive',
      generation: 1,
      key: 'ses_b@1',
      updatedAt: '2026-11-01T10:00:00.000Z',
      phase: 'closed',
      topicCounts: { open: 0, ready: 0, approved: 0, total: 0 },
      postCount: 0,
    },
  ],
  counts: { approved: 0, total: 0, posts: 0 },
  hasForum: false,
};

const SESSIONS = [SESSION, ARCHIVED_SESSION];

describe('client routes', () => {
  it('parses the selected room and tab from the hash', () => {
    expect(parseRoute('')).toEqual({ roomKey: null, tab: 'timeline' });
    expect(parseRoute('#/')).toEqual({ roomKey: null, tab: 'timeline' });
    expect(parseRoute('#/ses_a')).toEqual({ roomKey: 'ses_a', tab: 'timeline' });
    expect(parseRoute('#/ses_a/topics')).toEqual({ roomKey: 'ses_a', tab: 'topics' });
    expect(parseRoute('#/ses_a/closeout')).toEqual({ roomKey: 'ses_a', tab: 'closeout' });
    expect(parseRoute('#/ses_a@2/topics')).toEqual({ roomKey: 'ses_a@2', tab: 'topics' });
    expect(parseRoute('#/ses_a/sideways')).toEqual({ roomKey: 'ses_a', tab: 'timeline' });
  });

  it('builds a hash that round-trips and encodes the room key', () => {
    expect(buildRoute({ roomKey: null, tab: 'timeline' })).toBe('#/');
    expect(buildRoute({ roomKey: 'ses_a', tab: 'timeline' })).toBe('#/ses_a/timeline');
    expect(buildRoute({ roomKey: 'ses a@2', tab: 'topics' })).toBe('#/ses%20a%402/topics');
    expect(parseRoute(buildRoute({ roomKey: 'ses a@2', tab: 'topics' }))).toEqual({
      roomKey: 'ses a@2',
      tab: 'topics',
    });
  });

  it('never throws on a malformed encoded room key', () => {
    expect(parseRoute('#/%E0%A4%A/topics')).toEqual({ roomKey: null, tab: 'timeline' });
  });
});

describe('theme preference', () => {
  it('honours a stored choice before the system preference', () => {
    expect(resolveInitialTheme('light', true)).toBe('light');
    expect(resolveInitialTheme('dark', false)).toBe('dark');
  });

  it('follows the system preference when nothing valid is stored', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark');
    expect(resolveInitialTheme(null, false)).toBe('light');
    expect(resolveInitialTheme('sepia', false)).toBe('light');
  });

  it('toggles between the two themes', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });
});

describe('near-bottom and new-entry accounting', () => {
  const metrics = { scrollTop: 900, clientHeight: 100, scrollHeight: 2000 };

  it('treats the reader as near the bottom only within the threshold', () => {
    expect(isNearBottom(metrics, 120)).toBe(false);
    expect(isNearBottom({ ...metrics, scrollTop: 1800 }, 120)).toBe(true);
    expect(isNearBottom({ ...metrics, scrollTop: 1780 }, 120)).toBe(true);
    expect(isNearBottom({ ...metrics, scrollTop: 1779 }, 120)).toBe(false);
  });

  it('reports only the entries that were not present before', () => {
    const first = entry({ id: 'a', seq: 1 });
    const second = entry({ id: 'b', seq: 2 });
    const third = entry({ id: 'c', seq: 3 });

    expect(addedEntries([], [first, second])).toEqual([first, second]);
    expect(addedEntries([first], [first, second])).toEqual([second]);
    expect(addedEntries([first, second], [third])).toEqual([third]);
    expect(addedEntries([first], [first])).toEqual([]);
  });

  it('counts new traffic only while the reader is away from the bottom', () => {
    const away = reduce(INITIAL_STATE, { type: 'near-bottom', nearBottom: false });
    const firstArrival = reduce(away, { type: 'entries/arrived', count: 3 });
    expect(firstArrival.newCount).toBe(3);

    const secondArrival = reduce(firstArrival, { type: 'entries/arrived', count: 2 });
    expect(secondArrival.newCount).toBe(5);

    const backAtBottom = reduce(secondArrival, { type: 'near-bottom', nearBottom: true });
    expect(backAtBottom.newCount).toBe(0);
    expect(backAtBottom.nearBottom).toBe(true);
  });

  it('keeps the marker while filters change', () => {
    const away = reduce(INITIAL_STATE, { type: 'near-bottom', nearBottom: false });
    const arrived = reduce(away, { type: 'entries/arrived', count: 4 });
    const filtered = reduce(arrived, { type: 'filters', filters: { query: 'evidence' } });

    expect(filtered.newCount).toBe(4);
    expect(filtered.filters.query).toBe('evidence');
  });
});

describe('view state reducer', () => {
  it('loads the session list and keeps the previous list while refreshing', () => {
    const loaded = reduce(INITIAL_STATE, { type: 'sessions/loaded', sessions: [SESSION] });
    expect(loaded.sessionsStatus).toBe('ready');
    expect(loaded.sessions).toHaveLength(1);

    const refreshing = reduce(loaded, { type: 'sessions/loading' });
    expect(refreshing.sessions).toHaveLength(1);
    expect(refreshing.sessionsStatus).toBe('loading');
  });

  it('records a session list failure without dropping the last list', () => {
    const loaded = reduce(INITIAL_STATE, { type: 'sessions/loaded', sessions: [SESSION] });
    const failed = reduce(loaded, { type: 'sessions/failed', message: 'offline' });

    expect(failed.sessionsStatus).toBe('error');
    expect(failed.sessionsError).toBe('offline');
    expect(failed.sessions).toHaveLength(1);
  });

  it('selects a session, marks the detail loading and clears the marker', () => {
    const state = reduce(
      reduce(INITIAL_STATE, { type: 'sessions/loaded', sessions: [SESSION] }),
      { type: 'entries/arrived', count: 2 },
    );
    const selected = reduce(state, { type: 'room/select', key: 'ses_a' });

    expect(selected.selectedKey).toBe('ses_a');
    expect(selected.detailStatus).toBe('loading');
    expect(selected.newCount).toBe(0);
    expect(selected.detail).toBeNull();
  });

  it('accepts a detail only for the room currently selected', () => {
    const selected = reduce(INITIAL_STATE, { type: 'room/select', key: 'ses_b' });
    const stale = reduce(selected, { type: 'room/loaded', detail: DETAIL });

    expect(stale.detailStatus).toBe('loading');
    expect(stale.detail).toBeNull();

    const fresh = reduce(selected, {
      type: 'room/loaded',
      detail: { ...DETAIL, room: { ...ROOM, key: 'ses_b' } },
    });
    expect(fresh.detailStatus).toBe('ready');
    expect(fresh.selectedKey).toBe('ses_b');
  });

  it('records a room detail failure with its message', () => {
    const selected = reduce(INITIAL_STATE, { type: 'room/select', key: 'ses_a' });
    const failed = reduce(selected, { type: 'room/failed', message: 'gone' });

    expect(failed.detailStatus).toBe('error');
    expect(failed.detailError).toBe('gone');
  });

  it('changes the tab and the overlays without touching the transcript', () => {
    const state = reduce(
      reduce(INITIAL_STATE, { type: 'entries/arrived', count: 2 }),
      { type: 'tab', tab: 'topics' },
    );
    const withHelp = reduce(state, { type: 'help', open: true });
    const withRail = reduce(withHelp, { type: 'rail', open: true });

    expect(state.tab).toBe('topics');
    expect(withHelp.helpOpen).toBe(true);
    expect(withRail.railOpen).toBe(true);
    expect(withRail.newCount).toBe(0);
  });

  it('merges a partial filter change and clears all filters', () => {
    const filtered = reduce(INITIAL_STATE, {
      type: 'filters',
      filters: { role: 'peer' },
    });
    expect(filtered.filters).toEqual({ ...EMPTY_FILTERS, role: 'peer' });

    const cleared = reduce(filtered, { type: 'filters/clear' });
    expect(cleared.filters).toEqual(EMPTY_FILTERS);
  });

  it('tracks the connection state', () => {
    const live = reduce(INITIAL_STATE, { type: 'connection', connection: 'live' });
    const offline = reduce(live, { type: 'connection', connection: 'offline' });

    expect(live.connection).toBe('live');
    expect(offline.connection).toBe('offline');
  });
});

describe('session rail helpers', () => {
  it('splits a generation route key into its session id', () => {
    expect(sessionIdOfKey(null)).toBeNull();
    expect(sessionIdOfKey('ses_a')).toBe('ses_a');
    expect(sessionIdOfKey('ses_a@2')).toBe('ses_a');
    expect(sessionIdOfKey('ses_a@12')).toBe('ses_a');
  });

  it('finds a session and the generation a key names', () => {
    expect(findSessionByKey(SESSIONS, 'ses_a')?.id).toBe('ses_a');
    expect(findSessionByKey(SESSIONS, 'ses_a@2')?.id).toBe('ses_a');
    expect(findSessionByKey(SESSIONS, 'ses_b@1')?.id).toBe('ses_b');
    expect(findSessionByKey(SESSIONS, 'nope')).toBeNull();

    expect(findGeneration(SESSION, 'ses_a')?.kind).toBe('live');
    expect(findGeneration(SESSION, 'ses_a@2')?.generation).toBe(2);
    expect(findGeneration(SESSION, 'ses_a@9')).toBeNull();
  });

  it('defaults to the live generation, or the newest archive when there is none', () => {
    expect(defaultGenerationKey(SESSION)).toBe('ses_a');
    expect(defaultGenerationKey(ARCHIVED_SESSION)).toBe('ses_b@1');
    expect(defaultSelectionKey([])).toBeNull();
    expect(defaultSelectionKey(SESSIONS)).toBe('ses_a');
    expect(defaultSelectionKey([ARCHIVED_SESSION])).toBe('ses_b@1');
  });

  it('resolves a route key to an existing generation or that session default', () => {
    expect(resolveGenerationKey(SESSIONS, null)).toBeNull();
    expect(resolveGenerationKey(SESSIONS, 'ses_a')).toBe('ses_a');
    expect(resolveGenerationKey(SESSIONS, 'ses_a@2')).toBe('ses_a@2');
    expect(resolveGenerationKey(SESSIONS, 'ses_b')).toBe('ses_b@1');
    expect(resolveGenerationKey(SESSIONS, 'ses_a@9')).toBe('ses_a');
    expect(resolveGenerationKey(SESSIONS, 'nope')).toBeNull();
  });

  it('keeps selection across a refresh and falls back when a generation disappears', () => {
    const liveOnly: SessionSummary = { ...SESSION, generations: [SESSION.generations[0]!] };

    expect(reconcileSelectedKey(null, SESSIONS)).toBeNull();
    expect(reconcileSelectedKey('ses_a@2', SESSIONS)).toBe('ses_a@2');
    expect(reconcileSelectedKey('ses_a@9', SESSIONS)).toBe('ses_a');
    expect(reconcileSelectedKey('ses_a@2', [liveOnly])).toBe('ses_a');
    expect(reconcileSelectedKey('ses_a@2', [ARCHIVED_SESSION])).toBeNull();
  });

  it('accepts the server order and detects a reorder, relabel or selection change', () => {
    const state = (sessions: SessionSummary[], selectedKey: string | null = 'ses_a') => ({
      sessions,
      selectedKey,
    });

    expect(sameRailState(state(SESSIONS), state(SESSIONS))).toBe(true);
    expect(sameRailState(state(SESSIONS), state(SESSIONS, 'ses_a@2'))).toBe(false);
    expect(sameRailState(state(SESSIONS), state([...SESSIONS].reverse()))).toBe(false);
    expect(
      sameRailState(state(SESSIONS), state([{ ...SESSION, title: 'Renamed' }, ARCHIVED_SESSION])),
    ).toBe(false);
    expect(
      sameRailState(
        state(SESSIONS),
        state([{ ...SESSION, updatedAt: '2026-11-02T11:00:00.000Z' }, ARCHIVED_SESSION]),
      ),
    ).toBe(false);
    expect(
      sameRailState(
        state(SESSIONS),
        state([{ ...SESSION, generations: [SESSION.generations[0]!] }, ARCHIVED_SESSION]),
      ),
    ).toBe(false);
  });

  it('detects when the generation list itself changed', () => {
    const liveOnly: SessionSummary = { ...SESSION, generations: [SESSION.generations[0]!] };
    expect(sameGenerationKeys(SESSION, SESSION)).toBe(true);
    expect(sameGenerationKeys(SESSION, liveOnly)).toBe(false);
    expect(sameGenerationKeys(liveOnly, SESSION)).toBe(false);
    expect(sameGenerationKeys(null, null)).toBe(true);
    expect(sameGenerationKeys(SESSION, null)).toBe(false);
  });

  it('marks a goal-derived title as a fallback', () => {
    expect(usesFallbackTitle(SESSION)).toBe(false);
    expect(usesFallbackTitle(ARCHIVED_SESSION)).toBe(true);
  });
});

describe('timeline filtering', () => {
  const entries = [
    entry({
      id: 'e1',
      seq: 1,
      role: 'driver',
      category: 'ready_for_review',
      message: 'Ready for review.',
      topic: 'transcript',
    }),
    entry({
      id: 'e2',
      seq: 2,
      role: 'peer',
      category: 'approved',
      message: 'Approved.',
      topic: 'transcript',
    }),
    entry({
      id: 'e3',
      seq: 3,
      role: 'host',
      category: 'reset',
      kind: 'event',
      message: 'started generation 2',
    }),
    entry({
      id: 'e4',
      seq: 4,
      role: 'driver',
      category: 'comment',
      message: 'Evidence: BUN TEST tests/unit',
    }),
  ];

  it('filters by role, category and free text together', () => {
    expect(filterTimeline(entries, EMPTY_FILTERS)).toHaveLength(4);
    expect(filterTimeline(entries, { ...EMPTY_FILTERS, role: 'peer' }).map((item) => item.id)).toEqual([
      'e2',
    ]);
    expect(
      filterTimeline(entries, { ...EMPTY_FILTERS, category: 'approved' }).map((item) => item.id),
    ).toEqual(['e2']);
    expect(filterTimeline(entries, { ...EMPTY_FILTERS, query: 'transcript' }).map((item) => item.id)).toEqual([
      'e1',
      'e2',
    ]);
    expect(filterTimeline(entries, { ...EMPTY_FILTERS, query: 'bun test' }).map((item) => item.id)).toEqual([
      'e4',
    ]);
    expect(
      filterTimeline(entries, { ...EMPTY_FILTERS, role: 'driver', query: 'bun' }).map((item) => item.id),
    ).toEqual(['e4']);
    expect(filterTimeline(entries, { ...EMPTY_FILTERS, query: 'nothing-here' })).toEqual([]);
  });

  it('searches message, topic, category, role and id, ignoring case and outer spaces', () => {
    expect(filterTimeline(entries, { ...EMPTY_FILTERS, query: '  E2  ' }).map((item) => item.id)).toEqual([
      'e2',
    ]);
    expect(filterTimeline(entries, { ...EMPTY_FILTERS, query: 'reset' }).map((item) => item.id)).toEqual([
      'e3',
    ]);
  });

  it('knows when no filter is active', () => {
    expect(isFilterActive(EMPTY_FILTERS)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTERS, query: '   ' })).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTERS, query: 'x' })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTERS, role: 'peer' })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTERS, category: 'approved' })).toBe(true);
  });

  it('derives the available roles and categories in a stable order', () => {
    const options = filterOptions(entries);
    expect(options.roles).toEqual(['driver', 'host', 'peer']);
    expect(options.categories).toEqual(['approved', 'comment', 'ready_for_review', 'reset']);
  });
});

describe('close-out selectors', () => {
  const base: RoomDetail = { ...DETAIL, timeline: [] };

  it('prefers the final suite evidence, then the final approval, then the latest evidence', () => {
    const suite = entry({
      id: 'suite',
      seq: 5,
      category: 'suite',
      evidence: { command: 'bun run test', exitCode: 0, output: 'ok', truncated: false },
    });
    const approval = entry({
      id: 'approval',
      seq: 6,
      category: 'final_approved',
      evidence: { command: 'bun test', exitCode: 0, output: 'ok', truncated: false },
    });
    const comment = entry({
      id: 'comment',
      seq: 7,
      category: 'comment',
      evidence: { command: 'ls', exitCode: 0, output: 'x', truncated: false },
    });

    expect(suiteEvidence({ ...base, timeline: [suite, approval] })?.id).toBe('suite');
    expect(suiteEvidence({ ...base, timeline: [approval, comment] })?.id).toBe('approval');
    expect(suiteEvidence({ ...base, timeline: [comment] })?.id).toBe('comment');
    expect(suiteEvidence(base)).toBeNull();
  });

  it('audits reconciliation for files claimed by one role, none, or left out', () => {
    const detail: RoomDetail = {
      ...base,
      reconciliation: {
        submissions: {
          driver: { sessionID: 'd', files: ['a.ts', 'b.ts'], submittedAt: null },
          peer: { sessionID: 'p', files: ['a.ts'], submittedAt: null },
        },
        reconciled: true,
        files: ['a.ts', 'c.ts'],
      },
    };

    expect(auditReconciliation(detail)).toEqual({
      asymmetric: ['b.ts'],
      unclaimed: ['c.ts'],
      omitted: ['b.ts'],
      matched: false,
    });
  });

  it('reports a matched reconciliation when both roles agree with the final list', () => {
    const detail: RoomDetail = {
      ...base,
      reconciliation: {
        submissions: {
          driver: { sessionID: 'd', files: ['a.ts'], submittedAt: null },
          peer: { sessionID: 'p', files: ['a.ts'], submittedAt: null },
        },
        reconciled: true,
        files: ['a.ts'],
      },
    };

    expect(auditReconciliation(detail)).toEqual({
      asymmetric: [],
      unclaimed: [],
      omitted: [],
      matched: true,
    });
  });

  it('reports no reconciliation when the room has none', () => {
    expect(auditReconciliation(base)).toEqual({
      asymmetric: [],
      unclaimed: [],
      omitted: [],
      matched: false,
    });
  });
});

describe('formatters', () => {
  it('labels phases and their visual tone', () => {
    expect(formatPhase('waiting_for_pair')).toBe('Waiting for pair');
    expect(formatPhase('active')).toBe('Active');
    expect(formatPhase('closing')).toBe('Closing');
    expect(formatPhase('stalled')).toBe('Stalled');
    expect(formatPhase('closed')).toBe('Closed');
    expect(formatPhase('aborted')).toBe('Aborted');
    expect(formatPhase(null)).toBe('Unreadable');
    expect(phaseTone(null)).toBe('unreadable');
    expect(phaseTone('active')).toBe('active');
  });

  it('labels roles with a role tone', () => {
    expect(formatRole('driver')).toBe('Driver');
    expect(formatRole('peer')).toBe('Peer');
    expect(formatRole('host')).toBe('Host');
    expect(formatRole('mystery')).toBe('Mystery');
    expect(roleTone('driver')).toBe('driver');
    expect(roleTone('peer')).toBe('peer');
    expect(roleTone('host')).toBe('host');
    expect(roleTone('mystery')).toBe('system');
  });

  it('turns persisted categories into readable labels', () => {
    expect(formatCategory('ready_for_review')).toBe('Ready for review');
    expect(formatCategory('final_approved')).toBe('Final approved');
    expect(formatCategory('comment')).toBe('Comment');
    expect(formatCategory('')).toBe('Message');
  });

  it('describes relative time across the useful ranges', () => {
    const now = Date.parse('2026-11-02T12:00:00.000Z');
    expect(formatRelativeTime('2026-11-02T11:59:30.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-11-02T11:58:30.000Z', now)).toBe('1m ago');
    expect(formatRelativeTime('2026-11-02T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatRelativeTime('2026-10-31T12:00:00.000Z', now)).toBe('2d ago');
    expect(formatRelativeTime('2026-10-20T12:00:00.000Z', now)).toBe('2026-10-20');
    expect(formatRelativeTime('2026-11-02T12:00:30.000Z', now)).toBe('just now');
    expect(formatRelativeTime(null, now)).toBe('unknown');
    expect(formatRelativeTime('not-a-date', now)).toBe('unknown');
  });

  it('formats an absolute timestamp in UTC', () => {
    expect(formatAbsoluteTime('2026-11-02T09:05:00.000Z')).toBe('2026-11-02 09:05 UTC');
    expect(formatAbsoluteTime(null)).toBe('unknown');
  });

  it('shortens a fingerprint and keeps short ones intact', () => {
    expect(shortFingerprint('0123456789abcdef')).toBe('0123456789ab…');
    expect(shortFingerprint('abc')).toBe('abc');
    expect(shortFingerprint(null)).toBe('—');
  });

  it('formats exit codes, counts and clipped text', () => {
    expect(formatExitCode(0)).toBe('exit 0');
    expect(formatExitCode(1)).toBe('exit 1');
    expect(formatExitCode(null)).toBe('no exit code');
    expect(pluralize(1, 'entry')).toBe('1 entry');
    expect(pluralize(3, 'entry')).toBe('3 entries');
    expect(pluralize(0, 'file')).toBe('0 files');
    expect(pluralize(2, 'match', 'matches')).toBe('2 matches');
    expect(truncateText('abcdefghij', 5)).toBe('abcde…');
    expect(truncateText('abc', 5)).toBe('abc');
  });

  it('formats review progress from topic counts', () => {
    const counts: TopicCounts = { open: 1, ready: 1, approved: 2, total: 4 };
    expect(formatReviewProgress(counts)).toBe('2/4 approved');
    expect(formatReviewProgress({ open: 0, ready: 0, approved: 0, total: 0 })).toBe('no topics');
  });

  it('formats review progress from a session count pair', () => {
    expect(formatProgress(2, 4)).toBe('2/4 approved');
    expect(formatProgress(0, 0)).toBe('no topics');
  });
});

describe('live connection', () => {
  interface FakeSource {
    listeners: Map<string, Array<(event: { data?: string }) => void>>;
    closed: boolean;
    addEventListener(type: string, listener: (event: { data?: string }) => void): void;
    close(): void;
    emit(type: string, event?: { data?: string }): void;
  }

  function fakeSource(): FakeSource {
    return {
      listeners: new Map(),
      closed: false,
      addEventListener(type, listener) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      },
      close() {
        this.closed = true;
      },
      emit(type, event = {}) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      },
    };
  }

  interface ScheduledTask {
    delay: number;
    run: () => void;
    cancelled: boolean;
  }

  it('grows the reconnect delay exponentially and then caps it', () => {
    expect(nextBackoff(0, 800, 15_000)).toBe(800);
    expect(nextBackoff(1, 800, 15_000)).toBe(1_600);
    expect(nextBackoff(4, 800, 15_000)).toBe(12_800);
    expect(nextBackoff(10, 800, 15_000)).toBe(15_000);
    expect(nextBackoff(-1, 800, 15_000)).toBe(800);
  });

  it('reconnects with bounded backoff, resets on open and stops on dispose', () => {
    const sources: FakeSource[] = [];
    const tasks: ScheduledTask[] = [];
    const opened: number[] = [];
    const errors: number[] = [];
    const rooms: string[] = [];

    const connection = connectLive({
      url: '/api/events',
      createSource: () => {
        const source = fakeSource();
        sources.push(source);
        return source;
      },
      scheduler: {
        schedule(delay, run) {
          const task: ScheduledTask = { delay, run, cancelled: false };
          tasks.push(task);
          return () => {
            task.cancelled = true;
          };
        },
      },
      onOpen: () => opened.push(Date.now()),
      onError: () => errors.push(Date.now()),
      onRoomChange: (change) => rooms.push(change.key),
    });

    expect(sources).toHaveLength(1);
    sources[0]!.emit('open');
    expect(opened).toHaveLength(1);

    sources[0]!.emit('error');
    expect(errors).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.delay).toBe(800);
    expect(sources).toHaveLength(1);

    tasks[0]!.run();
    expect(sources).toHaveLength(2);
    sources[1]!.emit('error');
    expect(tasks[1]!.delay).toBe(1_600);

    tasks[1]!.run();
    sources[2]!.emit('open');
    sources[2]!.emit('error');
    expect(tasks[2]!.delay).toBe(800);

    sources[2]!.emit('room', { data: '{"key":"ses_a","id":"ses_a","kind":"live","change":"changed"}' });
    sources[2]!.emit('room', { data: 'not json' });
    expect(rooms).toEqual(['ses_a']);

    connection.dispose();
    expect(sources[2]!.closed).toBe(true);
    expect(tasks[2]!.cancelled).toBe(true);
    expect(sources).toHaveLength(3);
  });
});
