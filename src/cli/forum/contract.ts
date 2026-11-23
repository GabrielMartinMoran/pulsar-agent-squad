/**
 * Shared shapes for the read-only forum viewer API.
 *
 * The server serializes these types as JSON and the browser client is written
 * against them, so a field removed here is a breaking change for the viewer.
 * Everything is derived from the room documents under `.pas/rooms/`; nothing
 * in this contract grants a write path.
 */

export type RoomKind = 'live' | 'archive';

/** Derived room lifecycle, mirrored from the pairing forum protocol. */
export type RoomPhase =
  | 'waiting_for_pair'
  | 'active'
  | 'closing'
  | 'stalled'
  | 'closed'
  | 'aborted';

export type ParticipantRole = 'host' | 'driver' | 'peer';

/** The two roles that a pair can lack; `host` is never part of the phase. */
export type PairRole = 'driver' | 'peer';

export interface TopicCounts {
  open: number;
  ready: number;
  approved: number;
  total: number;
}

export interface ParticipantSummary {
  sessionID: string;
  role: string;
  availability?: string;
  state?: string;
  waitingFor?: string;
  unit?: string;
}

export interface LastPostSummary {
  seq: number;
  category: string;
  role: string;
  preview: string;
  at: string | null;
}

export interface RoomSummary {
  /** Stable selector across live and archived entries. */
  key: string;
  id: string;
  kind: RoomKind;
  generation: number;
  goal: string;
  scopeCount: number;
  /**
   * Derived lifecycle phase. `null` means the document could not be read, so
   * a consumer must not label it with any live phase; `unreadable` carries the
   * reason. Never guess a phase from a malformed file.
   */
  phase: RoomPhase | null;
  status: string;
  createdAt: string | null;
  /** File modification time: the viewer's freshness signal, not room data. */
  updatedAt: string;
  topicCounts: TopicCounts;
  postCount: number;
  participants: Partial<Record<ParticipantRole, ParticipantSummary>>;
  hasForum: boolean;
  unreadable?: string;
  lastPost?: LastPostSummary;
}

/** Persisted topic statuses are exactly `open`, `ready` and `approved`. */
export interface TopicSummary {
  id: string;
  title: string;
  scenarios: string[];
  /** Review paths declared when the topic was opened. */
  paths: string[];
  /** Persisted `open | ready | approved`; unknown values are passed through. */
  status: string;
  revision: number;
  lastPost?: LastPostSummary;
  /**
   * Human-readable pending review steps derived from the persisted status.
   * Approved topics have none; this is a display aid, never a protocol rule.
   */
  blockers: string[];
}

export type TimelineEntryKind = 'post' | 'event';

export interface EvidenceSummary {
  command: string;
  exitCode: number | null;
  /** Bounded to 8192 UTF-8 bytes; the cut never splits a character. */
  output: string;
  truncated: boolean;
}

export interface TimelineEntry {
  id: string;
  seq: number;
  /** Mirrored message timestamp; null for a post missing from the mirror. */
  at: string | null;
  role: string;
  /** Message recipient from the mirror (`*`, a role, or a session id). */
  to: string | null;
  category: string;
  /**
   * `post` for traffic typed through the forum (mirrored into `messages`),
   * `event` for system traffic such as a reset or a stall notice.
   */
  kind: TimelineEntryKind;
  message: string;
  topic?: string;
  revision?: number;
  replyTo?: string;
  evidence?: EvidenceSummary;
  /** Roles that have read the message (`read_by`). */
  seenBy: string[];
}

export interface ReconciliationSubmission {
  sessionID: string | null;
  files: string[];
  submittedAt: string | null;
}

export interface ReconciliationSummary {
  submissions: Partial<Record<PairRole, ReconciliationSubmission>>;
  reconciled: boolean;
  files: string[];
}

export interface FinalReviewSummary {
  requested: boolean;
  fingerprint: string | null;
  approvedAt: string | null;
  approvedRole: string | null;
}

export interface EscalationSummary {
  id: string;
  seq: number;
  category: string;
  role: string;
  message: string;
  at: string | null;
  /** True when a later post replies to this escalation with a resolution. */
  resolved: boolean;
}

export interface PendingStallSummary {
  sessionID: string | null;
  since: number | null;
  reason: string | null;
}

export interface StopSummary {
  aborted: boolean;
  reason: string | null;
  at: string | null;
  pendingStalls: Partial<Record<PairRole, PendingStallSummary>>;
}

export interface RoomDetail {
  room: RoomSummary;
  topics: TopicSummary[];
  timeline: TimelineEntry[];
  reconciliation?: ReconciliationSummary;
  finalReview?: FinalReviewSummary;
  escalation?: EscalationSummary;
  stop?: StopSummary;
  /** Set when the room predates the pairing forum and has no topic board. */
  legacyNotice?: string;
}

export interface RoomListResponse {
  rooms: RoomSummary[];
}

/**
 * One room file as seen from its session. The route key stays generation
 * specific (`<id>` or `<id>@<generation>`), so detail fetches and SSE matching
 * are unchanged.
 */
export interface SessionGeneration {
  kind: RoomKind;
  generation: number;
  key: string;
  /** File modification time, the same freshness signal as `RoomSummary`. */
  updatedAt: string;
  phase: RoomPhase | null;
  topicCounts: TopicCounts;
  postCount: number;
}

/** Where the effective label came from; `goal` means it is a fallback. */
export type SessionTitleSource = 'opencode' | 'goal';

/** One rail entry. Generations belong to the session instead of listing beside it. */
export interface SessionSummary {
  /** The room id shared by the live document and every archived generation. */
  id: string;
  title: string;
  titleSource: SessionTitleSource;
  /** Basename of the served workspace. */
  project: string;
  /** Max of the entries' `updatedAt`; the list is sorted by it. */
  updatedAt: string;
  /** Min of the entries' non-null `createdAt`, or null when none reports one. */
  createdAt: string | null;
  /** Taken from the default generation, never mixed across generations. */
  phase: RoomPhase | null;
  /** Generation number of the default entry. */
  generation?: number;
  /** Live first when present, then archives by generation descending. */
  generations: SessionGeneration[];
  /** Counts of the default generation, never sums across generations. */
  counts: {
    approved: number;
    total: number;
    posts: number;
  };
  participants?: Partial<Record<ParticipantRole, ParticipantSummary>>;
  hasForum: boolean;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export type ChangeKind = 'added' | 'changed' | 'removed';

/** One room file changed on disk; the SSE `room` event carries this payload. */
export interface RoomChange {
  key: string;
  id: string;
  kind: RoomKind;
  /** Archive generation; absent for the live room file. */
  generation?: number;
  change: ChangeKind;
}

/** Named events the viewer stream can emit. */
export type StreamEventName = 'hello' | 'room' | 'heartbeat';

/** Payload of the `hello` and `heartbeat` events. */
export interface StreamTick {
  now: string;
}
