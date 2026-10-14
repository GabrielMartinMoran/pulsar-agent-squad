> Owner: PAS maintainers · Updated: 2026-10-13

# ADR 0002: Living docs are maps maintained with the change

- Status: accepted
- Date: 2026-10-13
- Contract: `specs/features/product/project-documentation.feature`

## Context

PAS produced feature state, Gherkin, and memories, but no project-level
documentation. Docs without an owner or maintenance trigger rot and duplicate
the sources they describe; no test fails when a doc becomes wrong.

## Decision

PAS maintains living docs under `docs/` as maps: `architecture.md` with the ADR
index, `domain.md`, `product.md`, and `ui-guidelines.md` when the project has a
UI. Each doc states its owner and updated date on the first line and references
code and specs instead of duplicating them. The matching doc is updated in the
same change that affects it. The Lead surfaces missing or stale docs and offers
to create or update them. Architecturally significant decisions become ADRs
under `docs/adr/`; accepted ADRs are superseded, never rewritten.

## Consequences

- Docs stay short: they translate and explain what cannot be mapped from code
  or specs.
- Doc drift is detectable: the repo keeps a minimal integrity test over
  existence, ownership, and pointer resolution
  (`tests/unit/docs-integrity.test.ts`).
- Every change carries its documentation update; no separate docs backlog.
