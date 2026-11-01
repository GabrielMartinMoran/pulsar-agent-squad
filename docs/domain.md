> Owner: PAS maintainers · Updated: 2026-11-01

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
| Delegation | One bounded task handed to a worker; pair briefs use a versioned XML input contract with approval references, scope, constraints, and skills | Plan and `<delegation_contract>` brief |
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
- **Bounded implementation autonomy.** Approved behavior, included/excluded
  responsibilities, and hard constraints govern the task. Forecast files are
  advisory; directly necessary in-area helpers, wiring, tests, and local
  refactoring do not require renewed approval. Explicit protected paths remain
  binding. Sources: `src/agents/Pulsar Agent Squad.md` (Delegation input
  contract), `src/agents/pas_engineer.md` (Pre-flight),
  `docs/adr/0011-bounded-delegation-contract.md`.
- **Related units, one writer.** Research may be parallel when disjoint.
  The pair may keep related units open together; the engineer and
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
  only for the retryable categories. The Lead adjudicates other failures;
  user decisions are required for changes beyond approved behavior or authority,
  not every implementation deviation. Source:
  `src/agents/Pulsar Agent Squad.md` (Retry and escalation).
- **Continued pairing.** Pending partner work and update-wait timeouts are not
  blockers. Each unit closes only after an executable peer audit of current
  review point, without requiring RED or driver TDD history. Final verification
  follows the driver's stable-tree
  announcement; corrections reopen the affected unit and require fresh review.
  Sources: `src/agents/pas_engineer.md`, `src/agents/pas_copilot.md`,
  `specs/features/product/pairing-coordination.feature`.
- **Correction rounds.** Up to three distinct reviewable implementation
  review points with blocking findings per unit. A review point can be an
  open/reopen event or driver check evidence; it need not be a TDD cycle.
  Repeated findings against the same review point count once; ordinary
  discussion does not consume a
  round. Verified peer rechecks may resolve existing finding IDs. Source:
  `src/tools/pas-toolkit.ts` (`correctionRoundsUsed`, `auditUnit`).
- **Participant lifecycle.** Room membership does not prove a participant is
  executing. Only the host records a returned child as finished, after its
  actual result; per-step execution events and idle timestamps are not
  completion. Finished/unavailable peers need host recovery; room messages do
  not resume sessions. Active mutual waiting elects the next actor instead of
  escalating automatically. Source: `src/tools/pas-toolkit.ts` (participant
  activity and lifecycle tracking).
- **Killswitch.** Only the host may abort the pair and request runtime
  interruption of current driver/peer IDs. No rollback or deletion occurs.
  Per-session failures/timeouts remain unconfirmed and prevent replacement
  after a stop request. Source: `src/tools/pas-toolkit.ts` (`stopRoom`,
  `resetRoom`), `docs/adr/0014-participant-lifecycle-and-killswitch.md`.

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
| Delegation contract | XML operating agreement for one approved pair task; references persistent state rather than replacing it |
| Implementation hint | Advisory approach or forecast file, not an editable-file allowlist |
| Hard constraint | An explicit limit that neither implementation adaptation nor peer agreement can override |
| Update cursor | Opaque room snapshot token that ignores read receipts; reused across waits to detect updates between calls |
| Final readiness | Driver announcement that all units are reviewed/closed and the tree is stable for the peer's global verification |
| Participant activity | Declared working or waiting state, with the response being awaited |
| Participant availability | Active, finished or unavailable execution, distinct from room membership and acceptance verdict |
| Forum topic | A discussion and review thread covering one or more scenarios, with a revision and an independent approval |
| Escalation candidate | A proposed escalation the pair can discuss and resolve before involving the host |
| Mutual wait | Active pair members waiting on each other; the next protocol actor must act or clarify |
| Killswitch | Host request to abort the pair and interrupt selected current executions with explicit results |

## Domain events

The feature lifecycle, in order: plan created → user approval (single-use) →
implementation or verification by the pair (per-unit peer audit
→ reconciliation → ack) → Lead adjudication → archive. A failure loops back to
  the engineer only within the retry policy; other failures require Lead
  adjudication, with user escalation when resolution exceeds authority.
Turbo's direct mode reconciles the same steps in one agent, marking verification
`SELF` or `INDEPENDENT`. Sources: `src/agents/Pulsar Agent Squad.md` (Runtime
workflow), `specs/features/product/copiloted-agents.feature`,
`specs/features/product/lead-parallel-research.feature`,
`specs/features/product/state-hygiene.feature`.
