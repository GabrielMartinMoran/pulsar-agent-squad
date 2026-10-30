> Owner: PAS maintainers · Updated: 2026-10-29

# Domain

The PAS domain: the entities the harness tracks, the rules it enforces, and the
vocabulary its contracts use. Behavior contracts live in
`specs/features/product/*.feature`; this doc names and relates them.

## Entities

The harness tracks seven core entities:

| Entity | Definition | Lives in |
|---|---|---|
| Feature state | The lifecycle record of one feature: status, references, and artifacts | `.pas/state/{active,archived}/NNNNN-slug/` |
| Plan | The approved technical approach, tasks, risks, and acceptance strategy | `plan-*.md` in the feature state |
| Delegation | One bounded task handed to the pair or one worker, with authorization, scope, and skills | Plan and delegation brief |
| Room | The shared session store where a delegation's pair runs the step contract | `.pas/rooms/` |
| Unit | One acceptance scenario and the smallest closable piece of a delegation | Room; the Gherkin scenario |
| Gate | A checkpoint where work stops until an explicit condition holds (research, planning, approval, ack) | Lead workflow |
| Checkpoint | A saved session snapshot used to resume work | Memory backend (Mind) |

Feature state artifacts, when applicable: `state.md` and `plan-*.md`. Sources:
`src/agents/Pulsar Agent Squad.md` (State lifecycle and hygiene),
`.pas/state/active/00001-pulsar-agent-squad/state.md`.

## Business rules

Rules the harness enforces regardless of worker or model:

- **Single-use approval.** A source change requires explicit user approval
  scoped to a feature or task set; approval never authorizes later scope
  expansion. Source: `src/agents/Pulsar Agent Squad.md` (Lead invariants).
- **One unit at a time, one writer.** Research may be parallel when disjoint.
  Implementation runs the copiloted pair on one unit at a time; the engineer and
  copilot may run concurrently because the copilot is read-only, so no two
  sessions ever write the tree. Turbo follows the same rule for its background
  tasks. Sources: `specs/features/product/lead-parallel-research.feature`,
  `specs/features/product/copiloted-agents.feature`,
  `specs/features/product/turbo-mode.feature`.
- **Cheapest sufficient test level.** Every behavior is tested at its lightest
  reliable level, and every scenario carries exactly one class tag: `@unit`,
  `@integration`, `@contract`, `@e2e`, or `@manual`. Workers implement and
  verify at that level and escalate instead of upgrading; `@manual` scenarios
  keep a documented manual procedure. Sources:
  `specs/features/product/gherkin-tag-policy.feature`,
  `src/agents/pas_engineer.md` (Test portfolio policy),
  `src/agents/pas_copilot.md` (Test strategy review).
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
| Pulsar Agent Turbo | Optional strong primary; plans, edits and verifies directly, with selective background workers |
| Worker | A lightweight role: `pas_researcher`, `pas_engineer`, or `pas_copilot` |
| Pair | The copiloted implementation unit: a writing engineer and a read-only copilot |
| Unit | One acceptance scenario; the room's closable step |
| Evidence | A recorded command, exit code, and output excerpt proving a claim |
| Finding | A peer observation tagged with category and severity; `blocking` stops closure |
| Reconciliation | The pre-ack round where both reports submit and agree on one file list |
| Gate | A mandatory stop with an explicit exit condition |
| Pin | A verbatim string asserted in tests so a built or installed prompt cannot drift silently |
| Feature state | The numbered state directory and its lifecycle artifacts |
| Checkpoint | A saved snapshot that lets a session resume |
| `memory_writes` | Durable findings a worker requests the Lead to persist; workers never write memory |
| Handoff | A worker's structured output: evidence, status, recommendation |
| Atomic task | One bounded unit of approved work for one worker |

## Domain events

The feature lifecycle, in order: plan created → user approval (single-use) →
implementation by the pair (one unit at a time: red/green evidence → peer audit
→ reconciliation → ack) → Lead adjudication → archive. A failure loops back to
the engineer only within the retry policy; everything else escalates or blocks.
Turbo's direct mode reconciles the same steps in one agent, marking verification
`SELF` or `INDEPENDENT`. Sources: `src/agents/Pulsar Agent Squad.md` (Runtime
workflow), `specs/features/product/copiloted-agents.feature`,
`specs/features/product/lead-parallel-research.feature`,
`specs/features/product/state-hygiene.feature`.
