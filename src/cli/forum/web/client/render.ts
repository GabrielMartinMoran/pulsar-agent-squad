import type {
  EvidenceSummary,
  ParticipantRole,
  RoomDetail,
  RoomSummary,
  SessionGeneration,
  SessionSummary,
  TimelineEntry,
  TopicSummary,
} from '../../contract';
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
} from './format';
import {
  auditReconciliation,
  defaultGenerationKey,
  entryMatches,
  filterOptions,
  findGeneration,
  isFilterActive,
  sessionIdOfKey,
  suiteEvidence,
  usesFallbackTitle,
  type TabId,
  type TimelineFilters,
} from './model';

export type ElChild = Node | string | null | undefined;
export type AttrValue = string | number | boolean | null | undefined;

export interface ElOptions {
  class?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, AttrValue>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

/**
 * The only DOM builder the client uses. Room text always reaches the page
 * through `textContent`; there is no HTML-string path, so a room can never
 * inject markup into the viewer.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: ElChild[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title !== undefined) node.title = options.title;

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }

  for (const [type, handler] of Object.entries(options.on ?? {})) {
    if (handler) node.addEventListener(type, handler as EventListener);
  }

  appendChildren(node, children);
  return node;
}

function appendChildren(parent: Node, children: ElChild[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

function pill(label: string, attribute: 'data-phase' | 'data-status', value: string): HTMLElement {
  return el('span', { class: 'pill', text: label, attrs: { [attribute]: value } });
}

function timeNode(at: string | null, now: number): HTMLElement {
  if (!at) return el('span', { class: 'room-time', text: 'no timestamp' });
  return el('time', {
    class: 'room-time',
    text: formatRelativeTime(at, now),
    attrs: { datetime: at, title: formatAbsoluteTime(at) },
  });
}

/* ---- Rail --------------------------------------------------------------- */

function sessionRow(
  session: SessionSummary,
  selectedKey: string | null,
  now: number,
  onSelect: (key: string) => void,
): HTMLElement {
  const selected = sessionIdOfKey(selectedKey) === session.id;
  const phaseLabel = formatPhase(session.phase);
  const progress = formatProgress(session.counts.approved, session.counts.total);
  const fallback = usesFallbackTitle(session);
  const meta: ElChild[] = [pill(phaseLabel, 'data-phase', phaseTone(session.phase))];

  // Counts belong to the default generation; an unreadable document cannot be
  // trusted to report them, so the row omits progress instead of showing zero.
  if (session.phase !== null) {
    meta.push(el('span', { class: 'mono', text: progress }));
  }
  if (fallback) {
    meta.push(
      el('span', {
        class: 'tag',
        text: 'goal title',
        attrs: {
          'data-tag': 'fallback',
          title: "No OpenCode session name is available; this is the goal's first line.",
        },
      }),
    );
  }
  if (session.generations.length > 1) {
    meta.push(
      el('span', {
        class: 'tag',
        text: pluralize(session.generations.length, 'generation'),
      }),
    );
  }
  if (session.phase === null) {
    meta.push(el('span', { class: 'tag', text: 'unreadable', attrs: { 'data-tag': 'unreadable' } }));
  } else if (!session.hasForum) {
    meta.push(el('span', { class: 'tag', text: 'legacy' }));
  }
  meta.push(timeNode(session.updatedAt, now));

  const described = [
    session.title,
    fallback ? 'goal title fallback' : null,
    phaseLabel,
    session.phase === null ? null : progress,
    formatRelativeTime(session.updatedAt, now),
  ].filter((part): part is string => Boolean(part));

  return el(
    'button',
    {
      class: 'session-row',
      attrs: {
        type: 'button',
        'data-key': session.id,
        'data-selected': selected ? 'true' : undefined,
        'aria-current': selected ? 'true' : undefined,
        'aria-label': described.join(', '),
      },
      on: {
        click: () => {
          const key = defaultGenerationKey(session);
          if (key) onSelect(key);
        },
      },
    },
    [
      el('span', { class: 'session-title', text: session.title }),
      el('span', { class: 'session-meta' }, meta),
    ],
  );
}

/**
 * One row per session, in the server's order (last update descending). The
 * project is named once at the top; archived generations never appear as
 * sibling rows.
 */
export function renderRail(
  container: HTMLElement,
  sessions: readonly SessionSummary[],
  selectedKey: string | null,
  now: number,
  onSelect: (key: string) => void,
): void {
  if (sessions.length === 0) {
    container.replaceChildren(
      el('p', { class: 'rail-empty', text: 'No sessions in this project.' }),
    );
    return;
  }

  const project = sessions[0]!.project;
  container.replaceChildren(
    el('p', { class: 'rail-project' }, [
      el('span', { text: 'Project' }),
      el('span', { class: 'mono rail-project-name', text: project, attrs: { title: project } }),
    ]),
    el(
      'div',
      { class: 'session-list' },
      sessions.map((session) => sessionRow(session, selectedKey, now, onSelect)),
    ),
  );
}

/* ---- Room header -------------------------------------------------------- */

const PARTICIPANT_ORDER: ParticipantRole[] = ['host', 'driver', 'peer'];

function participantChip(
  role: ParticipantRole,
  participant: NonNullable<RoomSummary['participants'][ParticipantRole]>,
): HTMLElement {
  const state = participant.state?.replace(/_/g, ' ');
  const children: ElChild[] = [
    el('span', {
      class: 'avail',
      attrs: { 'data-availability': participant.availability ?? 'unknown' },
      title: participant.availability ?? 'unknown availability',
    }),
    el('span', { class: 'role', text: formatRole(role) }),
    el('span', { class: 'availability', text: participant.availability ?? 'unknown' }),
    el('span', {
      class: 'mono',
      text: participant.sessionID.length > 10 ? `…${participant.sessionID.slice(-8)}` : participant.sessionID,
      attrs: { title: participant.sessionID },
    }),
  ];
  if (state) children.push(el('span', { class: 'state', text: state }));
  if (participant.waitingFor) {
    children.push(el('span', { class: 'waiting', text: `waiting for ${participant.waitingFor}` }));
  }

  return el('span', { class: 'chip', attrs: { 'data-role': role } }, children);
}

function headerNotice(detail: RoomDetail, session: SessionSummary | null): HTMLElement[] {
  const notices: HTMLElement[] = [];

  if (detail.room.phase === null) {
    notices.push(
      el('div', { class: 'notice', attrs: { role: 'note', 'data-tone': 'error' } }, [
        el('strong', { text: 'This room is unreadable. ' }),
        el('span', {
          text: `${detail.room.unreadable ?? 'The room document could not be parsed.'} No phase is inferred; it is not shown as waiting for a pair.`,
        }),
      ]),
    );
  }

  if (detail.room.kind === 'archive') {
    const hasLive = session?.generations.some((generation) => generation.kind === 'live') ?? false;
    notices.push(
      el('div', { class: 'notice', attrs: { role: 'note', 'data-tone': 'archive' } }, [
        el('span', {
          text: hasLive
            ? `Read-only snapshot of generation ${detail.room.generation}. Choose the live generation from this header to return to current traffic.`
            : `Read-only snapshot of generation ${detail.room.generation}. This session has no live document.`,
        }),
      ]),
    );
  }

  if (detail.legacyNotice) {
    notices.push(
      el('div', { class: 'notice', attrs: { role: 'note', 'data-tone': 'legacy' }, text: detail.legacyNotice }),
    );
  }

  if (detail.stop?.aborted) {
    notices.push(
      el('div', { class: 'notice', attrs: { role: 'note', 'data-tone': 'error' } }, [
        el('strong', { text: 'Room aborted. ' }),
        el('span', { text: detail.stop.reason ?? 'No reason recorded.' }),
      ]),
    );
  }

  return notices;
}

function generationLabel(generation: SessionGeneration): string {
  return generation.kind === 'live'
    ? `Live (generation ${generation.generation})`
    : `Generation ${generation.generation} (archived)`;
}

/** Every generation of the session, wired to the same route keys as deep links. */
function generationPicker(
  session: SessionSummary,
  currentKey: string,
  onSelect: (key: string) => void,
): HTMLElement | null {
  if (session.generations.length < 2) return null;

  const select = el('select', {
    attrs: { id: 'generation-select', 'aria-label': 'Generation' },
    on: { change: () => onSelect(select.value) },
  });
  for (const generation of session.generations) {
    select.append(
      el('option', { text: generationLabel(generation), attrs: { value: generation.key } }),
    );
  }
  select.value = findGeneration(session, currentKey)
    ? currentKey
    : (defaultGenerationKey(session) ?? '');

  return el('label', { class: 'generation-picker', attrs: { for: 'generation-select' } }, [
    el('span', { text: 'Generation' }),
    select,
  ]);
}

export function renderHeader(
  container: HTMLElement,
  detail: RoomDetail,
  now: number,
  session: SessionSummary | null,
  onSelectGeneration: (key: string) => void,
): void {
  const room = detail.room;
  const participants = PARTICIPANT_ORDER.flatMap((role) => {
    const participant = room.participants[role];
    return participant ? [participantChip(role, participant)] : [];
  });
  const picker = session ? generationPicker(session, room.key, onSelectGeneration) : null;

  const sub: ElChild[] = [
    el('span', { class: 'mono', text: pluralize(room.postCount, 'post') }),
    el('span', { class: 'mono', text: formatReviewProgress(room.topicCounts) }),
    el('span', {
      text: pluralize(room.scopeCount, 'scope item'),
    }),
  ];
  if (room.createdAt) {
    sub.push(el('span', { text: `created ${formatRelativeTime(room.createdAt, now)}` }));
  }

  const header: Array<HTMLElement | null> = [
    el('div', { class: 'room-kicker' }, [
      pill(formatPhase(room.phase), 'data-phase', phaseTone(room.phase)),
      el('span', { class: 'mono', text: `gen ${room.generation}` }),
      el('span', { class: 'mono', text: room.id }),
    ]),
    el('h1', { class: 'room-title', text: room.goal || 'Untitled room' }),
    picker,
    el('div', { class: 'room-sub' }, sub),
    participants.length > 0
      ? el('div', { class: 'participants', attrs: { 'aria-label': 'Participants' } }, participants)
      : el('p', { class: 'room-sub', text: 'No participants recorded.' }),
    ...headerNotice(detail, session),
  ];
  container.replaceChildren(
    ...header.filter((child): child is HTMLElement => child !== null),
  );
}

export function renderHeaderSkeleton(container: HTMLElement): void {
  container.replaceChildren(
    el('div', { class: 'skeleton skeleton-block' }),
    el('div', { class: 'skeleton skeleton-row' }),
  );
}

/* ---- Tabs --------------------------------------------------------------- */

export function renderTabs(
  container: HTMLElement,
  active: TabId,
  counts: { timeline: number; topics: number },
  onSelect: (tab: TabId) => void,
): void {
  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'timeline', label: 'Timeline', count: counts.timeline },
    { id: 'topics', label: 'Topics', count: counts.topics },
    { id: 'closeout', label: 'Close-out' },
  ];

  container.replaceChildren(
    ...tabs.map((tab) => {
      const selected = tab.id === active;
      const children: ElChild[] = [el('span', { text: tab.label })];
      if (tab.count !== undefined) {
        children.push(el('span', { class: 'count', text: String(tab.count) }));
      }
      return el(
        'button',
        {
          class: 'tab',
          attrs: {
            type: 'button',
            role: 'tab',
            id: `tab-${tab.id}`,
            'aria-selected': selected ? 'true' : 'false',
            'aria-controls': 'view',
            tabindex: selected ? '0' : '-1',
            'data-tab': tab.id,
          },
          on: { click: () => onSelect(tab.id) },
        },
        children,
      );
    }),
  );
}

/* ---- Evidence ----------------------------------------------------------- */

export function evidenceBlock(evidence: EvidenceSummary): HTMLElement {
  const exitTone = evidence.exitCode === null ? 'none' : evidence.exitCode === 0 ? '0' : 'nonzero';
  const details = el('details', { class: 'evidence' }, [
    el('summary', {}, [
      el('span', { text: 'Evidence' }),
      el('span', {
        class: 'exit-badge',
        text: formatExitCode(evidence.exitCode),
        attrs: { 'data-exit': exitTone },
      }),
    ]),
    el('div', { class: 'evidence-body' }, [
      el('code', { class: 'evidence-command', text: evidence.command || '(no command)' }),
      el('pre', { class: 'evidence-output', text: evidence.output }),
      evidence.truncated
        ? el('p', {
            class: 'truncated',
            text: 'Output truncated at 8 KiB by the viewer. Open the room document for the full text.',
          })
        : null,
    ]),
  ]);
  return details;
}

/* ---- Timeline ----------------------------------------------------------- */

export interface TimelineViewOptions {
  filters: TimelineFilters;
  onFiltersChange: (filters: Partial<TimelineFilters>) => void;
  onClearFilters: () => void;
  onJump: (seq: number) => void;
}

export interface TimelineView {
  root: HTMLElement;
  setFilters(filters: TimelineFilters): void;
  append(entries: readonly TimelineEntry[]): void;
  focusEntry(seq: number): void;
}

interface EntryRecord {
  entry: TimelineEntry;
  node: HTMLElement;
}

function option(value: string, label: string): HTMLOptionElement {
  return el('option', { text: label, attrs: { value } });
}

function buildEntry(
  entry: TimelineEntry,
  idToSeq: Map<string, number>,
  onJump: (seq: number) => void,
): HTMLElement {
  const isEvent = entry.kind === 'event';
  const meta: ElChild[] = [
    el('span', { class: 'role', text: isEvent ? 'System' : formatRole(entry.role) }),
    el('span', { class: 'category-chip', text: formatCategory(entry.category) }),
  ];

  if (entry.topic) {
    meta.push(el('span', { class: 'topic-ref mono', text: `#${entry.topic}`, attrs: { title: `Topic ${entry.topic}` } }));
  }
  if (entry.revision !== undefined) {
    meta.push(el('span', { class: 'revision mono', text: `r${entry.revision}` }));
  }
  meta.push(timeNode(entry.at, Date.now()));
  meta.push(
    el('span', {
      class: 'seen',
      text:
        entry.seenBy.length > 0
          ? `seen by ${entry.seenBy.map(formatRole).join(', ')}`
          : 'not seen',
    }),
  );

  const foot: ElChild[] = [];
  if (entry.replyTo) {
    const parentSeq = idToSeq.get(entry.replyTo);
    if (parentSeq !== undefined && parentSeq !== entry.seq) {
      foot.push(
        el('button', {
          class: 'jump',
          text: `Replying to #${parentSeq}`,
          attrs: { type: 'button' },
          on: { click: () => onJump(parentSeq) },
        }),
      );
    } else {
      foot.push(el('span', { class: 'jump jump--missing', text: `Replying to ${entry.replyTo}` }));
    }
  }
  if (entry.evidence) foot.push(evidenceBlock(entry.evidence));

  const attrs: Record<string, AttrValue> = {
    id: `entry-${entry.seq}`,
    'data-entry-id': entry.id,
    'data-kind': entry.kind,
    tabindex: '-1',
  };
  if (!isEvent) attrs['data-role-tone'] = roleTone(entry.role);

  return el('li', { class: 'timeline-entry', attrs }, [
    el('div', { class: 'entry-inner' }, [
      el('span', { class: 'entry-seq', text: `#${entry.seq}` }),
      el('div', { class: 'entry-main' }, [
        el('div', { class: 'entry-meta' }, meta),
        el('p', { class: 'entry-body', text: entry.message || '(empty message)' }),
        foot.length > 0 ? el('div', { class: 'entry-foot' }, foot) : null,
      ]),
    ]),
  ]);
}

function syncOptions(select: HTMLSelectElement, values: readonly string[], label: (value: string) => string): void {
  const present = new Set([...select.options].map((item) => item.value));
  for (const value of values) {
    if (present.has(value)) continue;
    select.append(option(value, label(value)));
  }
}

export function createTimelineView(
  entries: readonly TimelineEntry[],
  options: TimelineViewOptions,
): TimelineView {
  const optionsForEntries = filterOptions(entries);
  const idToSeq = new Map<string, number>(entries.map((entry) => [entry.id, entry.seq]));
  const records = new Map<string, EntryRecord>();
  const seqToNode = new Map<number, HTMLElement>();

  let filters = options.filters;
  let visible = 0;

  const roleSelect = el('select', {
    attrs: { id: 'filter-role', 'aria-label': 'Filter by role' },
    on: { change: () => options.onFiltersChange({ role: roleSelect.value }) },
  });
  roleSelect.append(option('all', 'All roles'));
  for (const role of optionsForEntries.roles) roleSelect.append(option(role, formatRole(role)));

  const categorySelect = el('select', {
    attrs: { id: 'filter-category', 'aria-label': 'Filter by category' },
    on: { change: () => options.onFiltersChange({ category: categorySelect.value }) },
  });
  categorySelect.append(option('all', 'All categories'));
  for (const category of optionsForEntries.categories) {
    categorySelect.append(option(category, formatCategory(category)));
  }

  const search = el('input', {
    attrs: {
      id: 'filter-search',
      type: 'search',
      placeholder: 'Message, topic, path',
      'aria-label': 'Search the timeline',
    },
    on: { input: () => options.onFiltersChange({ query: search.value }) },
  });

  const clear = el('button', {
    class: 'button-quiet',
    text: 'Clear filters',
    attrs: { type: 'button' },
    on: { click: () => options.onClearFilters() },
  });

  const count = el('span', { class: 'result-count', text: '' });
  const list = el('ol', { class: 'timeline-list' });
  const emptyTimeline = el('div', {
    class: 'empty',
    text: 'No traffic in this room yet.',
  });
  const emptyFiltered = el('div', {
    class: 'empty',
    text: 'No entries match these filters.',
  });
  emptyFiltered.hidden = true;
  emptyTimeline.hidden = entries.length > 0;

  const toolbar = el('div', { class: 'filters' }, [
    el('label', { class: 'filter' }, [el('span', { text: 'Role' }), roleSelect]),
    el('label', { class: 'filter' }, [el('span', { text: 'Category' }), categorySelect]),
    el('label', { class: 'filter filter--search' }, [el('span', { text: 'Search' }), search]),
    el('div', { class: 'filters-foot' }, [count, clear]),
  ]);

  function apply(): void {
    visible = 0;
    for (const record of records.values()) {
      const match = isFilterActive(filters) ? entryMatches(record.entry, filters) : true;
      record.node.hidden = !match;
      if (match) visible += 1;
    }
    count.textContent = `${visible} of ${records.size} entries`;
    emptyTimeline.hidden = records.size !== 0;
    emptyFiltered.hidden = !(records.size > 0 && visible === 0);
    clear.disabled = !isFilterActive(filters);
    roleSelect.value = filters.role;
    categorySelect.value = filters.category;
    if (search.value !== filters.query) search.value = filters.query;
  }

  function add(entry: TimelineEntry): void {
    if (records.has(entry.id)) return;
    const node = buildEntry(entry, idToSeq, options.onJump);
    list.append(node);
    records.set(entry.id, { entry, node });
    seqToNode.set(entry.seq, node);
    if (entry.replyTo && !idToSeq.has(entry.replyTo)) idToSeq.set(entry.replyTo, entry.seq);
    syncOptions(roleSelect, [entry.role], formatRole);
    syncOptions(categorySelect, [entry.category], formatCategory);
  }

  for (const entry of entries) add(entry);
  apply();

  const root = el('div', { class: 'timeline' }, [toolbar, emptyTimeline, emptyFiltered, list]);

  return {
    root,
    setFilters(next: TimelineFilters): void {
      filters = next;
      apply();
    },
    append(next: readonly TimelineEntry[]): void {
      for (const entry of next) add(entry);
      apply();
    },
    focusEntry(seq: number): void {
      const node = seqToNode.get(seq);
      if (!node) return;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
      node.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      node.focus({ preventScroll: true });
    },
  };
}

/* ---- Topics ------------------------------------------------------------- */

function pathsBlock(topic: TopicSummary): HTMLElement | null {
  if (topic.paths.length === 0) return null;
  const list = el('ul', { class: 'path-list' });
  for (const path of topic.paths) list.append(el('li', { text: path }));

  if (topic.paths.length <= 3) {
    return el('div', { class: 'paths' }, [
      el('p', { class: 'status-line', text: pluralize(topic.paths.length, 'declared path') }),
      list,
    ]);
  }

  return el('details', { class: 'paths' }, [
    el('summary', { text: pluralize(topic.paths.length, 'declared path') }),
    list,
  ]);
}

function topicCard(topic: TopicSummary, now: number): HTMLElement {
  const status = ['open', 'ready', 'approved'].includes(topic.status) ? topic.status : 'unknown';
  const children: ElChild[] = [
    el('div', { class: 'topic-head' }, [
      el('h3', { class: 'topic-title', text: topic.title || topic.id }),
      pill(formatCategory(topic.status), 'data-status', status),
      el('div', { class: 'topic-meta' }, [
        el('span', { class: 'mono', text: `r${topic.revision}` }),
        el('span', { text: pluralize(topic.scenarios.length, 'scenario') }),
      ]),
    ]),
  ];

  if (topic.scenarios.length > 0) {
    const scenarios = el('ul', { class: 'topic-scenarios' });
    for (const scenario of topic.scenarios) scenarios.append(el('li', { text: scenario }));
    children.push(scenarios);
  }

  const paths = pathsBlock(topic);
  if (paths) children.push(paths);

  if (topic.blockers.length > 0) {
    const blockers = el('ul', { class: 'blockers' });
    for (const blocker of topic.blockers) blockers.append(el('li', { text: blocker }));
    children.push(blockers);
  }

  if (topic.lastPost) {
    children.push(
      el('div', { class: 'topic-last' }, [
        el('span', {
          text: `${formatRole(topic.lastPost.role)} · ${formatCategory(topic.lastPost.category)} · ${formatRelativeTime(
            topic.lastPost.at,
            now,
          )}`,
        }),
        el('div', { text: truncateText(topic.lastPost.preview, 220) }),
      ]),
    );
  }

  return el('article', { class: 'topic-card', attrs: { 'aria-label': topic.title || topic.id } }, children);
}

export function renderTopics(detail: RoomDetail, now: number): HTMLElement {
  const root = el('div', { class: 'topic-list' });

  if (detail.topics.length === 0) {
    root.append(
      el('div', { class: 'empty' }, [
        el('h2', { text: detail.legacyNotice ? 'No topic board' : 'No topics declared' }),
        el('p', {
          text: detail.legacyNotice
            ? 'This room predates the pairing forum; the Timeline tab shows its message log.'
            : 'Topics appear here when the pair opens them.',
        }),
      ]),
    );
    return root;
  }

  for (const topic of detail.topics) root.append(topicCard(topic, now));
  return root;
}

/* ---- Close-out ---------------------------------------------------------- */

function fileList(files: readonly string[], mismatched: readonly string[]): HTMLElement {
  const list = el('ul', { class: 'file-list' });
  for (const file of files) {
    const isMismatch = mismatched.includes(file);
    list.append(
      el('li', { class: isMismatch ? 'file--mismatch' : undefined, text: file, attrs: isMismatch ? { title: 'Mismatched file' } : {} }),
    );
  }
  return list;
}

function reconciliationPanel(detail: RoomDetail): HTMLElement {
  const reconciliation = detail.reconciliation!;
  const audit = auditReconciliation(detail);
  const children: ElChild[] = [
    el('h2', { text: 'Reconciliation' }),
    el('div', { class: 'status-line' }, [
      el('span', {
        class: audit.matched ? 'badge-ok' : 'badge-warn',
        text: audit.matched ? 'Matched' : 'Mismatch',
      }),
      el('span', { text: reconciliation.reconciled ? 'reconciled' : 'not reconciled' }),
    ]),
  ];

  for (const role of ['driver', 'peer'] as const) {
    const submission = reconciliation.submissions[role];
    children.push(el('h3', { text: formatRole(role) }));
    if (!submission) {
      children.push(el('p', { class: 'status-line', text: 'No submission.' }));
      continue;
    }
    children.push(fileList(submission.files, [...audit.asymmetric, ...audit.omitted]));
    if (submission.submittedAt) {
      children.push(
        el('p', {
          class: 'status-line',
          text: `submitted ${formatRelativeTime(submission.submittedAt, Date.now())}`,
        }),
      );
    }
  }

  if (audit.unclaimed.length > 0) {
    children.push(el('h3', { text: 'In the final list but not submitted' }));
    children.push(fileList(audit.unclaimed, audit.unclaimed));
  }
  if (audit.omitted.length > 0) {
    children.push(el('h3', { text: 'Submitted but not in the final list' }));
    children.push(fileList(audit.omitted, audit.omitted));
  }
  if (reconciliation.files.length > 0) {
    children.push(el('h3', { text: 'Final file list' }));
    children.push(fileList(reconciliation.files, audit.unclaimed));
  }

  return el('section', { class: 'panel' }, children);
}

function finalReviewPanel(detail: RoomDetail): HTMLElement | null {
  const finalReview = detail.finalReview;
  if (!finalReview) return null;

  const children: ElChild[] = [
    el('h2', { text: 'Final approval' }),
    el('div', { class: 'status-line' }, [
      el('span', {
        class: finalReview.requested ? 'badge-ok' : 'badge-warn',
        text: finalReview.requested ? 'Final review requested' : 'Final review not requested',
      }),
      el('span', { class: 'mono', text: `fingerprint ${shortFingerprint(finalReview.fingerprint)}`, attrs: {
        title: finalReview.fingerprint ?? 'no fingerprint',
      } }),
    ]),
  ];

  if (finalReview.approvedAt) {
    children.push(
      el('p', {
        class: 'status-line',
        text: `approved by ${formatRole(finalReview.approvedRole ?? 'unknown')} · ${formatAbsoluteTime(
          finalReview.approvedAt,
        )}`,
      }),
    );
  }

  return el('section', { class: 'panel' }, children);
}

function suitePanel(detail: RoomDetail, now: number): HTMLElement | null {
  const entry = suiteEvidence(detail);
  if (!entry?.evidence) return null;

  const isFinal =
    entry.category === 'suite' || entry.category === 'final_approved';
  return el('section', { class: 'panel' }, [
    el('h2', { text: isFinal ? 'Suite evidence' : 'Latest evidence' }),
    el('p', {
      class: 'status-line',
      text: `#${entry.seq} · ${formatRole(entry.role)} · ${formatCategory(entry.category)} · ${formatRelativeTime(
        entry.at,
        now,
      )}`,
    }),
    evidenceBlock(entry.evidence),
  ]);
}

function stopPanel(detail: RoomDetail): HTMLElement | null {
  const stop = detail.stop;
  if (!stop) return null;

  const children: ElChild[] = [
    el('h2', { text: 'Stop' }),
    el('p', { class: 'status-line', text: stop.aborted ? 'aborted' : 'stall candidate pending' }),
  ];
  if (stop.reason) children.push(el('p', { class: 'status-line', text: stop.reason }));
  if (stop.at) children.push(el('p', { class: 'status-line', text: formatAbsoluteTime(stop.at) }));

  for (const role of ['driver', 'peer'] as const) {
    const stall = stop.pendingStalls[role];
    if (!stall) continue;
    children.push(
      el('h3', { text: `${formatRole(role)} pending stall` }),
      el('p', { class: 'status-line', text: stall.reason ?? 'no reason recorded' }),
    );
  }

  return el('section', { class: 'panel' }, children);
}

function escalationPanel(detail: RoomDetail): HTMLElement | null {
  const escalation = detail.escalation;
  if (!escalation) return null;

  return el('section', { class: 'panel' }, [
    el('h2', { text: 'Escalation' }),
    el('div', { class: 'status-line' }, [
      el('span', { class: escalation.resolved ? 'badge-ok' : 'badge-warn', text: escalation.resolved ? 'resolved' : 'open' }),
      el('span', { class: 'mono', text: `#${escalation.seq} ${formatCategory(escalation.category)}` }),
      el('span', { text: formatRole(escalation.role) }),
    ]),
    el('p', { class: 'entry-body', text: escalation.message }),
  ]);
}

export function renderCloseOut(detail: RoomDetail, now: number): HTMLElement {
  const root = el('div', { class: 'closeout' });
  const panels = [
    detail.reconciliation ? reconciliationPanel(detail) : null,
    finalReviewPanel(detail),
    suitePanel(detail, now),
    escalationPanel(detail),
    stopPanel(detail),
  ].filter((panel): panel is HTMLElement => panel !== null);

  if (panels.length === 0) {
    root.append(
      el('div', { class: 'empty' }, [
        el('h2', { text: 'No close-out yet' }),
        el('p', { text: 'Reconciliation, final approval and suite evidence appear here as the pair reaches them.' }),
      ]),
    );
    return root;
  }

  root.append(...panels);
  return root;
}

/* ---- Cold states -------------------------------------------------------- */

export function renderSkeletonRail(container: HTMLElement, rows = 5): void {
  container.replaceChildren(
    ...Array.from({ length: rows }, () => el('div', { class: 'skeleton skeleton-row' })),
  );
}

export function renderRoomSkeleton(): HTMLElement {
  return el('div', {}, [
    el('div', { class: 'skeleton skeleton-block' }),
    el('div', { class: 'skeleton skeleton-block' }),
    el('div', { class: 'skeleton skeleton-row' }),
  ]);
}

export function renderEmptyStore(): HTMLElement {
  return el('div', { class: 'empty' }, [
    el('h1', { text: 'No sessions in this project' }),
    el('p', {
      text: 'A session appears when a PAS delegation starts and writes .pas/rooms/<id>.json. Start the Lead in this project, then reload the viewer.',
    }),
    el('code', { class: 'command', text: './pas' }),
  ]);
}

export function renderErrorState(title: string, message: string, onRetry: () => void): HTMLElement {
  return el('div', { class: 'empty' }, [
    el('h2', { text: title }),
    el('p', { text: message }),
    el('button', {
      class: 'button-quiet',
      text: 'Retry',
      attrs: { type: 'button' },
      on: { click: onRetry },
    }),
  ]);
}

export function renderMissingRoom(): HTMLElement {
  return el('div', { class: 'empty' }, [
    el('h2', { text: 'Session not found' }),
    el('p', { text: 'This session is no longer in the store. Pick another session from the rail.' }),
  ]);
}
