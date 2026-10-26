> Owner: PAS maintainers · Updated: 2026-10-26

# Domain

The PAS domain: the entities the harness tracks, the rules it enforces, and the
vocabulary its contracts use. Behavior contracts live in
`specs/features/product/*.feature`; this doc names and relates them.

## Entities

The harness tracks five core entities:

| Entity | Definition | Lives in |
|---|---|---|
| Feature state | The lifecycle record of one feature: status, references, and artifacts | `.pas/state/{active,archived}/NNNNN-slug/` |
| Plan | The approved technical approach, tasks, risks, and acceptance strategy | `plan-*.md` in the feature state |
| Delegation | One bounded task handed to one worker, with authorization, scope, and skills | Plan and delegation prompt |
| Gate | A checkpoint where work stops until an explicit condition holds (research, planning, approval, QA) | Lead workflow |
| Checkpoint | A saved session snapshot used to resume work | Memory backend (Mind) |

Feature state artifacts, when applicable: `state.md` and `plan-*.md`. Sources:
`src/agents/Pulsar Agent Squad.md` (State lifecycle and hygiene),
`.pas/state/active/00001-pulsar-agent-squad/state.md`.

## Business rules

Rules the harness enforces regardless of worker or model:

- **Single-use approval.** A source change requires explicit user approval
  scoped to a feature or task set; approval never authorizes later scope
  expansion. Source: `src/agents/Pulsar Agent Squad.md` (Lead invariants).
- **Sequential development and QA.** Research may be parallel when disjoint;
  developer and QA work must not race over a changing tree, even in Turbo's
  background tasks. Sources:
  `specs/features/product/lead-parallel-research.feature`,
  `specs/features/product/turbo-mode.feature`.
- **Cheapest sufficient test level.** Every behavior is tested at its lightest
  reliable level, and every scenario carries exactly one class tag: `@unit`,
  `@integration`, `@contract`, `@e2e`, or `@manual`. Workers implement and
  verify at that level and escalate instead of upgrading; `@manual` scenarios
  keep a documented manual procedure. Sources:
  `specs/features/product/gherkin-tag-policy.feature`,
  `src/agents/pas_developer.md` (Test portfolio policy),
  `src/agents/pas_qa.md` (Test strategy review).
- **State hygiene.** Active holds only in-flight features; archiving moves the
  complete directory and never renumbers or deletes; conflicts block instead of
  guessing. Source: `specs/features/product/state-hygiene.feature`.
- **Bounded retries.** At most two automatic retries per failure category, and
  only for the retryable categories; everything else escalates. Source:
  `src/agents/Pulsar Agent Squad.md` (Retry and escalation).

## Ubiquitous language

One term per concept; the contracts use these names:

| Term | Meaning |
|---|---|
| PAS Lead | Original strong primary; plans/adjudicates and delegates source changes; never edits source |
| Pulsar Turbo | Optional strong primary; plans, edits and verifies directly, with selective background workers |
| Worker | A lightweight role: `pas_researcher`, `pas_developer`, or `pas_qa` |
| Gate | A mandatory stop with an explicit exit condition |
| Pin | A verbatim string asserted in tests so a built or installed prompt cannot drift silently |
| Feature state | The numbered state directory and its lifecycle artifacts |
| Checkpoint | A saved snapshot that lets a session resume |
| `memory_writes` | Durable findings a worker requests the Lead to persist; workers never write memory |
| Handoff | A worker's structured output: evidence, status, recommendation |
| Atomic task | One bounded unit of approved work for one worker |

## Domain events

The feature lifecycle, in order: plan created → user approval (single-use) →
implementation (direct or one delegated atomic task at a time) → QA verdict
(PASS, FAIL, BLOCKED; SELF or INDEPENDENT) → primary adjudication → archive. Retries loop back to the developer only within
the retry policy; everything else escalates or blocks. Sources:
`src/agents/Pulsar Agent Squad.md` (Runtime workflow),
`specs/features/product/lead-parallel-research.feature`,
`specs/features/product/state-hygiene.feature`.
