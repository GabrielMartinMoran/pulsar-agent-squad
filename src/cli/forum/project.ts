import type {
  EscalationSummary,
  EvidenceSummary,
  FinalReviewSummary,
  LastPostSummary,
  PairRole,
  ParticipantRole,
  ParticipantSummary,
  PendingStallSummary,
  ReconciliationSubmission,
  ReconciliationSummary,
  RoomDetail,
  RoomPhase,
  RoomSummary,
  StopSummary,
  TimelineEntry,
  TopicCounts,
  TopicSummary,
} from './contract';
import type { RoomStoreEntry } from './store';

type JsonObject = Record<string, unknown>;

/** Review output is cut here so a large room never bloats the API payload. */
const EVIDENCE_OUTPUT_LIMIT_BYTES = 8 * 1024;

const TOPIC_READINESS_BLOCKER = 'driver readiness pending';
const TOPIC_APPROVAL_BLOCKER = 'peer approval pending';
const LEGACY_NOTICE =
  'This room uses the legacy pairing protocol; it is shown as a plain message list.';

const ESCALATION_CATEGORIES = new Set(['escalate', 'escalation_candidate']);
const ESCALATION_RESOLUTION_CATEGORIES = new Set(['escalation_resolved', 'candidate_resolved']);

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

/** Forum detection is structural, never filename-based. */
function forumOf(document: JsonObject): JsonObject | null {
  const forum = document.forum;
  if (!isObject(forum)) return null;
  if (!Array.isArray(forum.topics) || !Array.isArray(forum.posts)) return null;
  return forum;
}

/**
 * Pinned phase derivation, mirrored from the pairing forum protocol.
 *
 * The canonical rules live in the toolkit plugin, which the CLI must not
 * import. A forum is usable only while both named participants are present and
 * active: membership alone is not presence.
 *
 * `forum.expected` is deliberately not read here. The host records expected
 * session ids when it binds the pair, and the toolkit enforces them at join
 * time; the persisted phase is derived from `members` plus `activities`. A
 * test pins that an expected pair without activity stays `waiting_for_pair`.
 */
function derivePhase(document: JsonObject, forum: JsonObject | null): RoomPhase {
  const status = asString(document.status);
  if (status === 'aborted') return 'aborted';
  if (status === 'closed') return 'closed';
  if (!forum) return 'waiting_for_pair';
  if (forum.final_requested === true) return 'closing';

  const members = asArray(document.members).filter(isObject);
  const hasDriver = members.some((member) => member.role === 'driver');
  const hasPeer = members.some((member) => member.role === 'peer');
  if (!hasDriver || !hasPeer) return 'waiting_for_pair';

  const stalls = objectOrEmpty(forum.stalls);
  if (isObject(stalls.driver) || isObject(stalls.peer)) return 'stalled';

  const activities = objectOrEmpty(document.activities);
  const driver = activities.driver;
  const peer = activities.peer;
  if (!isObject(driver) || !isObject(peer)) return 'waiting_for_pair';
  if (driver.availability !== 'active' || peer.availability !== 'active') return 'stalled';

  return 'active';
}

function topicCountsFor(forum: JsonObject | null): TopicCounts {
  if (!forum) return { open: 0, ready: 0, approved: 0, total: 0 };

  const topics = asArray(forum.topics).filter(isObject);
  let open = 0;
  let ready = 0;
  let approved = 0;

  // The store only ever persists these three statuses; anything else is an
  // unknown state and is reported as still open rather than guessed.
  for (const topic of topics) {
    const status = asString(topic.status);
    if (status === 'approved') approved += 1;
    else if (status === 'ready') ready += 1;
    else open += 1;
  }

  return { open, ready, approved, total: topics.length };
}

function participantsFor(document: JsonObject): Partial<Record<ParticipantRole, ParticipantSummary>> {
  const participants: Partial<Record<ParticipantRole, ParticipantSummary>> = {};
  const activities = objectOrEmpty(document.activities);

  for (const value of asArray(document.members)) {
    if (!isObject(value)) continue;
    const role = asString(value.role);
    const sessionID = asString(value.sessionID);
    if (!role || !sessionID) continue;

    const participant: ParticipantSummary = { sessionID, role };
    mergeActivity(participant, activities[role]);
    participants[role as ParticipantRole] = participant;
  }

  return participants;
}

function mergeActivity(participant: ParticipantSummary, value: unknown): void {
  if (!isObject(value)) return;
  participant.availability = asString(value.availability);
  participant.state = asString(value.state);
  participant.waitingFor = asString(value.waiting_for);
  participant.unit = asString(value.unit);
}

function previewOf(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function latestBySeq(items: JsonObject[]): JsonObject {
  return items.reduce((current, item) =>
    (asNumber(item.seq) ?? -1) >= (asNumber(current.seq) ?? -1) ? item : current,
  );
}

/** The mirrored message carries the only timestamp a post has. */
function mirrorAt(document: JsonObject, id: string | undefined): string | null {
  if (!id) return null;
  const message = asArray(document.messages)
    .filter(isObject)
    .find((entry) => asString(entry.id) === id);
  return message ? (asString(message.created_at) ?? null) : null;
}

function postSummary(document: JsonObject, post: JsonObject): LastPostSummary {
  return {
    seq: asNumber(post.seq) ?? 0,
    category: asString(post.category) ?? 'post',
    role: asString(post.role) ?? 'unknown',
    preview: previewOf(asString(post.message) ?? ''),
    at: mirrorAt(document, asString(post.id)),
  };
}

function lastForumPost(document: JsonObject, forum: JsonObject): LastPostSummary | undefined {
  const posts = asArray(forum.posts).filter(isObject);
  if (posts.length === 0) return undefined;
  return postSummary(document, latestBySeq(posts));
}

function lastLegacyMessage(document: JsonObject): LastPostSummary | undefined {
  const messages = asArray(document.messages).filter(isObject);
  if (messages.length === 0) return undefined;

  const latest = latestBySeq(messages);

  return {
    seq: asNumber(latest.seq) ?? 0,
    category: asString(latest.type) ?? 'message',
    role: asString(latest.role) ?? 'unknown',
    preview: previewOf(asString(latest.body) ?? ''),
    at: asString(latest.created_at) ?? null,
  };
}

function unreadableSummary(entry: RoomStoreEntry): RoomSummary {
  return {
    key: entry.key,
    id: entry.id,
    kind: entry.kind,
    generation: entry.generation,
    goal: '',
    scopeCount: 0,
    phase: null,
    status: 'unreadable',
    createdAt: null,
    updatedAt: entry.updatedAt,
    topicCounts: { open: 0, ready: 0, approved: 0, total: 0 },
    postCount: 0,
    participants: {},
    hasForum: false,
    unreadable: entry.unreadable ?? 'room document could not be read',
  };
}

export function projectRoom(entry: RoomStoreEntry): RoomSummary {
  if (entry.unreadable !== undefined || !isObject(entry.document)) {
    return unreadableSummary(entry);
  }

  const document = entry.document;
  const forum = forumOf(document);
  const postCount = forum
    ? asArray(forum.posts).filter(isObject).length
    : asArray(document.messages).filter(isObject).length;
  const lastPost = forum ? lastForumPost(document, forum) : lastLegacyMessage(document);

  return {
    key: entry.key,
    id: asString(document.id) ?? entry.id,
    kind: entry.kind,
    generation: asNumber(document.generation) ?? entry.generation,
    goal: asString(document.goal) ?? '',
    scopeCount: asArray(document.scope).length,
    phase: derivePhase(document, forum),
    status: asString(document.status) ?? 'unknown',
    createdAt: asString(document.created_at) ?? null,
    updatedAt: entry.updatedAt,
    topicCounts: topicCountsFor(forum),
    postCount,
    participants: participantsFor(document),
    hasForum: forum !== null,
    ...(lastPost ? { lastPost } : {}),
  };
}

export function projectRoomList(entries: RoomStoreEntry[]): RoomSummary[] {
  return entries.map(projectRoom);
}

/**
 * Cuts text to at most `maxBytes` of UTF-8 without splitting a character.
 * The bound is byte-based because the limit protects the payload size; the
 * helper never returns an unpaired surrogate. Returns unchanged text when it
 * already fits.
 */
function boundUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= maxBytes) low = middle;
    else high = middle - 1;
  }
  // A cut between the two code units of a surrogate pair is not a character.
  const lastCode = low > 0 ? text.charCodeAt(low - 1) : 0;
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) low -= 1;

  return { text: text.slice(0, low), truncated: true };
}

function projectEvidence(value: unknown): EvidenceSummary | undefined {
  if (!isObject(value)) return undefined;
  const bounded = boundUtf8(asString(value.output) ?? '', EVIDENCE_OUTPUT_LIMIT_BYTES);

  return {
    command: asString(value.command) ?? '',
    exitCode: asNumber(value.exit_code) ?? null,
    output: bounded.text,
    truncated: bounded.truncated,
  };
}

function applyPostFields(entry: TimelineEntry, post: JsonObject): void {
  const topic = asString(post.topic);
  if (topic) entry.topic = topic;

  const revision = asNumber(post.revision);
  if (revision !== undefined) entry.revision = revision;

  const replyTo = asString(post.reply_to);
  if (replyTo) entry.replyTo = replyTo;

  const evidence = projectEvidence(post.evidence);
  if (evidence) entry.evidence = evidence;
}

function entryFromMessage(message: JsonObject, post: JsonObject | undefined): TimelineEntry {
  const seq = asNumber(post?.seq) ?? asNumber(message.seq) ?? 0;
  const id = asString(post?.id) ?? asString(message.id) ?? `message-${seq}`;

  const entry: TimelineEntry = {
    id,
    seq,
    at: asString(message.created_at) ?? null,
    role: asString(message.role) ?? asString(post?.role) ?? 'unknown',
    to: asString(message.to) ?? null,
    category: asString(post?.category) ?? asString(message.type) ?? 'message',
    kind: post ? 'post' : 'event',
    message: asString(post?.message) ?? asString(message.body) ?? '',
    seenBy: stringArray(message.read_by),
  };

  if (post) applyPostFields(entry, post);
  return entry;
}

function entryFromUnmirroredPost(post: JsonObject): TimelineEntry {
  const seq = asNumber(post.seq) ?? 0;
  const entry: TimelineEntry = {
    id: asString(post.id) ?? `post-${seq}`,
    seq,
    at: null,
    role: asString(post.role) ?? 'unknown',
    to: null,
    category: asString(post.category) ?? 'post',
    kind: 'post',
    message: asString(post.message) ?? '',
    seenBy: [],
  };

  applyPostFields(entry, post);
  return entry;
}

/**
 * One chronological transcript. `messages` is the spine because it carries
 * each mirrored post plus system events; `forum.posts` enriches a matching id
 * with the typed category, revision, topic and evidence. A post missing from
 * the mirror is still shown instead of losing traffic.
 */
export function projectTimeline(document: JsonObject): TimelineEntry[] {
  const forum = forumOf(document);
  const posts = forum ? asArray(forum.posts).filter(isObject) : [];
  const postsById = new Map<string, JsonObject>();
  for (const post of posts) {
    const id = asString(post.id);
    if (id && !postsById.has(id)) postsById.set(id, post);
  }

  const entries: TimelineEntry[] = [];
  const seen = new Set<string>();

  for (const message of asArray(document.messages).filter(isObject)) {
    const id = asString(message.id);
    const key = id ?? `message-${asNumber(message.seq) ?? entries.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entryFromMessage(message, id ? postsById.get(id) : undefined));
  }

  for (const [id, post] of postsById) {
    if (!seen.has(id)) entries.push(entryFromUnmirroredPost(post));
  }

  return entries.sort((left, right) => left.seq - right.seq);
}

function topicBlockers(status: string): string[] {
  if (status === 'approved') return [];
  if (status === 'ready') return [TOPIC_APPROVAL_BLOCKER];
  return [TOPIC_READINESS_BLOCKER];
}

function projectTopics(document: JsonObject, forum: JsonObject | null): TopicSummary[] {
  if (!forum) return [];

  const posts = asArray(forum.posts).filter(isObject);

  return asArray(forum.topics)
    .filter(isObject)
    .map((topic) => {
      const id = asString(topic.id) ?? '';
      const status = asString(topic.status) ?? 'open';
      const topicPosts = posts.filter((post) => asString(post.topic) === id);
      const summary: TopicSummary = {
        id,
        title: asString(topic.title) ?? id,
        scenarios: stringArray(topic.scenarios),
        paths: stringArray(topic.paths),
        status,
        revision: asNumber(topic.revision) ?? 0,
        blockers: topicBlockers(status),
      };
      if (topicPosts.length > 0) summary.lastPost = postSummary(document, latestBySeq(topicPosts));
      return summary;
    });
}

function projectReconciliation(value: unknown): ReconciliationSummary | undefined {
  if (!isObject(value)) return undefined;

  const submissions = objectOrEmpty(value.submissions);
  const result: ReconciliationSummary = {
    submissions: {},
    reconciled: value.reconciled === true,
    files: stringArray(value.files),
  };

  for (const role of ['driver', 'peer'] as PairRole[]) {
    const submission = submissions[role];
    if (!isObject(submission)) continue;
    const projected: ReconciliationSubmission = {
      sessionID: asString(submission.sessionID) ?? null,
      files: stringArray(submission.files),
      submittedAt: asString(submission.submitted_at) ?? null,
    };
    result.submissions[role] = projected;
  }

  return result;
}

function projectFinalReview(
  document: JsonObject,
  forum: JsonObject | null,
): FinalReviewSummary | undefined {
  if (!forum) return undefined;

  const posts = asArray(forum.posts).filter(isObject);
  const approvals = posts.filter((post) => asString(post.category) === 'final_approved');
  const approved = approvals.length > 0 ? latestBySeq(approvals) : undefined;

  return {
    requested: forum.final_requested === true,
    fingerprint: asString(forum.final_fingerprint) ?? null,
    approvedAt: approved ? mirrorAt(document, asString(approved.id)) : null,
    approvedRole: approved ? (asString(approved.role) ?? null) : null,
  };
}

function projectEscalation(
  document: JsonObject,
  forum: JsonObject | null,
): EscalationSummary | undefined {
  if (!forum) return undefined;

  const posts = asArray(forum.posts).filter(isObject);
  const escalations = posts.filter((post) =>
    ESCALATION_CATEGORIES.has(asString(post.category) ?? ''),
  );
  if (escalations.length === 0) return undefined;

  const latest = latestBySeq(escalations);
  const id = asString(latest.id) ?? '';
  const latestSeq = asNumber(latest.seq) ?? 0;
  const resolved = posts.some(
    (post) =>
      ESCALATION_RESOLUTION_CATEGORIES.has(asString(post.category) ?? '') &&
      asString(post.reply_to) === id &&
      (asNumber(post.seq) ?? 0) > latestSeq,
  );

  return {
    id,
    seq: latestSeq,
    category: asString(latest.category) ?? 'escalate',
    role: asString(latest.role) ?? 'unknown',
    message: asString(latest.message) ?? '',
    at: mirrorAt(document, id),
    resolved,
  };
}

function projectStop(document: JsonObject, forum: JsonObject | null): StopSummary | undefined {
  const aborted = document.status === 'aborted';
  const pending = objectOrEmpty(forum?.pending_stalls);
  const pendingStalls: Partial<Record<PairRole, PendingStallSummary>> = {};

  for (const role of ['driver', 'peer'] as PairRole[]) {
    const stall = pending[role];
    if (!isObject(stall)) continue;
    pendingStalls[role] = {
      sessionID: asString(stall.sessionID) ?? null,
      since: asNumber(stall.since) ?? null,
      reason: asString(stall.reason) ?? null,
    };
  }

  if (!aborted && Object.keys(pendingStalls).length === 0) return undefined;

  return {
    aborted,
    reason: asString(document.abort_reason) ?? null,
    at: asString(document.aborted_at) ?? null,
    pendingStalls,
  };
}

/** Builds everything the room view renders from one parsed room document. */
export function projectRoomDetail(entry: RoomStoreEntry): RoomDetail {
  const room = projectRoom(entry);

  if (entry.unreadable !== undefined || !isObject(entry.document)) {
    return { room, topics: [], timeline: [] };
  }

  const document = entry.document;
  const forum = forumOf(document);
  const detail: RoomDetail = {
    room,
    topics: projectTopics(document, forum),
    timeline: projectTimeline(document),
  };

  const reconciliation = projectReconciliation(document.reconciliation);
  if (reconciliation) detail.reconciliation = reconciliation;

  const finalReview = projectFinalReview(document, forum);
  if (finalReview) detail.finalReview = finalReview;

  const escalation = projectEscalation(document, forum);
  if (escalation) detail.escalation = escalation;

  const stop = projectStop(document, forum);
  if (stop) detail.stop = stop;

  if (!forum) detail.legacyNotice = LEGACY_NOTICE;

  return detail;
}
