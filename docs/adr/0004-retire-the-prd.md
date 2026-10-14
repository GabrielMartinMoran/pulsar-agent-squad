> Owner: PAS maintainers · Updated: 2026-10-14

# ADR 0004: The PRD is retired

- Status: accepted
- Date: 2026-10-14
- Contract: `specs/features/product/project-documentation.feature`

## Context

The PRD was PAS's first product artifact. It predated the living docs, the
merged Gherkin specs, and the prompt contracts, and it duplicated what those
sources now own: product view, workflow, state lifecycle, and quality gates.
Duplicated sources drift, and no test fails when a copy becomes wrong. The
user retired the PRD (2026-10-14); references to it remained across `docs/`
and one test.

## Decision

The PRD is retired and not recreated. The living sources are:

- `docs/` — living docs as maps: `architecture.md` with the ADR index,
  `domain.md`, and `product.md`.
- `specs/features/` — behavior contracts in Gherkin.
- `src/agents/` — prompt contracts for the Lead and workers.
- `docs/adr/` — architecturally significant decisions.

Product-level content without another home lives in `docs/product.md`. New
product requirements become Gherkin specs and docs updates in the same change.
Retired content is either migrated to a living source or consciously
discarded; git history keeps the original.

## Consequences

- One source per concern: docs map, specs define behavior, prompts define
  contracts, and ADRs record decisions; nothing duplicates the retired PRD.
- Docs and specs are updated in the same change that affects them, and the
  integrity test keeps their pointers resolvable.
- Tests and docs that referenced the PRD now reference the surviving sources;
  nothing points at a deleted file.
