> Owner: PAS maintainers · Updated: 2026-10-13

# ADR 0003: pas_toolkit ships as an installed tool

- Status: accepted
- Date: 2026-10-13
- Contract: `specs/features/product/state-hygiene.feature`

## Context

State lifecycle operations need deterministic behavior in every session,
including sessions where the PAS development CLI is not available. A
development-only script would make the Lead's state operations depend on the
repo checkout.

## Decision

`pas_toolkit` is an OpenCode plugin built from `src/tools/pas-toolkit.ts` into
`dist/platforms/opencode/plugins/` and installed by
`./pas install --target=opencode` into `~/.config/opencode/plugins/`. It exposes
`list`, `check`, `new`, and `archive` over the configured state paths. Its
description marks it as harness-only tooling, not for general use.

## Consequences

- State operations work wherever PAS is installed, without the repo checkout.
- The plugin changes only through the build/install pipeline; `dist/` and the
  installed copy are generated, never edited.
- The Lead is the only role that runs state operations through it.
- Failures return `ERROR:` text instead of throwing, so the Lead can surface
  conflicts deterministically.
