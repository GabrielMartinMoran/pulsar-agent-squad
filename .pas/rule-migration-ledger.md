> Owner: PAS maintainers · Updated: 2026-10-29

# Copiloted agents — rule migration ledger

One-time record of how the 117 normative rules of the retired `pas_developer` and
`pas_qa` prompts were carried into the copiloted pair. It is **not** a living map:
it exists so that "no rule was lost" is a checkable claim rather than an
assertion. Parsed by `tests/unit/prompt-parity.test.ts`; rationale in
`docs/adr/0010-copiloted-engineer-and-copilot.md`.

Sources: `git show <base>:src/agents/pas_developer.md` (61 rules, `D01`–`D61`)
and `git show <base>:src/agents/pas_qa.md` (56 rules, `Q01`–`Q56`).

Destinations: `engineer` (driver prompt `src/agents/pas_engineer.md`) ·
`copilot` (peer prompt `src/agents/pas_copilot.md`) · `protocol` (room code in
`src/tools/pas-toolkit.ts`) · `lead` (orchestrator contract) · `retired` (with a
written reason).

## Rules of `pas_developer` (61)

| id | rule | destination |
|---|---|---|
| D01 | `task: deny` — never delegates | engineer |
| D02 | `question: deny` | engineer |
| D03 | `todowrite: deny` | engineer |
| D04 | `temperature: 0.3` | engineer |
| D05 | step budget | engineer (`steps: 120`) |
| D06 | `edit` denied on `.pas/**` and Gherkin | engineer |
| D07 | `write` denied on `.pas/**` and Gherkin | engineer |
| D08 | one approved atomic task and nothing else | engineer |
| D09 | conservative posture: when in doubt, escalate | engineer |
| D10 | mandatory checklist before any edit | engineer |
| D11 | authorization metadata present and scope defined | engineer |
| D12 | `.pas/state/` artifact loaded and consistent | engineer |
| D13 | global Gherkin contract consistent with the task | engineer |
| D14 | required test commands known and executable | engineer |
| D15 | every assigned skill readable and applicable | engineer |
| D16 | memory: report degraded instead of simulating context | engineer |
| D17 | read every assigned skill before editing | engineer |
| D18 | apply skills, report them, block on a missing critical one | engineer |
| D19 | one atomic task per delegation; never combine neighbours | engineer |
| D20 | Red → Green → Refactor | protocol (red-before-green gate) |
| D21 | edit only approved paths; never the plan or Gherkin | engineer |
| D22 | no architecture calls, no scope expansion, no invented fallback | engineer |
| D23 | escalate uncertainty, scope pressure, denial or failing checks | engineer |
| D24 | report commands, exit codes and real files, not intent | engineer |
| D25 | cheapest sufficient test level | engineer |
| D26 | clearly pyramidal portfolio, no fixed ratio | engineer |
| D27 | domain rules in unit tests | engineer |
| D28 | integration/contract for IO, persistence, wiring | engineer |
| D29 | E2E only for critical journeys or emergent behaviour | engineer |
| D30 | do not turn every Gherkin scenario into an E2E test | engineer |
| D31 | justify the level before adding a costly test | engineer |
| D32 | defect isolable lower ⇒ add the lower-level regression test | engineer |
| D33 | deterministic tests, no fixed sleeps or network | engineer |
| D34 | implement at the tag's level; escalate instead of upgrading | engineer |
| D35 | `@manual` is not automated; follow the procedure | engineer |
| D36 | implement only the approved task and apply contract | engineer |
| D37 | TDD: write the failing test first | engineer |
| D38 | do not delegate; do not modify Gherkin or Lead artifacts | engineer |
| D39 | verify authorization before every edit | engineer |
| D40 | read-only memory; report requested writes to the Lead | engineer |
| D41 | do not modify files outside the approved scope | protocol (scope is a room field and gate) |
| D42 | escalate immediately when the task is ambiguous or expands | engineer |
| D43 | report applied and missing skills | engineer |
| D44 | update `docs/` in the same task, as maps | engineer |
| D45 | record ADRs and supersede instead of rewriting | engineer |
| D46 | `bash` serves the checks, never sidesteps the contract | engineer |
| D47 | batch independent side-effect-free calls | engineer |
| D48 | TDD phases, writes and shared-state checks strictly sequential | engineer |
| D49 | scoped tests after each TDD phase | engineer |
| D50 | full project suite before declaring PASS | **copilot** (declared transfer: `DEFERRED_TO_PEER`) |
| D51 | fix a failure caused by the change before reporting | engineer |
| D52 | run linter/formatter before the final suite | engineer |
| D53 | fix lint/format in files this task touched | engineer |
| D54 | out-of-scope lint: report, never touch | engineer |
| D55 | full `<implementation_report>` contract | engineer (`<verdict>`, 18 elements) |
| D56 | evidence per TDD phase | engineer |
| D57 | result of the suite that was run | engineer (`DEFERRED_TO_PEER`) |
| D58 | `recommendation: CONTINUE \| DO_NOT_CONTINUE` | engineer |
| D59 | when blocked: progress, remainder, evidence, risk, one question | engineer |
| D60 | blocked ⇒ `DO_NOT_CONTINUE` | engineer |
| D61 | never invent a fallback | engineer |

## Rules of `pas_qa` (56)

| id | rule | destination |
|---|---|---|
| Q01 | `edit: deny` | copilot |
| Q02 | `write: deny` | copilot |
| Q03 | `task`/`question`/`todowrite` deny | copilot |
| Q04 | `temperature: 0.1` | copilot |
| Q05 | step budget | copilot (`steps: 100`) |
| Q06 | receives contract, state, Gherkin, diff and developer output; never edits | copilot |
| Q07 | read config and feature state | copilot |
| Q08 | memory: report degraded | copilot |
| Q09 | read and validate assigned skills, with severity | copilot |
| Q10 | missing critical skill ⇒ BLOCKED; non-critical ⇒ warning | copilot |
| Q11 | discover commands, then run suite, linter and formatter | copilot |
| Q12 | independent checks concurrent; shared mutable state in sequence | copilot |
| Q13 | formatter in read-only mode | copilot |
| Q14 | missing tool ⇒ BLOCKED with the exact command | copilot |
| Q15 | required test fails ⇒ FAIL `tests_fail` | copilot |
| Q16 | never PASS from a model claim | copilot |
| Q17 | verify authorization and scope against the real diff | copilot |
| Q18 | every scenario has a test | copilot |
| Q19 | non-trivial functions covered | copilot |
| Q20 | happy and error paths covered | copilot |
| Q21 | edge cases represented | copilot |
| Q22 | cheapest sufficient level per test; portfolio pyramidal | copilot |
| Q23 | verify skill application, linter, drift and scope | copilot |
| Q24 | no linter configured ⇒ WARNING, never an invented PASS | copilot |
| Q25 | use raw output; do not trust a claimed result | protocol (own audit required before a unit closes) |
| Q26 | exactly one verdict | copilot (`<verdict>`) |
| Q27 | verify `docs/` was updated in the same diff and resolves | copilot |
| Q28 | concurrent `bash` for independent checks | copilot |
| Q29 | sequential `bash` for shared mutable state | copilot |
| Q30 | batch read, search and discovery | copilot |
| Q31 | `read` known files, `grep` to search, `glob` to discover | copilot |
| Q32 | no workaround when a required tool is denied | copilot |
| Q33 | read Gherkin from `gherkin.storage_path` with its policy | copilot |
| Q34 | never author or modify `.feature` files | copilot |
| Q35 | no feature files ⇒ drift not applicable | copilot |
| Q36 | review test placement, not only presence | copilot |
| Q37 | could the same risk be tested more cheaply and diagnostically? | copilot |
| Q38 | flag tests heavier or lighter than their tag | copilot |
| Q39 | `@manual` keeps its procedure, no invented test | copilot |
| Q40 | classify the changed tests by level | copilot |
| Q41 | do not demand a unit test when integration is the first capable level | copilot |
| Q42 | propose a cheaper alternative; unjustified cost ⇒ `test_strategy` | copilot |
| Q43 | detect duplicated assertions across levels | copilot |
| Q44 | require an explicit E2E justification | copilot |
| Q45 | review isolation, determinism, sleeps, network, duration, retry | copilot |
| Q46 | portfolio shape: `HEALTHY_PYRAMID`/`TOP_HEAVY`/`INVERTED`/`UNKNOWN` | copilot |
| Q47 | a green expensive test does not excuse the missing lower-level regression | copilot |
| Q48 | full output contract | copilot (`<audit_report>`, 24 elements) |
| Q49 | `fail_category` taxonomy of 12 values | copilot |
| Q50 | objective evidence: commands, files, diff facts | copilot |
| Q51 | separate historical accumulation from this change | copilot |
| Q52 | `orchestrator_action`: none / escalate to user / re-delegate | copilot (`pas_room_escalate`) |
| Q53 | quality-gate summary | copilot |
| Q54 | detect weak/grep-only contract tests | copilot |
| Q55 | severity-tagged findings | copilot |
| Q56 | `recommendation: APPROVE \| REJECT \| NEEDS_REWORK` | copilot |

## Count

| destination | developer | qa | total |
|---|---|---|---|
| `engineer` | 58 | 0 | 58 |
| `copilot` | 1 | 55 | 56 |
| `protocol` | 2 | 1 | 3 |
| `lead` | 0 | 0 | 0 |
| `retired` | 0 | 0 | 0 |
| **total** | **61** | **56** | **117** |

Cross-check: `58 + 56 + 3 = 117`; the columns `58+1+2 = 61` and `0+55+1 = 56`
match the source rule counts.

## Declared removals

Exactly one, authorised by the plan:

- **D50** — *"Before reporting `PASS`, run the full project test suite."* The
  engineer no longer runs the suite: the copilot runs it once before the ack and
  the engineer reports `full_suite_status: DEFERRED_TO_PEER`. The rule did not
  disappear — it changed owner, and a negative pin asserts the engineer has not
  taken it back.

No rule has destination `retired`.

## Renames (recorded, pinned by test)

`<task_status>` → `<verdict>` · `<overall>` → `<verdict>` ·
`<files_actually_changed>` → `<files_changed>` ·
`<skill_application>` → `<skills_applied>` ·
`<code_quality_findings>` → `code_review` + `cruft_review`.

## Note on `same_error`

`same_error` (part of Q49) needs exogenous retry history. The vocabulary survives
in the copilot, but the comparison against a previous attempt belongs to the Lead,
which owns the retry ledger.
