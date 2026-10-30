> Owner: PAS maintainers · Updated: 2026-10-29

# ADR 0010: Copiloted engineer and read-only copilot

**Status:** Accepted

## Context

PAS delegated implementation to a developer worker and verification to a
separate read-only QA worker. That kept the writer and the verifier in different
sessions, but verification was a terminal phase: a whole delegation could finish
before anyone re-executed its claims. Turbo already merged both disciplines into
one prompt and had to simulate a second reviewer (`QA loop (mandatory even when
SELF)`), so the merged agent never had real independence from its own report.

A POC in `~/flux_it/iadev/pocs/copiloted-agents` explored a pairing room with an
engineer and a peer. Its evidence is **weak**: three and one runs (`n=3` / `n=1`)
with a single same-family judge, and its own write-up inverts one anecdote. This
ADR therefore does **not** claim a measured quality improvement. It adopts the
*mechanism* — a runtime-enforced read-only peer and a closure gate — and leaves
quality to a pilot.

## Decision

Replace the previous developer + QA pair on OpenCode with a **copiloted
pair**:

- `pas_engineer` — driver, `temperature: 0.3`, writes source, self-verifies each
  unit, never edits `.pas/**` or Gherkin, cannot delegate or parallelize `bash`.
- `pas_copilot` — peer, `temperature: 0.1`, `edit: deny`, `write: deny`,
  `bash: allow`; audits by re-executing, and returns the terminal ack.

The Lead writes both briefs and hosts the room; the unit is one acceptance
scenario. The step contract is **code** in `src/tools/pas-toolkit.ts`, not prose:
red before green, evidence with command/exit code/output, a peer audit with its
own command, a green full-suite audit before the ack, and a reconciliation round
over the changed-file list.

Two agents are required, not one merged prompt. The inventory found nine
irreconcilable tensions:

1. **Objectivity vs authorship.** A verifier must judge work it did not author;
   the writer cannot be the court of its own work.
2. **Must-edit vs must-never-edit.** The engineer's job is to change the tree;
   the copilot's is to never change it.
3. **Read-write vs read-only formatter.** The engineer may format; the copilot
   may only validate in read-only mode.
4. **Choose the test level vs audit the choice.** The engineer picks the cheapest
   sufficient level; the copilot judges whether that choice was sufficient.
5. **Two verdict vocabularies.** Six XML elements collided with incompatible
   grammars (`levels_used`, `cheapest_sufficient_level`,
   `lower_level_alternative`, `duplication`, `e2e_justification`,
   `test_strategy_review`); one prompt cannot carry both shapes.
6. **Dialogic vs terminal escalation.** The engineer converses inside the task;
   the copilot escalates to the host and ends its turn instead of polling.
7. **Temperature 0.3 vs 0.1.** Generative coding and conservative auditing want
   different sampling profiles.
8. **`same_error` needs exogenous history.** Only the Lead sees retries across
   delegations; neither worker can own that check.
9. **Asymmetric concurrent-`bash` licence.** The copilot may run independent
   shells concurrently; the engineer writes the tree and must serialize.

The decisive one is the second clause of QA's rule: *"Do not trust a claimed
result."* Applied to your own report, it is empty — the author always has a
reason to believe the result. Only a peer that re-executes can apply it.

Pi is left untouched on purpose: `src/agents/pi/` keeps `pas_researcher`,
`pas_developer`, and `pas_qa`. The OpenCode roster and the Pi roster are
asymmetric, and docs say so explicitly.

This ADR **supersedes nothing**. It extends ADR 0005 (Turbo) rather than
replacing it: Turbo remains a selectable primary, now with the same pair as
optional workers, and its self-verification is still marked `SELF`.

## Consequences

- The engineer loses the machine-enforced independence QA had: the same model
  family may still share biases with its peer. Independence comes from structure
  (a Lead-written brief, a runtime read-only peer, re-execution), not from a
  different model.
- The copilot concentrates the full-suite verdict in one session. The room
  requires the exact command, exit code, and output, and the Lead can re-run it
  from the transcript.
- The protocol is code and therefore testable; the two prompts are v1 and are
  expected to be wrong in ways only a pilot reveals.
- The pair costs more turns than one agent. The plan bounds deployments at six
  units and gives the prompts static step budgets.
- Pi keeps the previous developer + QA roster, so the two runtimes are not
  feature-identical on purpose.
- The git working-tree delta the Lead captures is a hint, not a gate; the real
  gate is the pair's reconciliation.

## Sources

- `src/agents/pas_engineer.md`
- `src/agents/pas_copilot.md`
- `src/agents/Pulsar Agent Squad.md`
- `src/tools/pas-toolkit.ts`
- `specs/features/product/copiloted-agents.feature`
- `tests/unit/pas-room.test.ts`
- `tests/unit/prompt-parity.test.ts`
- `.pas/rule-migration-ledger.md` — canonical rule-migration ledger, parsed by `tests/unit/prompt-parity.test.ts`
- `docs/adr/0005-optional-autonomous-turbo-lead.md`
- POC: `~/flux_it/iadev/pocs/copiloted-agents` (weak evidence: n=3 / n=1)
