import type {
  RoomChange,
  RoomDetail,
  SessionGeneration,
  SessionsResponse,
  SessionSummary,
} from '../../contract';
import { pluralize } from './format';
import { connectLive, type LiveConnection } from './live';
import {
  INITIAL_STATE,
  TABS,
  addedEntries,
  buildRoute,
  defaultSelectionKey,
  findGeneration,
  findSessionByKey,
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
  type RailState,
  type TabId,
  type Theme,
  type ViewState,
} from './model';
import {
  createTimelineView,
  el,
  renderCloseOut,
  renderEmptyStore,
  renderErrorState,
  renderHeader,
  renderHeaderSkeleton,
  renderMissingRoom,
  renderRail,
  renderRoomSkeleton,
  renderSkeletonRail,
  renderTabs,
  renderTopics,
  type TimelineView,
} from './render';

const THEME_KEY = 'pas.forum.theme';
const LIVE_RETRY_BEFORE_OFFLINE = 3;
const ROOM_REFRESH_DEBOUNCE_MS = 250;
const DETAIL_REFRESH_DEBOUNCE_MS = 150;
const CLOCK_INTERVAL_MS = 60_000;

let state: ViewState = { ...INITIAL_STATE, filters: { ...INITIAL_STATE.filters } };
let theme: Theme = 'dark';
let timeline: TimelineView | null = null;
let live: LiveConnection | null = null;
let liveFailures = 0;
let lastAnnouncedNew = 0;
let helpReturnFocus: HTMLElement | null = null;
let lastRailState: RailState | null = null;
let roomRefreshTimer: number | undefined;
let detailRefreshTimer: number | undefined;
let clockTimer: number | undefined;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`The viewer shell is missing #${id}.`);
  return node as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detailUrl(session: SessionSummary, generation: SessionGeneration): string {
  const id = encodeURIComponent(session.id);
  return generation.kind === 'archive'
    ? `/api/rooms/${id}?generation=${encodeURIComponent(String(generation.generation))}`
    : `/api/rooms/${id}`;
}

function selectedSession(): SessionSummary | null {
  return findSessionByKey(state.sessions, state.selectedKey);
}

/** Keeps the header selector usable when only its option list changed. */
function renderSelectedHeader(): void {
  if (!state.detail) return;
  const active = document.activeElement;
  const keepGenerationFocus = active instanceof HTMLElement && active.id === 'generation-select';
  renderHeader(byId('room-header'), state.detail, Date.now(), selectedSession(), (key) =>
    selectRoom(key, state.tab),
  );
  if (keepGenerationFocus) {
    document.getElementById('generation-select')?.focus({ preventScroll: true });
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // A non-JSON error still keeps its status text.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

/* ---- Theme -------------------------------------------------------------- */

function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function applyTheme(next: Theme, persist: boolean): void {
  theme = next;
  document.documentElement.dataset.theme = next;
  const toggle = byId('theme-toggle');
  toggle.setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  toggle.title = next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable in a private window; the toggle still works.
    }
  }
}

/* ---- Static shell ------------------------------------------------------- */

function setConnection(connection: ViewState['connection']): void {
  state = reduce(state, { type: 'connection', connection });
  updateConnectionPill();
}

function updateConnectionPill(): void {
  const pill = byId('connection-pill');
  pill.dataset.state = state.connection;
  const text = pill.querySelector('.conn-text');
  if (text) text.textContent = state.connection;
}

function setRail(open: boolean): void {
  state = reduce(state, { type: 'rail', open });
  const app = byId('app');
  app.dataset.rail = open ? 'open' : 'closed';
  byId('rail-toggle').setAttribute('aria-expanded', String(open));
  byId('rail-backdrop').hidden = !open;
  if (open) byId('rail-sections').querySelector<HTMLElement>('.session-row')?.focus();
  if (!open && window.matchMedia?.('(max-width: 900px)')?.matches) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && byId('rail').contains(active)) {
      byId('rail-toggle').focus();
    }
  }
}

function setHelp(open: boolean): void {
  state = reduce(state, { type: 'help', open });
  const overlay = byId('help-overlay');
  overlay.hidden = !open;

  if (open) {
    helpReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    byId('help-close').focus();
  } else {
    helpReturnFocus?.focus();
    helpReturnFocus = null;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function trapHelpFocus(event: KeyboardEvent): void {
  const overlay = byId('help-overlay');
  const focusable = [...overlay.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (node) => !node.hidden,
  );
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function bindStaticHandlers(): void {
  byId('theme-toggle').addEventListener('click', () => {
    applyTheme(nextTheme(theme), true);
  });
  byId('rail-toggle').addEventListener('click', () => setRail(!state.railOpen));
  byId('rail-backdrop').addEventListener('click', () => setRail(false));
  byId('help-close').addEventListener('click', () => setHelp(false));
  byId('help-overlay').addEventListener('click', (event) => {
    if (event.target === byId('help-overlay')) setHelp(false);
  });

  byId('new-marker').addEventListener('click', () => {
    scrollToBottom();
    state = reduce(state, { type: 'near-bottom', nearBottom: true });
    updateNewMarker();
  });

  byId('tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.indexOf(state.tab);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? TABS.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % TABS.length
            : (index - 1 + TABS.length) % TABS.length;
    const tab = TABS[next]!;
    selectTab(tab);
    byId('tabs').querySelector<HTMLElement>(`#tab-${tab}`)?.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (state.helpOpen) {
        setHelp(false);
        return;
      }
      if (state.railOpen) {
        setRail(false);
        return;
      }
    }

    if (
      event.key === '?' &&
      !isTypingTarget(event.target) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      setHelp(!state.helpOpen);
      return;
    }

    if (state.helpOpen && event.key === 'Tab') trapHelpFocus(event);
  });

  window.addEventListener('scroll', updateNearBottom, { passive: true });
  window.addEventListener('resize', updateNearBottom);
  window.addEventListener('hashchange', applyRoute);
}

/* ---- Routing ------------------------------------------------------------ */

function navigateTo(roomKey: string | null, tab: TabId, replace = false): void {
  const hash = buildRoute({ roomKey, tab });
  if (window.location.hash === hash) return;
  if (replace) window.history.replaceState(null, '', hash);
  else window.location.hash = hash;
}

function applyRoute(): void {
  const route = parseRoute(window.location.hash);

  if (route.roomKey && route.roomKey !== state.selectedKey) {
    selectRoom(route.roomKey, route.tab, { fromRoute: true });
    return;
  }

  if (!route.roomKey) {
    if (state.sessionsStatus === 'ready' && state.sessions.length > 0) {
      const key = defaultSelectionKey(state.sessions);
      if (key) {
        selectRoom(key, route.tab, { fromRoute: true });
        navigateTo(key, route.tab, true);
        return;
      }
    }
    if (state.sessionsStatus === 'ready') renderEmptyWorkspace();
    return;
  }

  if (route.tab !== state.tab) {
    state = reduce(state, { type: 'tab', tab: route.tab });
    renderCurrentView();
  }
}

function selectTab(tab: TabId): void {
  if (state.tab === tab) return;
  state = reduce(state, { type: 'tab', tab });
  navigateTo(state.selectedKey, tab);
  renderCurrentView();
}

/* ---- Rendering ---------------------------------------------------------- */

function renderRailNow(force = false): void {
  const rail = byId('rail-sections');
  const nextState: RailState = { sessions: state.sessions, selectedKey: state.selectedKey };
  // SSE traffic for an unrelated session must not rebuild the list, steal
  // focus or reset the viewport; only a real change reaches the DOM.
  if (!force && lastRailState && sameRailState(lastRailState, nextState)) return;

  const active = document.activeElement;
  const focusedKey =
    active instanceof HTMLElement ? active.closest<HTMLElement>('[data-key]')?.dataset.key : undefined;
  const scrollTop = rail.scrollTop;

  renderRail(rail, state.sessions, state.selectedKey, Date.now(), (key) => selectRoom(key, state.tab));
  lastRailState = nextState;
  rail.scrollTop = scrollTop;
  if (focusedKey) {
    rail.querySelector<HTMLElement>(`[data-key="${focusedKey}"]`)?.focus({ preventScroll: true });
  }
}

function renderRailFailure(message: string): void {
  lastRailState = null;
  byId('rail-sections').replaceChildren(
    el('div', { class: 'rail-empty' }, [
      el('p', { text: 'Could not load the session list.' }),
      el('p', { text: message }),
      el('button', {
        class: 'button-quiet',
        text: 'Retry',
        attrs: { type: 'button' },
        on: { click: () => void refreshSessions() },
      }),
    ]),
  );
}

function renderTabsFor(detail: RoomDetail | null): void {
  const active = document.activeElement;
  const focusedTab =
    active instanceof HTMLElement ? active.closest<HTMLElement>('[data-tab]')?.dataset.tab : undefined;

  renderTabs(
    byId('tabs'),
    state.tab,
    { timeline: detail?.timeline.length ?? 0, topics: detail?.topics.length ?? 0 },
    selectTab,
  );
  byId('view').setAttribute('aria-labelledby', `tab-${state.tab}`);

  if (focusedTab) {
    byId('tabs')
      .querySelector<HTMLElement>(`[data-tab="${focusedTab}"]`)
      ?.focus({ preventScroll: true });
  }
}

function renderCurrentView(): void {
  const header = byId('room-header');
  const view = byId('view');
  const detail = state.detail;

  renderTabsFor(detail);

  if (state.detailStatus === 'error') {
    timeline = null;
    header.replaceChildren();
    view.replaceChildren(
      renderErrorState('Could not load this room', state.detailError ?? 'Unknown error', () => {
        if (state.selectedKey) void loadDetail(state.selectedKey);
      }),
    );
    return;
  }

  if (!detail) {
    timeline = null;
    if (state.detailStatus === 'idle') {
      header.replaceChildren();
      view.replaceChildren(renderMissingRoom());
    } else {
      renderHeaderSkeleton(header);
      view.replaceChildren(renderRoomSkeleton());
    }
    return;
  }

  renderSelectedHeader();

  if (state.tab === 'timeline') {
    timeline = createTimelineView(detail.timeline, {
      filters: state.filters,
      onFiltersChange: (filters) => {
        state = reduce(state, { type: 'filters', filters });
        timeline?.setFilters(state.filters);
      },
      onClearFilters: () => {
        state = reduce(state, { type: 'filters/clear' });
        timeline?.setFilters(state.filters);
      },
      onJump: (seq) => timeline?.focusEntry(seq),
    });
    view.replaceChildren(timeline.root);
  } else {
    timeline = null;
    view.replaceChildren(
      state.tab === 'topics' ? renderTopics(detail, Date.now()) : renderCloseOut(detail, Date.now()),
    );
  }

  updateNearBottom();
}

function renderEmptyWorkspace(): void {
  state = reduce(state, { type: 'room/clear' });
  timeline = null;
  lastRailState = null;
  navigateTo(null, 'timeline', true);
  byId('rail-sections').replaceChildren(
    el('p', { class: 'rail-empty', text: 'No sessions in this project.' }),
  );
  byId('room-header').replaceChildren();
  byId('tabs').replaceChildren();
  byId('view').replaceChildren(renderEmptyStore());
}

/* ---- Room data ---------------------------------------------------------- */

function selectRoom(
  key: string,
  tab: TabId,
  options: { fromRoute?: boolean } = {},
): void {
  // A deep link or click may name a session or one of its generations; an
  // unknown generation inside a known session falls back to that session's
  // default, while an unknown session shows the missing state.
  const resolved = resolveGenerationKey(state.sessions, key);
  const session = findSessionByKey(state.sessions, resolved);
  const generation = session && resolved ? findGeneration(session, resolved) : null;
  if (!resolved || !session || !generation) {
    timeline = null;
    byId('room-header').replaceChildren();
    byId('tabs').replaceChildren();
    byId('view').replaceChildren(renderMissingRoom());
    return;
  }

  const alreadySelected = state.selectedKey === resolved;
  state = reduce(state, { type: 'room/select', key: resolved });
  if (tab !== state.tab) state = reduce(state, { type: 'tab', tab });
  if (!options.fromRoute) navigateTo(resolved, tab);
  if (state.railOpen) setRail(false);

  renderRailNow();
  if (!alreadySelected || !state.detail) {
    renderHeaderSkeleton(byId('room-header'));
    renderCurrentView();
    void loadDetail(resolved);
  } else {
    renderCurrentView();
  }
}

async function loadDetail(key: string): Promise<void> {
  const request: ViewState['selectedKey'] = key;
  const session = findSessionByKey(state.sessions, request);
  const generation = session && request ? findGeneration(session, request) : null;
  if (!session || !generation) return;

  try {
    const detail = await getJson<RoomDetail>(detailUrl(session, generation));
    if (state.selectedKey !== request) return;
    state = reduce(state, { type: 'room/loaded', detail });
    renderCurrentView();
  } catch (error) {
    if (state.selectedKey !== request) return;
    state = reduce(state, { type: 'room/failed', message: messageOf(error) });
    renderCurrentView();
  }
}

function scheduleRoomRefresh(): void {
  if (roomRefreshTimer !== undefined) return;
  roomRefreshTimer = window.setTimeout(() => {
    roomRefreshTimer = undefined;
    void refreshSessions();
  }, ROOM_REFRESH_DEBOUNCE_MS);
}

function scheduleDetailRefresh(): void {
  if (detailRefreshTimer !== undefined) return;
  detailRefreshTimer = window.setTimeout(() => {
    detailRefreshTimer = undefined;
    void refreshSelectedDetail();
  }, DETAIL_REFRESH_DEBOUNCE_MS);
}

async function refreshSessions(): Promise<void> {
  try {
    const body = await getJson<SessionsResponse>('/api/sessions');
    const previousKey = state.selectedKey;
    const previousSession = findSessionByKey(state.sessions, previousKey);
    const nextKey = reconcileSelectedKey(previousKey, body.sessions);
    state = reduce(state, { type: 'sessions/loaded', sessions: body.sessions });
    renderRailNow();

    if (previousKey) {
      if (!nextKey) {
        // The selected session is gone; never leave its detail behind.
        state = reduce(state, { type: 'room/clear' });
        timeline = null;
        if (body.sessions.length === 0) {
          renderEmptyWorkspace();
          return;
        }
        const fallback = defaultSelectionKey(body.sessions);
        if (fallback) {
          selectRoom(fallback, state.tab, { fromRoute: true });
          navigateTo(fallback, state.tab, true);
        }
        return;
      }

      if (nextKey !== previousKey) {
        // Only the selected generation disappeared; keep the session and open
        // its default rather than dropping the reader out of the rail.
        selectRoom(nextKey, state.tab, { fromRoute: true });
        navigateTo(nextKey, state.tab, true);
        return;
      }

      // An archive may have appeared or vanished while the same generation
      // stays selected; the header selector must offer the new list.
      if (state.detail && !sameGenerationKeys(previousSession, selectedSession())) {
        renderSelectedHeader();
      }
      return;
    }

    if (body.sessions.length === 0) {
      renderEmptyWorkspace();
      return;
    }

    const route = parseRoute(window.location.hash);
    const requested = route.roomKey ? resolveGenerationKey(body.sessions, route.roomKey) : null;
    const key = requested ?? defaultSelectionKey(body.sessions);
    if (key) {
      selectRoom(key, route.roomKey ? route.tab : state.tab, { fromRoute: true });
      navigateTo(key, route.roomKey ? route.tab : state.tab, true);
    }
  } catch (error) {
    const message = messageOf(error);
    state = reduce(state, { type: 'sessions/failed', message });
    renderRailFailure(message);
    if (!state.detail) {
      byId('room-header').replaceChildren();
      byId('view').replaceChildren(
        renderErrorState('Could not load the session list', message, () => void refreshSessions()),
      );
    }
  }
}

async function refreshSelectedDetail(): Promise<void> {
  const key = state.selectedKey;
  const session = findSessionByKey(state.sessions, key);
  const generation = session && key ? findGeneration(session, key) : null;
  if (!key || !session || !generation) return;
  if (!state.detail) {
    void loadDetail(key);
    return;
  }

  try {
    const detail = await getJson<RoomDetail>(detailUrl(session, generation));
    if (state.selectedKey !== key) return;
    const previousTimeline = state.detail?.timeline ?? [];
    state = reduce(state, { type: 'room/loaded', detail });
    renderSelectedHeader();
    renderTabsFor(detail);

    const added = addedEntries(previousTimeline, detail.timeline);
    if (detail.timeline.length < previousTimeline.length) {
      // The room was reset or replaced; an append-only view would keep stale
      // entries, so rebuild from the new transcript.
      renderCurrentView();
    } else if (state.tab === 'timeline' && timeline) {
      const wasNearBottom = state.nearBottom;
      timeline.append(detail.timeline);
      if (added.length > 0) {
        state = reduce(state, { type: 'entries/arrived', count: added.length });
        if (wasNearBottom) {
          scrollToBottom();
          state = reduce(state, { type: 'near-bottom', nearBottom: true });
        }
        updateNewMarker();
      }
    } else if (!byId('view').contains(document.activeElement)) {
      renderCurrentView();
    }
  } catch {
    // A transient read failure leaves the transcript the reader is holding
    // untouched; the connection pill already reports the stream state.
  }
}

/* ---- Scroll and marker -------------------------------------------------- */

function scrollToBottom(): void {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior: reduced ? 'auto' : 'smooth',
  });
}

function updateNearBottom(): void {
  const near = isNearBottom({
    scrollTop: window.scrollY,
    clientHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  });
  if (near === state.nearBottom) return;
  state = reduce(state, { type: 'near-bottom', nearBottom: near });
  updateNewMarker();
}

function updateNewMarker(): void {
  const marker = byId<HTMLButtonElement>('new-marker');
  const count = state.newCount;
  const visible = count > 0 && !state.nearBottom;
  marker.hidden = !visible;

  if (visible) {
    marker.replaceChildren(
      el('span', { text: `${count} new` }),
      el('span', { class: 'sr-only', text: count === 1 ? ' entry' : ' entries' }),
    );
    marker.setAttribute('aria-label', `${pluralize(count, 'new entry', 'new entries')}. Scroll to the newest.`);
  }

  // The live region carries new-entry counts only, never other UI changes.
  if (count !== lastAnnouncedNew) {
    lastAnnouncedNew = count;
    byId('live-region').textContent = count > 0 ? pluralize(count, 'new entry', 'new entries') : '';
  }
}

/* ---- Live stream -------------------------------------------------------- */

function handleRoomChange(change: RoomChange): void {
  scheduleRoomRefresh();
  // A change to any generation of the open session can add or alter the
  // header's generation list, not only the generation currently on screen.
  if (sessionIdOfKey(change.key) === sessionIdOfKey(state.selectedKey)) scheduleDetailRefresh();
}

function startLive(): void {
  if (live) return;

  live = connectLive({
    url: '/api/events',
    createSource: (url) => new EventSource(url),
    scheduler: {
      schedule(delay, task) {
        const id = window.setTimeout(task, delay);
        return () => window.clearTimeout(id);
      },
    },
    onOpen() {
      liveFailures = 0;
      setConnection('live');
      void refreshSessions();
      if (state.selectedKey && state.detail) void refreshSelectedDetail();
    },
    onError() {
      liveFailures += 1;
      setConnection(liveFailures >= LIVE_RETRY_BEFORE_OFFLINE ? 'offline' : 'reconnecting');
    },
    onRoomChange: handleRoomChange,
  });
}

/* ---- Boot --------------------------------------------------------------- */

function refreshClock(): void {
  // Relative labels age even when no session changed, so the minute tick is
  // the one refresh that must repaint the rail unconditionally.
  renderRailNow(true);
  renderSelectedHeader();
}

function boot(): void {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true;
  applyTheme(resolveInitialTheme(storedTheme(), prefersDark), false);
  bindStaticHandlers();

  renderSkeletonRail(byId('rail-sections'));
  renderHeaderSkeleton(byId('room-header'));
  renderTabsFor(null);
  byId('view').replaceChildren(renderRoomSkeleton());
  updateConnectionPill();
  updateNewMarker();

  startLive();
  void refreshSessions();

  clockTimer = window.setInterval(refreshClock, CLOCK_INTERVAL_MS);
  window.addEventListener('beforeunload', () => {
    live?.dispose();
    if (clockTimer !== undefined) window.clearInterval(clockTimer);
  });
}

boot();
