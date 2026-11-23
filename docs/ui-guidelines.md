> Owner: PAS maintainers · Updated: 2026-11-03

# UI guidelines

The forum viewer is an instrument panel for the pairing protocol, not a
dashboard. It is dense, calm and typographic: the reader follows one delegation
at a time, and every surface earns its place by showing protocol state that the
reader needs. This document is the design source of truth for
`src/cli/forum/web/`; the stylesheet is the executable copy. The behaviour
contract is `specs/features/product/forum-viewer.feature` (scenarios 12, 14, 15
and 16) for the shell and `specs/features/product/forum-session-rail.feature`
(scenarios 5–7) for the session rail; the runtime map is
`docs/architecture.md` (Forum viewer).

## Direction

- Dark first, with a real light theme. The dark palette is ink and paper, not
  black and white.
- Hierarchy comes from size, weight and space. Colour is reserved for role
  identity and state, never for decoration.
- Monospace marks identifiers, commands, hashes and sequence numbers. A system
  sans stack carries prose.
- No gradients, no decorative shadows, no rounded-everything. One border
  radius per hierarchy level, and one accent colour.
- The page is read-only. No control in the interface posts, resolves,
  interrupts or mutates a room.

## Layout

The shell is a two-column grid: a fixed-width rail and a flexible reading
column. The rail is sticky at viewport height and scrolls independently; the
conversation scrolls with the page.

| Token | Value | Use |
|---|---|---|
| `--rail-width` | `19rem` | Width of the session rail on wide viewports. |
| `--content-max` | `68rem` | Maximum width of the header, tabs and room view. |

At `900px` and below the rail becomes a drawer with a toggle and a backdrop;
the main column takes the full width. At `560px` and below the timeline entry
grid collapses to one column, the filter bar stacks, and the new-entry marker
moves closer to the edge. Body text is capped at `78ch` and breaks long
identifiers with `overflow-wrap: anywhere`, so nothing overlaps at `360px`.

## Typography

Two system stacks, no external font.

| Token | Value |
|---|---|
| `--font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| `--font-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` |

| Token | Value | Use |
|---|---|---|
| `--text-2xs` | `0.6875rem` | Meta lines, pills, tags, sequence numbers. |
| `--text-xs` | `0.75rem` | Chips, paths, evidence, secondary controls. |
| `--text-sm` | `0.8125rem` | Rail rows, body of compact panels, buttons. |
| `--text-base` | `0.9375rem` | Default body text and timeline prose. |
| `--text-lg` | `1.125rem` | Empty-state and overlay headings. |
| `--text-xl` | `1.375rem` | Room title. |
| `--leading-tight` | `1.25` | Titles and rail goals. |
| `--leading-normal` | `1.5` | Default text and controls. |
| `--leading-relaxed` | `1.65` | Transcript prose, which is read line by line. |

## Colour

The dark theme is the default. The light theme overrides only the core values;
every semantic token resolves through them, so the two themes cannot drift
apart.

### Core palette, dark

| Token | Value | Use |
|---|---|---|
| `--ink-0` | `#0d1015` | Page background. |
| `--ink-1` | `#141920` | Raised surfaces: rail, cards, header. |
| `--ink-2` | `#1b222c` | Hover and skeleton surfaces. |
| `--ink-3` | `#26303d` | Borders and separators. |
| `--paper` | `#e7eaf0` | Primary text. |
| `--paper-dim` | `#9aa4b2` | Secondary text. |
| `--paper-faint` | `#808c9d` | Metadata, timestamps, hints. |
| `--teal` | `#35b7a6` | Accent, driver identity, focus. |
| `--amber` | `#d9a04a` | Peer identity, stalled and reconnecting states. |
| `--violet` | `#a294ea` | Host identity. |
| `--red` | `#d96a72` | Aborted, unreadable, offline and failed exits. |
| `--green` | `#52c07f` | Active, live and approved states. |
| `--blue` | `#5fa6e8` | Closing and ready-for-review states. |

### Core palette, light

| Token | Value |
|---|---|
| `--ink-0` | `#f4f5f7` |
| `--ink-1` | `#ffffff` |
| `--ink-2` | `#eef1f5` |
| `--ink-3` | `#d7dce4` |
| `--paper` | `#161a20` |
| `--paper-dim` | `#57616f` |
| `--paper-faint` | `#646d79` |
| `--teal` | `#0d766a` |
| `--amber` | `#96631a` |
| `--violet` | `#5a4bb0` |
| `--red` | `#b0343d` |
| `--green` | `#1d7a4b` |
| `--blue` | `#2868a8` |

The light theme also overrides `--selection` to `#e3f2ef` and `--backdrop` to
`rgba(20, 24, 30, 0.35)`.

### Semantic surfaces

| Token | Value | Use |
|---|---|---|
| `--bg` | `var(--ink-0)` | Page and input background. |
| `--surface` | `var(--ink-1)` | Cards, rail, evidence bodies, overlays. |
| `--raised` | `var(--ink-2)` | Hover and skeleton fills. |
| `--line` | `var(--ink-3)` | Every border. |
| `--text` | `var(--paper)` | Primary text. |
| `--text-muted` | `var(--paper-dim)` | Secondary text. |
| `--text-faint` | `var(--paper-faint)` | Metadata. |
| `--accent` | `var(--teal)` | Selected markers, links, focus. |
| `--selection` | `#16302f` | Selected rail row and selected text region. |
| `--backdrop` | `rgba(4, 7, 10, 0.62)` | Drawer and overlay scrim. |

### Role identity

Role colour appears only on a post's left edge and its role label. System
events are never role-coloured.

| Token | Value | Use |
|---|---|---|
| `--role-driver` | `var(--teal)` | Driver posts and chips. |
| `--role-peer` | `var(--amber)` | Peer posts and chips. |
| `--role-host` | `var(--violet)` | Host posts and chips. |
| `--role-system` | `var(--paper-faint)` | System events and unknown roles. |

### State

| Token | Value | Use |
|---|---|---|
| `--state-active` | `var(--green)` | Phase `active`, availability `active`, matched reconciliation. |
| `--state-closing` | `var(--blue)` | Phase `closing`, status `ready`, archive notice. |
| `--state-waiting` | `var(--paper-dim)` | Phase `waiting_for_pair`, status `open`, legacy notice. |
| `--state-stalled` | `var(--amber)` | Phase `stalled`, blockers, truncated evidence. |
| `--state-closed` | `var(--paper-faint)` | Phase `closed`, availability `finished`. |
| `--state-aborted` | `var(--red)` | Phase `aborted`, failed exits, unavailable participants. |
| `--state-unreadable` | `var(--red)` | Phase pill when the document could not be read. |
| `--state-live` | `var(--green)` | Stream connection `live`. |
| `--state-reconnecting` | `var(--amber)` | Stream connection `reconnecting`. |
| `--state-offline` | `var(--red)` | Stream connection `offline`. |

A room whose document is unreadable shows the `unreadable` phase pill and an
explicit notice. It is never labelled `waiting_for_pair`.

## Space, shape, motion, focus

| Token | Value | Use |
|---|---|---|
| `--space-1` | `0.25rem` | Tight pairs. |
| `--space-2` | `0.5rem` | Inline gaps. |
| `--space-3` | `0.75rem` | Control padding. |
| `--space-4` | `1rem` | Card padding. |
| `--space-5` | `1.5rem` | Section padding. |
| `--space-6` | `2rem` | Empty states and wide gutters. |
| `--space-7` | `3rem` | Bottom breathing room. |
| `--radius-sm` | `3px` | Inputs, chips, pills' siblings, evidence. |
| `--radius-md` | `6px` | Cards, panels, overlays. |
| `--radius-pill` | `999px` | Phase pills, availability dots, the new-entry marker. |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Drawer and skip-link transitions. |
| `--dur-fast` | `120ms` | Skip-link reveal. |
| `--dur-base` | `200ms` | Drawer slide. |
| `--focus` | `var(--teal)` | Focus ring colour. |
| `--focus-width` | `2px` | Focus ring width. |
| `--focus-offset` | `2px` | Focus ring offset. |

There is no decorative animation. The only authored motion is the skeleton
pulse, the drawer transition and the skip-link reveal; all are removed under
`prefers-reduced-motion: reduce`, and programmatic scrolling becomes instant.

## Components and states

### Rail

`aside.rail` lists one `.session-row` button per session, in the server's
order: last update descending. The project is named once at the top
(`.rail-project`), never on individual rows. Each row shows the effective
session title (two lines maximum), a `goal title` tag when the label is the
goal's first line rather than an OpenCode name, a phase pill, review progress
(`approved/total`, or `no topics`), and a relative last update. A session with
more than one generation carries an `N generations` tag; an unreadable
document carries an `unreadable` tag and omits progress. Archived generations
are never sibling rows. The selected session uses `[data-selected="true"]`,
`aria-current="true"`, the accent border and the selection background, and it
stays selected when fresh traffic re-sorts the list.

A refresh that changes nothing does not rebuild the rail. A real change keeps
the focused row and the rail's scroll position.

### Room header

`header.room-header` shows the full goal as the page `h1`, a phase pill, the
generation and room id in mono, post and review counts, and one
`.chip[data-role]` per participant with an availability dot and label, declared
state and `waiting_for` when present. When the session has more than one
generation, a `.generation-picker` select offers the live document and every
archived generation; its values are the same route keys as deep links (`<id>`
and `<id>@<generation>`). Room-level notices (legacy, archive, unreadable,
aborted) sit directly under the header. The archive notice states that the
generation is a read-only snapshot and points to the selector, not to the rail.

### Tabs

`role="tablist"` with three `role="tab"` buttons: Timeline, Topics and
Close-out. The selected tab is `aria-selected="true"` and keeps a `0` tab
index; the others are `-1` and reachable with the arrow keys, `Home` and `End`.
The view is a `role="tabpanel"` labelled by the selected tab. Room and tab live
in the URL hash, so a reload and a shared link land on the same view.

### Timeline

One ordered list item per timeline item, with a sequence gutter and a content
column.

- Posts carry `[data-role-tone="driver|peer|host"]` and a role-coloured left
  edge, category chip, topic id, revision, relative time and seen-by line.
- System events carry `[data-kind="event"]`, a dashed neutral edge and the
  `System` label. They are not role-coloured.
- Body text preserves line breaks with `white-space: pre-wrap` and never
  overflows horizontally.
- A reply resolves to a `Replying to #seq` button that scrolls to and focuses
  the parent entry. An unresolvable reply is shown as plain text, never a dead
  link.
- Evidence is a closed `<details>` disclosure: the command in mono, an
  exit-code badge (`data-exit="0|nonzero|none"`), and the output in a
  scroll-bounded `<pre>`. When the server truncated the output, the disclosure
  says so explicitly.
- Filters by role and by category, plus a free-text search over message, topic,
  category, role, id and evidence command, with a visible `X of Y entries`
  count and a single Clear action. Filtering hides entries in place; it never
  rebuilds the list, so open disclosures and focus survive.

### Topics

One card per topic: status pill (`data-status`), revision, scenario list,
declared paths in mono (a disclosure above three paths), last-post preview, and
the blockers list when the topic is open or waiting for approval. A legacy room
shows a notice instead of a board.

### Close-out

Panels for reconciliation (per-role file lists with mismatched and omitted
files highlighted in the stalled colour), final approval (requested state and
shortened fingerprint), suite evidence (the last `suite` post, else the final
approval, else the newest post carrying evidence), escalation, and stop. Empty
close-out explains what will appear.

### Live

A connection pill reports `live`, `reconnecting` or `offline`. New entries are
appended to the existing list; the server polls the store and pushes changes
through SSE, and the rail is refreshed without changing the selection, its
order or its scroll position. When the
reader is not near the bottom, a fixed `N new` button appears and an
`aria-live="polite"` region announces only the new-entry count. The marker
clears when the reader returns to the bottom or activates it. Focus and open
disclosures are preserved.

### Cold states and overlays

- Skeleton rows while the session list loads; skeleton blocks while a room loads.
- Empty store: the exact command `./pas` plus where sessions are written.
- Per-session error: message and a Retry button.
- Legacy, archive and unreadable notices, each with its own `data-tone`.
- Shortcut help is a modal dialog (`role="dialog"`, `aria-modal="true"`) opened
  with `?`, closed with `Esc`, with focus trapped while open.
- The mobile drawer uses `#app[data-rail="open"]`, a backdrop, and
  `aria-expanded` on its toggle.

## Accessibility and input

- Landmarks: `aside` rail, `nav`, `main`, `header`, and a `role="tabpanel"`
  view. A skip link jumps to the conversation.
- Every interactive element is a native `button`, `a`, `select` or `input`, is
  reachable by Tab, and gets the shared `:focus-visible` ring.
- The selected session exposes `aria-current="true"`; tabs expose
  `aria-selected`; the new-entry marker, icon buttons and the generation
  selector carry `aria-label`.
- New-entry counts are the only content in the polite live region.
- `prefers-reduced-motion: reduce` disables transitions, animations, smooth
  scrolling and the skeleton pulse.
- The theme toggle writes `pas.forum.theme` to `localStorage` and otherwise
  follows the system preference on first load. The `<html>` element carries
  `data-theme="dark"` or `data-theme="light"`.

## Voice

Copy is English, sentence case and direct. Errors say what failed and what to
do next; empty states name the command that creates rooms; labels are verbs
when they act ("Clear filters", "Retry"). No emoji is used as an icon: the few
icons are inline SVG, and the rest of the visual language is typographic.
