> Owner: PAS maintainers · Updated: 2026-10-13

# ADR 0001: Feature state lives in numbered directories

- Status: accepted
- Date: 2026-10-13
- Contract: `specs/features/product/state-hygiene.feature`

## Context

Feature state started as flat artifacts under `.pas/state/`, so features could
not be distinguished, archived as a unit, or numbered safely. Multiple features
could collide, and stale artifacts could linger in active.

## Decision

Feature state lives in one directory per feature, named `NNNNN-slug` with a
five-digit zero-padded number, under `.pas/state/active/` and
`.pas/state/archived/`. Allocation uses the highest number across both
directories plus one, starting at `00001`. Archiving moves the complete
directory and never renumbers or deletes. `max_active` (default one) caps
concurrent active features. Every operation runs through the installed
`pas_toolkit` tool, which blocks malformed or conflicting state instead of
guessing.

## Consequences

- State is single-writer: only the Lead mutates it, through one tool.
- A feature is archived atomically, with its full history.
- Flat legacy artifacts are detected by `pas_toolkit check` and offered for
  cleanup; they are never silently deleted.
- Feature numbers are stable references; renaming or renumbering is forbidden.
