import type {
  RoomDetail,
  SessionGeneration,
  SessionSummary,
  TimelineEntry,
} from '../../contract';

export type TabId = 'timeline' | 'topics' | 'closeout';

export const TABS: readonly TabId[] = ['timeline', 'topics', 'closeout'];

export type Theme = 'dark' | 'light';

export type ConnectionState = 'live' | 'reconnecting' | 'offline';

/**
 * Filter state for the transcript. `all` is the neutral value for the two
 * selects; the query is trimmed before it is compared, so whitespace alone
 * never activates a filter.
 */
export interface TimelineFilters {
  role: string;
  category: string;
  query: string;
}

export interface FilterOptions {
  roles: string[];
  categories: string[];
}

export interface Route {
  roomKey: string | null;
  tab: TabId;
}

export interface TimelineScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** The distance to the end of the list that still counts as "at the bottom". */
export const NEAR_BOTTOM_THRESHOLD_PX = 120;

export const EMPTY_FILTERS: TimelineFilters = { role: 'all', category: 'all', query: '' };

export interface ViewState {
  sessions: SessionSummary[];
  sessionsStatus: 'loading' | 'ready' | 'error';
  sessionsError: string | null;
  /** Generation-specific route key: `<id>` for live, `<id>@<generation>` for an archive. */
  selectedKey: string | null;
  detail: RoomDetail | null;
  detailStatus: 'idle' | 'loading' | 'ready' | 'error';
  detailError: string | null;
  tab: TabId;
  filters: TimelineFilters;
  connection: ConnectionState;
  /** Entries that arrived while the reader was away from the bottom. */
  newCount: number;
  nearBottom: boolean;
  helpOpen: boolean;
  railOpen: boolean;
}

export const INITIAL_STATE: ViewState = {
  sessions: [],
  sessionsStatus: 'loading',
  sessionsError: null,
  selectedKey: null,
  detail: null,
  detailStatus: 'idle',
  detailError: null,
  tab: 'timeline',
  filters: { ...EMPTY_FILTERS },
  connection: 'reconnecting',
  newCount: 0,
  nearBottom: true,
  helpOpen: false,
  railOpen: false,
};

export type Action =
  | { type: 'sessions/loading' }
  | { type: 'sessions/loaded'; sessions: SessionSummary[] }
  | { type: 'sessions/failed'; message: string }
  | { type: 'room/select'; key: string }
  | { type: 'room/clear' }
  | { type: 'room/loaded'; detail: RoomDetail }
  | { type: 'room/failed'; message: string }
  | { type: 'tab'; tab: TabId }
  | { type: 'filters'; filters: Partial<TimelineFilters> }
  | { type: 'filters/clear' }
  | { type: 'connection'; connection: ConnectionState }
  | { type: 'entries/arrived'; count: number }
  | { type: 'near-bottom'; nearBottom: boolean }
  | { type: 'help'; open: boolean }
  | { type: 'rail'; open: boolean };

export function reduce(state: ViewState, action: Action): ViewState {
  switch (action.type) {
    case 'sessions/loading':
      return { ...state, sessionsStatus: 'loading', sessionsError: null };
    case 'sessions/loaded':
      return { ...state, sessions: action.sessions, sessionsStatus: 'ready', sessionsError: null };
    case 'sessions/failed':
      return { ...state, sessionsStatus: 'error', sessionsError: action.message };
    case 'room/select':
      if (state.selectedKey === action.key) return state;
      return {
        ...state,
        selectedKey: action.key,
        detail: null,
        detailStatus: 'loading',
        detailError: null,
        newCount: 0,
        nearBottom: true,
        filters: { ...EMPTY_FILTERS },
      };
    case 'room/clear':
      return {
        ...state,
        selectedKey: null,
        detail: null,
        detailStatus: 'idle',
        detailError: null,
        newCount: 0,
      };
    case 'room/loaded':
      if (state.selectedKey !== action.detail.room.key) return state;
      return {
        ...state,
        detail: action.detail,
        detailStatus: 'ready',
        detailError: null,
      };
    case 'room/failed':
      return { ...state, detailStatus: 'error', detailError: action.message };
    case 'tab':
      return { ...state, tab: action.tab };
    case 'filters':
      return { ...state, filters: { ...state.filters, ...action.filters } };
    case 'filters/clear':
      return { ...state, filters: { ...EMPTY_FILTERS } };
    case 'connection':
      return { ...state, connection: action.connection };
    case 'entries/arrived':
      if (action.count <= 0 || state.nearBottom) return state;
      return { ...state, newCount: state.newCount + action.count };
    case 'near-bottom':
      if (state.nearBottom === action.nearBottom) return state;
      return {
        ...state,
        nearBottom: action.nearBottom,
        newCount: action.nearBottom ? 0 : state.newCount,
      };
    case 'help':
      return { ...state, helpOpen: action.open };
    case 'rail':
      return { ...state, railOpen: action.open };
    default:
      return state;
  }
}

/* ---- Session rail ------------------------------------------------------- */

/**
 * A route key stays generation-specific (`<id>` or `<id>@<generation>`); the
 * session id is what groups the row and its generations. Room ids cannot
 * contain `@`, so the last `@` is an unambiguous separator.
 */
export function sessionIdOfKey(key: string | null): string | null {
  if (!key) return null;
  const at = key.lastIndexOf('@');
  return at > 0 ? key.slice(0, at) : key;
}

export function findSessionById(
  sessions: readonly SessionSummary[],
  id: string | null,
): SessionSummary | null {
  if (!id) return null;
  return sessions.find((session) => session.id === id) ?? null;
}

/** The session a generation key belongs to, whether the key is live or archived. */
export function findSessionByKey(
  sessions: readonly SessionSummary[],
  key: string | null,
): SessionSummary | null {
  return findSessionById(sessions, sessionIdOfKey(key));
}

export function findGeneration(
  session: SessionSummary,
  key: string | null,
): SessionGeneration | null {
  if (!key) return null;
  return session.generations.find((generation) => generation.key === key) ?? null;
}

/** The live document, or the newest archive when the session has no live file. */
export function defaultGenerationKey(session: SessionSummary): string | null {
  const live = session.generations.find((generation) => generation.kind === 'live');
  return (live ?? session.generations[0])?.key ?? null;
}

/** The first session's default generation; the initial view for an unlinked visit. */
export function defaultSelectionKey(sessions: readonly SessionSummary[]): string | null {
  const first = sessions[0];
  return first ? defaultGenerationKey(first) : null;
}

/**
 * Keeps a requested key when it still names a generation, falls back to the
 * session default when that generation disappeared, and returns null only when
 * the whole session is gone. Deep links therefore stay exact while the list
 * refreshes underneath them.
 */
export function resolveGenerationKey(
  sessions: readonly SessionSummary[],
  key: string | null,
): string | null {
  const session = findSessionByKey(sessions, key);
  if (!session) return null;
  return findGeneration(session, key) ? key : defaultGenerationKey(session);
}

export function reconcileSelectedKey(
  previousKey: string | null,
  sessions: readonly SessionSummary[],
): string | null {
  return resolveGenerationKey(sessions, previousKey);
}

/** True when a refresh added, removed or replaced a generation of this session. */
export function sameGenerationKeys(
  previous: SessionSummary | null,
  next: SessionSummary | null,
): boolean {
  if (!previous || !next) return previous === next;
  if (previous.generations.length !== next.generations.length) return false;
  return previous.generations.every(
    (generation, index) => generation.key === next.generations[index]!.key,
  );
}

function sameGenerationList(
  previous: readonly SessionGeneration[],
  next: readonly SessionGeneration[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((generation, index) => {
    const other = next[index]!;
    return (
      generation.key === other.key &&
      generation.kind === other.kind &&
      generation.generation === other.generation &&
      generation.updatedAt === other.updatedAt &&
      generation.phase === other.phase
    );
  });
}

export interface RailState {
  sessions: readonly SessionSummary[];
  selectedKey: string | null;
}

/**
 * True when a refresh would render the same rail: same server order, same
 * labels, states, counts and generation keys, and the same selection. The
 * client never re-sorts; comparing in order makes an honest reorder visible.
 */
export function sameRailState(previous: RailState, next: RailState): boolean {
  if (previous.selectedKey !== next.selectedKey) return false;
  if (previous.sessions.length !== next.sessions.length) return false;

  return previous.sessions.every((session, index) => {
    const other = next.sessions[index]!;
    return (
      session.id === other.id &&
      session.title === other.title &&
      session.titleSource === other.titleSource &&
      session.phase === other.phase &&
      session.updatedAt === other.updatedAt &&
      session.counts.approved === other.counts.approved &&
      session.counts.total === other.counts.total &&
      session.counts.posts === other.counts.posts &&
      session.hasForum === other.hasForum &&
      sameGenerationList(session.generations, other.generations)
    );
  });
}

/** The rail must never present a goal as if it were a session name. */
export function usesFallbackTitle(session: SessionSummary): boolean {
  return session.titleSource === 'goal';
}

export function isNearBottom(
  metrics: TimelineScrollMetrics,
  threshold: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  const remaining = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return remaining <= threshold;
}

/** Entries present now that were not present in the previous transcript. */
export function addedEntries(
  previous: readonly TimelineEntry[],
  next: readonly TimelineEntry[],
): TimelineEntry[] {
  const known = new Set(previous.map((entry) => entry.id));
  return next.filter((entry) => !known.has(entry.id));
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function entryMatches(entry: TimelineEntry, filters: TimelineFilters): boolean {
  if (filters.role !== 'all' && entry.role !== filters.role) return false;
  if (filters.category !== 'all' && entry.category !== filters.category) return false;

  const query = normalize(filters.query);
  if (query.length === 0) return true;

  const haystack = [
    entry.id,
    entry.message,
    entry.topic ?? '',
    entry.category,
    entry.role,
    entry.evidence?.command ?? '',
  ]
    .join('\n')
    .toLocaleLowerCase();

  return haystack.includes(query);
}

export function filterTimeline(
  entries: readonly TimelineEntry[],
  filters: TimelineFilters,
): TimelineEntry[] {
  return entries.filter((entry) => entryMatches(entry, filters));
}

export function isFilterActive(filters: TimelineFilters): boolean {
  return (
    filters.role !== 'all' ||
    filters.category !== 'all' ||
    filters.query.trim().length > 0
  );
}

export function filterOptions(entries: readonly TimelineEntry[]): FilterOptions {
  return {
    roles: [...new Set(entries.map((entry) => entry.role))].sort(),
    categories: [...new Set(entries.map((entry) => entry.category))].sort(),
  };
}

/**
 * The final suite evidence is the last `suite` post, falling back to the final
 * approval and then to the newest post that carries evidence at all. The
 * close-out panel never invents evidence that the room does not hold.
 */
export function suiteEvidence(detail: RoomDetail): TimelineEntry | null {
  const withEvidence = detail.timeline.filter((entry) => entry.evidence !== undefined);
  const latest = (predicate: (entry: TimelineEntry) => boolean): TimelineEntry | undefined =>
    withEvidence.reduce<TimelineEntry | undefined>(
      (current, entry) =>
        predicate(entry) && (!current || entry.seq >= current.seq) ? entry : current,
      undefined,
    );

  return (
    latest((entry) => entry.category === 'suite') ??
    latest((entry) => entry.category === 'final_approved') ??
    latest(() => true) ??
    null
  );
}

export interface ReconciliationAudit {
  /** Files claimed by exactly one of the two roles. */
  asymmetric: string[];
  /** Files in the reconciled list that neither role submitted. */
  unclaimed: string[];
  /** Submitted files missing from the reconciled list. */
  omitted: string[];
  matched: boolean;
}

function sorted(values: Set<string>): string[] {
  return [...values].sort();
}

export function auditReconciliation(detail: RoomDetail): ReconciliationAudit {
  const reconciliation = detail.reconciliation;
  if (!reconciliation) {
    return { asymmetric: [], unclaimed: [], omitted: [], matched: false };
  }

  const driver = new Set(reconciliation.submissions.driver?.files ?? []);
  const peer = new Set(reconciliation.submissions.peer?.files ?? []);
  const reconciled = new Set(reconciliation.files);

  const union = new Set([...driver, ...peer]);
  const asymmetric = sorted(
    new Set([...union].filter((file) => !(driver.has(file) && peer.has(file)))),
  );
  const unclaimed = sorted(new Set([...reconciled].filter((file) => !union.has(file))));
  const omitted = sorted(new Set([...union].filter((file) => !reconciled.has(file))));

  return {
    asymmetric,
    unclaimed,
    omitted,
    matched:
      reconciliation.reconciled &&
      asymmetric.length === 0 &&
      unclaimed.length === 0 &&
      omitted.length === 0,
  };
}

const DEFAULT_ROUTE: Route = { roomKey: null, tab: 'timeline' };

function decodeRoomKey(segment: string): string | null {
  if (segment.length === 0) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const segments = raw.replace(/^\//, '').split('/');
  const segment = segments[0] ?? '';
  const roomKey = decodeRoomKey(segment);
  // A non-empty segment that cannot be decoded is not a room; the whole hash
  // is ignored rather than guessing a tab for an unknown room.
  if (segment.length > 0 && roomKey === null) return { ...DEFAULT_ROUTE };

  const candidate = segments[1] as TabId | undefined;
  const tab = candidate && TABS.includes(candidate) ? candidate : 'timeline';
  return { roomKey, tab };
}

export function buildRoute(route: Route): string {
  if (!route.roomKey) return '#/';
  return `#/${encodeURIComponent(route.roomKey)}/${route.tab}`;
}

export function resolveInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
