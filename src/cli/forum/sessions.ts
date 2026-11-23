import type {
  ParticipantRole,
  ParticipantSummary,
  RoomSummary,
  SessionGeneration,
  SessionSummary,
  SessionTitleSource,
} from './contract';

export interface BuildSessionsOptions {
  /** Basename of the served workspace; named once per launch, not per row. */
  project: string;
  /** OpenCode-derived titles by room id; a missing or blank title falls back. */
  titles?: ReadonlyMap<string, string>;
}

const FALLBACK_TITLE = 'Untitled session';

function firstLine(goal: string): string {
  const line = goal.split('\n', 1)[0]?.trim() ?? '';
  return line.length > 0 ? line : FALLBACK_TITLE;
}

interface SessionLabel {
  title: string;
  titleSource: SessionTitleSource;
}

/**
 * The OpenCode title is a name; the goal's first line is a fallback and says so.
 * An empty goal still yields a non-empty placeholder, so a label never lies by
 * omission and the id keeps the session identifiable.
 */
function labelOf(
  id: string,
  primary: RoomSummary,
  titles: ReadonlyMap<string, string> | undefined,
): SessionLabel {
  const known = titles?.get(id)?.trim();
  if (known) return { title: known, titleSource: 'opencode' };
  return { title: firstLine(primary.goal), titleSource: 'goal' };
}

function generationOf(room: RoomSummary): SessionGeneration {
  return {
    kind: room.kind,
    generation: room.generation,
    key: room.key,
    updatedAt: room.updatedAt,
    phase: room.phase,
    topicCounts: { ...room.topicCounts },
    postCount: room.postCount,
  };
}

/** Live first, then archived generations newest first. */
function compareGenerations(left: RoomSummary, right: RoomSummary): number {
  if (left.kind !== right.kind) return left.kind === 'live' ? -1 : 1;
  if (left.generation !== right.generation) return right.generation - left.generation;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

/** The generation whose phase, counts and participants describe the session. */
function primaryOf(ordered: RoomSummary[]): RoomSummary {
  const live = ordered.find((entry) => entry.kind === 'live');
  return live ?? ordered[0]!;
}

function latestUpdatedAt(entries: RoomSummary[]): string {
  return entries.reduce(
    (latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest),
    entries[0]!.updatedAt,
  );
}

function earliestCreatedAt(entries: RoomSummary[]): string | null {
  let earliest: string | null = null;
  for (const entry of entries) {
    if (entry.createdAt === null) continue;
    if (earliest === null || entry.createdAt < earliest) earliest = entry.createdAt;
  }
  return earliest;
}

function participantsOf(
  room: RoomSummary,
): Partial<Record<ParticipantRole, ParticipantSummary>> | undefined {
  const roles = Object.keys(room.participants) as ParticipantRole[];
  if (roles.length === 0) return undefined;

  const participants: Partial<Record<ParticipantRole, ParticipantSummary>> = {};
  for (const role of roles) participants[role] = { ...room.participants[role]! };
  return participants;
}

function sessionOf(
  id: string,
  entries: RoomSummary[],
  options: BuildSessionsOptions,
): SessionSummary {
  const ordered = [...entries].sort(compareGenerations);
  const primary = primaryOf(ordered);
  const participants = participantsOf(primary);
  const label = labelOf(id, primary, options.titles);

  const session: SessionSummary = {
    id,
    title: label.title,
    titleSource: label.titleSource,
    project: options.project,
    updatedAt: latestUpdatedAt(ordered),
    createdAt: earliestCreatedAt(ordered),
    phase: primary.phase,
    generation: primary.generation,
    generations: ordered.map(generationOf),
    counts: {
      approved: primary.topicCounts.approved,
      total: primary.topicCounts.total,
      posts: primary.postCount,
    },
    hasForum: primary.hasForum,
  };

  if (participants) session.participants = participants;
  return session;
}

/**
 * Last update descending, then the effective label by plain code unit (`<`),
 * then the id. Deliberately not `localeCompare`: its result depends on the
 * host locale and would make the rail order non-deterministic.
 */
function compareSessions(left: SessionSummary, right: SessionSummary): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
  if (left.title !== right.title) return left.title < right.title ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Groups room-file summaries into one entry per session id. A pure projection:
 * callers pass the already-projected room list, and nothing here touches the
 * store or a clock.
 */
export function buildSessions(
  summaries: readonly RoomSummary[],
  options: BuildSessionsOptions,
): SessionSummary[] {
  const groups = new Map<string, RoomSummary[]>();
  for (const summary of summaries) {
    const group = groups.get(summary.id);
    if (group) group.push(summary);
    else groups.set(summary.id, [summary]);
  }

  const sessions: SessionSummary[] = [];
  for (const [id, entries] of groups) {
    sessions.push(sessionOf(id, entries, options));
  }
  return sessions.sort(compareSessions);
}
