> Owner: PAS maintainers · Updated: 2026-11-02

# Pairing protocol hardening — implementation reference

**Status:** Implemented, verified, and installed on the OpenCode target. The
full suite is green (54 test files, 832 tests, exit 0); `./pas test`,
`./pas validate`, and `git diff --check` pass; installed prompts and
`pas-toolkit.ts` byte-match `dist/`. Activation requires a new session or a
service restart. Pending: the Phase 7 pilots on the installed version and the
T3 room recovery.
**Scope:** PAS pairing forum, worker roles, prompts, tests, and living docs on
the OpenCode target.
**Out of scope:** Pi runtime parity, the feature 00004 native-host fix, and the
00003 browser-sync delivery work.

This document records the remaining protocol and prompt friction observed in
real sessions, the decisions taken, the intended changes by file, and the
acceptance tests. It is a reference for implementation, not a new runtime
contract. Create the behavior Gherkin during implementation if the project
workflow requires it.

## 1. Evidence

### 1.1 Real delivery session

Session `ses_e643a20fdffepAjif8XMyxJQDJ` (`opencode-notifications`) delivered
feature 00003 and then two external operations. The work succeeded, but the
delegation B needed five generations and the room files grew to hundreds of
kilobytes.

| Attempt | Result | Room messages | Stall candidates |
|---|---|---:|---:|
| A — generation 1 | PASS, 5 topics, 133/133 | — | — |
| B — generation 2 | peer and driver BLOCKED | 1,236 | 1,220 |
| B — generation 3 | 6 topics approved, close failed | 1,323 | 1,293 |
| B — generation 4 | 6 topics approved, close failed | 574 | 549 |
| B — generation 5 | **closed**, 140/140, 18 paths | 506 | 483 |
| Installation — generation 6 | **closed**, 3 topics, 19 files | — | — |
| Companion update — generation 7 | **aborted** by the host | — | — |

Archive sizes ranged from 267 KB to 841 KB. Generation 5 contains 483
`participant_stall_candidate` messages between 11:13:51 and 11:14:39, one every
few milliseconds, all with `reason: "runtime execution failed"`.

### 1.2 What the peer saw in generation 2

- The peer joined and waited about 3.5 minutes.
- The driver opened six topics in the first minute and then ran the project
  suite repeatedly for about four minutes.
- The driver published no `ready_for_review` during that window.
- The peer saw the stall candidates, posted `escalation_candidate`, then
  `escalate`, and returned BLOCKED.
- The driver saw `PAIR_BROKEN`, stopped editing, and returned BLOCKED one minute
  later.

The peer's complaint was factually correct: nothing was ready. The driver had
work in progress; it failed to publish an incremental review. The abort was
premature and the stall candidates made it worse.

### 1.3 Reconciliation failures

- Generation 3: the driver reconciled 2 ZIPs; the peer reconciled 18 paths from
  `pas_pair_room changes`. The final approval failed. The driver later aligned
  to 18 paths; the peer returned without retrying.
- Generation 4: the peer attempted `final_approved` before the driver's
  reconciliation arrived. The error was recoverable; the peer returned without
  retrying.
- Installation generation 6: the driver reconciled before `finish`; `finish`
  deleted the reconciliation; the peer `final_approved` failed; the driver
  reconciled again and the peer closed.
- Companion generation 7: the peer reconciled the eight external
  `~/.local/share/.../chrome-companion/` paths; the driver reconciled `[]`. The
  host cancelled, claiming the room cannot reconcile profile paths. The room's
  `reconcile` accepts absolute paths; the room could have closed if the driver
  aligned to the eight paths.

### 1.4 Solo agents and role confusion

- Two initial researchers were briefed as read-only without shell. They
  produced structured research but could not run `busctl`, `gjs`, `cmp`, `ps`,
  or `/proc` checks.
- The host then used five **solo copilots** for diagnosis. One attempted to join
  the companion room; the copilot prompt is a peer prompt. Their reports were
  `audit_report` verdicts, not `research_report` evidence. Four sequential
  copilots covered one diagnosis.
- The host also resumed the driver alone while the peer was active. That was a
  legitimate recovery (the peer was live), but the prompt currently says
  "never resume one without the other", which is too absolute.

### 1.5 Other observed friction

- The host called `replace` once without `target`; the handler rejected it.
- The host passed `generation` to `restart`; the handler ignores it.
- `expect` accepted an expected participant that was already
  finished/unavailable; the later final approval could not succeed.
- `pas_pair_room status` returns the full room, including hundreds of messages;
  the host parses it repeatedly.
- The peer posted `final_approved` in generation 5 and then returned an
  `audit_report` with `verdict BLOCKED`; the host accepted the closed room.
- The feature was archived before installation was requested; the final report
  did not say "not installed" until the user asked.
- A peer called the legacy `pas_room_reconcile` inside a forum room; the plugin
  rejected it, then the peer used the pair tool.

## 2. Decisions

| Area | Decision |
|---|---|
| Investigator | `pas_researcher` is the default investigator. It receives a **read-only shell** and remains the only research role. |
| Copilot | `pas_copilot` is the peer/auditor. A solo copilot is allowed only for an acceptance audit of a stable artifact, never as a general investigator. |
| Engineer | `pas_engineer` is the writer. It runs only with a live peer. A returned writer may resume alone only while the peer is active. |
| Pairing | A pair room is required for writes to the repository or artifacts that need independent acceptance. |
| Investigation | Read-only investigation uses one researcher per bounded question, with no room and no `expect`. Split only independent questions. |
| External writes | Working decision A: keep the pair room and reconcile the external paths. `authorized_paths: []` means no workspace fingerprint, not no reconciliation. |
| Event lifecycle | Only `session.execution.interrupted` creates a stall candidate. `succeeded` and `failed` are never stop signals. |
| Stall grace | One candidate per role and grace window. A duplicate interruption neither writes another room event nor resets the timer. |
| Reconciliation | `finish` accepts and records the driver's `files`, keeps the submission, and validates it against `changes`. The peer reconciles after the suite. |
| Reconciliation scope | The list is the delegation changeset from the room baseline (`changes`), including prior-generation implementation. External absolute paths are allowed when the brief authorizes them. |
| Final approval | Requires the current driver and peer sessions active, both current reconciliations, all topics approved, no open discussion, and a current fingerprint. |
| Peer discipline | No early return for an active pair with no ready review. A recoverable `final_approved` error is retried after the driver reconciles. |
| Peer verdict | A peer must not post `final_approved` and then return a BLOCKED audit report. The host rejects that combination. |
| Driver discipline | Publish `ready_for_review` per topic as soon as the topic is stable. Open every room scenario before `finish`. Stay until the room closes. |
| Escalation | A participant `escalate` wakes the host with a synthetic message. `escalation_candidate` remains pair-only discussion. |
| Host recovery | Peer unavailable and driver active → replace peer. Driver unavailable and peer active → replace driver. Both unavailable → interrupt both, then restart. |
| Host wake text | `PAIR_BROKEN` aggregates both roles and recommends the exact next call. |
| Status | `pas_pair_room status` returns a compact summary by default. `full: true` returns the transcript. |
| Delivery | The final report states built, installed, and activation-required separately. Installation is not implied by a green suite. |

### 2.1 Researcher shell security

The current `pas_researcher` has `shell: deny` as a hard guarantee. The decision
is to trade that hard guarantee for a **prompt-enforced read-only shell**, the
same trust model the copilot already uses. The researcher keeps `edit: deny`,
`subagent: deny`, `question: deny`, and `todowrite: deny`.

The prompt must require non-mutating commands only: status, diff, log, search,
read, file comparison, process inspection, service introspection, and
read-only test runs. It must stop and report if a command would write, install,
restart, or change the repository or the user's environment. A curated shell
allowlist remains an optional hardening follow-up.

The separate `pas_investigator` alternative is rejected for now because it
duplicates the researcher role and forces the host to choose between two
research agents. Revisit only if the prompt-enforced shell proves too weak.

## 3. Work plan

Implement in this order. Each phase is independently testable.

### Phase 0 — Stop the stall-candidate storm

**Problem:** `execution.failed` events are delivered despite the subscription
type filter. The handler's fallback treats them as a runtime stop.
`applyParticipantLifecycle` writes one candidate per event, overwrites the
pending reason, and resets the timer. The room and status grow without bound.

**Changes:**

- `src/tools/pas-toolkit.ts` lifecycle subscription: after handling
  `started`, ignore every event whose type is not
  `session.execution.interrupted`.
- `applyParticipantLifecycle` in the forum path: if a pending stall already
  exists for the role and session, return without writing a message or
  changing the pending `since`.
- `scheduleStallWake`: schedule only when a new candidate is created; never
  clear and reschedule an existing timer.
- Insert at most one `participant_stall_candidate` room event per candidate, or
  keep the candidate only in `forum.pending_stalls` and rely on the synthetic
  host wake. The status summary must not expose a message storm.
- `promoteParticipantStall` remains idempotent.

**Tests (`tests/unit/pair-forum.test.ts` and
`tests/unit/participant-lifecycle.test.ts`):**

- A burst of `execution.failed` events produces zero candidates, zero
  `PAIR_BROKEN`, and no room growth.
- One `execution.interrupted` produces one candidate; a second interruption
  within the grace does not duplicate it or extend the grace.
- A `started` before the grace clears the candidate and cancels the wake.
- After the grace, one `PAIR_BROKEN` is sent to the host; a second interruption
  does not send another.
- The room file size stays bounded during a simulated burst.

**Acceptance:** the storm scenario from the real session no longer creates
hundreds of messages; the peer sees an active pair and no false `PAIR_BROKEN`.

### Phase 1 — Make reconciliation and close deterministic

**Problem:** `finish` deletes prior reconciliations; agents reconcile before
`finish` and lose the submission. The driver and peer disagree on the list
(2 ZIPs versus the 18-path delegation changeset). A recoverable final-approval
error causes an early return.

**Changes:**

- `src/tools/pas-toolkit.ts`:
  - `forumRequestFinish` accepts `files?: string[]`. Normalize and record the
    driver's reconciliation in `room.reconciliation.submissions.driver` with
    the current session. Do not delete the reconciliation.
  - Validate the driver's list against `forumChanges(root, roomId)` when
    `authorized_paths` is non-empty. If it differs, reject with the expected
    list or a clear diff.
  - Keep the peer's submission only if it is current; otherwise require the
    peer to reconcile after `finish`. The final approval still compares the two
    current submissions.
  - `reconcileFiles` documents and accepts external absolute paths. It does not
    require the paths to be inside `authorized_paths`.
  - `final_approved` keeps the current-session, both-active, both-reconciled
    checks. Its error for a missing or stale driver submission names
    `finish files` or `reconcile` as the fix.
- `src/agents/pas_engineer.md`: `finish` includes `files` from
  `pas_pair_room changes`; the list is the delegation changeset, not only the
  files touched in the current generation.
- `src/agents/pas_copilot.md`: after `finish`, run the final suite, reconcile
  the same paths, and retry `final_approved` after a recoverable reconciliation
  error. Do not return with the work complete.
- The host brief for a restart over an existing implementation says the
  reconciliation includes the prior-generation implementation; the room
  baseline is preserved across generations.

**Tests:**

- `finish` with `files` records the driver submission and keeps it.
- `finish` without `files` and without a driver submission rejects with a clear
  instruction, or records the `changes` list if the chosen API defaults to it.
- `final_approved` succeeds after the peer reconciles; it rejects a stale or
  missing driver submission.
- A driver list that differs from `changes` rejects with the expected list.
- An external path list (absolute paths outside the workspace) reconciles when
  both participants submit the same set.
- The peer retry scenario: first `final_approved` fails, driver reconciles,
  second succeeds.

**Acceptance:** generation 3/4-style reconciliation mismatches are resolved
without a new generation; the installation and companion-update rooms close
when both lists align.

### Phase 2 — Make the researcher the investigator

**Problem:** the researcher has `shell: deny`; command-based diagnosis is routed
to solo copilots. The copilot prompt is a peer prompt; one attempted a room join
and its reports were audit verdicts. The host needed several agents for one
diagnosis.

**Changes:**

- `src/agents/pas_researcher.md`:
  - Frontmatter: allow `shell`, keep `edit`, `subagent`, `question`, and
    `todowrite` denied.
  - Description and body: read-only shell for evidence; non-mutating commands
    only; no edits, installs, restarts, or environment mutations; record the
    command, exit code, and output; stop if a command would write.
  - Keep the structured `<research_report>`. Use the existing
    `repository_sources`/`facts`/`sources_consulted` fields for commands and
    outputs.
  - Add a short command policy table to the prompt (read-only examples and
    forbidden categories).
- `src/agents/Pulsar Agent Squad.md`:
  - Runtime permissions: file reads and command-based investigation route to
    `pas_researcher` (read-only shell); writes route to the engineer/copilot
    pair; acceptance audits route to the copilot peer.
  - Remove "the researcher has no shell; route command-dependent evidence to
    the engineer/copilot pair".
  - Add a `### Solo read-only work` subsection: one researcher per bounded
    question; no room, no `expect`, no `pas_pair_*`; the brief says solo.
  - Add a solo-researcher few-shot: diagnose a runtime/bridge issue with
    commands; return a research report; no room.
- `src/agents/Pulsar Agent Turbo.md`: same rules, compact.
- `src/agents/pas_copilot.md`: a solo copilot is only for an acceptance audit
  of a stable artifact; its brief says solo, no room, no join. A copilot in a
  pair remains the peer.

**Tests:**

- `tests/unit/complexity-routing.test.ts`: researcher keeps `edit: deny`, now
  allows shell, and the prompt contains the read-only command policy.
- A prompt-parity or new test asserts the host routes command-based
  investigation to the researcher and no longer says "no shell".
- The researcher prompt contains the report fields and the command policy.

**Acceptance:** one researcher can diagnose the D-Bus/native-host issue with
`busctl`, `ps`, `cmp`, `gjs`, and `/proc` checks, without a room and without
editing. A solo copilot is not used for investigation.

### Phase 3 — Fix worker close discipline

**Problem:** the generation 2 driver held all six topics until the end and
published no review; the peer escalated and returned. The generation 3/4 peer
returned on recoverable final-approval errors. The generation 5 peer returned a
BLOCKED report after `final_approved`.

**Changes:**

- `src/agents/pas_engineer.md`:
  - Open one topic per room scenario before requesting review or `finish`.
  - Publish `ready_for_review` per topic as soon as that topic is stable; do not
    wait for all topics or the full suite before the first review.
  - After `finish` with `files`, reconcile, then wait for `final_approved`.
    Do not return before the room closes.
  - In a stalled room, skip `escalation_candidate` and escalate; a candidate
    cannot be discussed with an unavailable partner.
- `src/agents/pas_copilot.md`:
  - A quiet active pair with no ready review is not a blocker. Keep waiting
    with the feed cursor through ordinary timeouts.
  - On a recoverable `final_approved` error (missing reconciliation, stale
    revision, fingerprint), post the exact error, wait for the driver to
    reconcile, and retry. Do not return.
  - Do not post `final_approved` if the audit report will be BLOCKED. The
    final approval and the report are the same verdict.
  - In a pair, use the pair topic tools; in a solo audit, no room and no join.
- `src/agents/Pulsar Agent Squad.md`:
  - Adjudication rejects a closed room whose peer report is BLOCKED; reopen,
    replace, or report partial.
  - Add a few-shot for "peer has no ready review yet" (wait, do not escalate)
    and "peer report BLOCKED versus closed room" (do not accept).

**Tests:**

- Prompt tests assert the incremental ready, the no-early-return rule, the
  final-approval retry, and the report/verdict consistency.
- The room tool tests cover the recoverable reconciliation error; the prompt
  test covers the expected response.

**Acceptance:** a peer in an active pair waits for the first ready review; a
peer retries after a reconciliation error; the host does not accept a BLOCKED
peer report over a closed room.

### Phase 4 — Wake the host and make recovery explicit

**Problem:** a peer escalation did not wake the host; the peer returned before
the host reacted. Both-gone recovery used `replace` on one participant; the
final approval could not succeed. `replace` and `restart` field usage was
ambiguous.

**Changes:**

- `src/tools/pas-toolkit.ts`:
  - On a participant `escalate` post, send one synthetic host wake with the
    topic, category, session, generation, and post id. Do not wake on
    `escalation_candidate`.
  - `PAIR_BROKEN` wake text aggregates both roles and recommends the exact next
    call:
    - peer unavailable and driver active → `replace peer`;
    - driver unavailable and peer active → `replace driver`;
    - both unavailable → `interrupt target: both`, then `restart`.
  - `expectForumPair` rejects an expected participant whose current activity is
    `finished` or `unavailable` with "replace or restart before binding".
  - `replace` infers `target` from the current member when
    `participant_session` is supplied and `target` is omitted.
  - `restart` validates the supplied `generation` as the current generation.
  - `report_completion` keeps the closing guard; the host reports only after
    closure.
- `src/agents/Pulsar Agent Squad.md`:
  - Add a recovery decision table and exact calls.
  - Add few-shots for both-gone, one-gone, escalation, and reconciliation
    mismatch.
  - Allow a single returned participant to resume only while the other is
    active; never a lone writer.

**Tests:**

- `escalate` sends one synthetic; `escalation_candidate` does not.
- `expect` rejects finished/unavailable expected participants.
- `replace` infers the target; `restart` rejects a stale generation.
- `PAIR_BROKEN` text includes the recommendation and the exact fields.
- The host prompt tests assert the decision table and the few-shots.

**Acceptance:** a peer escalation wakes the host before the peer gives up; a
both-gone room is restarted, not half-replaced; the host's recovery calls are
accepted on the first attempt.

### Phase 5 — Bound status and mutation output

**Problem:** `status` returns the full room; the host calls it repeatedly. Room
files are 267–841 KB and 500–1,300 messages. Mutation outputs also return the
whole room to workers.

**Changes:**

- `src/tools/pas-toolkit.ts`:
  - `pas_pair_room status` summary by default: id, status, generation, goal,
    scope, authorized paths, members, activities, phase, pair, topics,
    `final_requested`, reconciliation, `post_count`, last five posts,
    `message_count`, last five internal events.
  - `full: true` returns the complete transcript.
  - `finish`, `reconcile`, `report_completion`, `replace`, and `restart`
    return a compact ack with status, phase, topics, pair, and reconciliation.
  - Keep `pas_pair_topic read all: true` as the full history.
- `docs/architecture.md`: document the summary/full distinction.

**Tests:**

- A room with many internal events returns a small status payload.
- The summary includes the last `final_approved`/topics needed by the host.
- `full: true` returns the full room.
- Mutation outputs are compact and still actionable.

**Acceptance:** the host can adjudicate a long room without injecting the full
transcript into its context.

### Phase 6 — Prompt hygiene and delivery state

**Problem:** legacy `pas_room_*` names remain in worker bodies; a peer tried
`pas_room_reconcile`. `reconcile` and `finish` fields are ambiguous.
`final_approved` was posted on a non-existent topic. The delivery report did not
state that the feature was not installed.

**Changes:**

- `src/agents/pas_copilot.md` and `src/agents/pas_engineer.md`: move the legacy
  protocol to a short appendix or remove it from the main body. Keep the pinned
  names required by tests, but state clearly that `pas_room_*` is rejected in a
  forum. The forum block remains the operational workflow.
- Document `reconcile files` versus `finish summary`/`files`; `final_approved`
  must use a real topic; `escalation_candidate` is not valid in a stalled room.
- `src/agents/Pulsar Agent Squad.md`: the final delivery report separates
  built, packaged, installed, and activation-required. If installation is out
  of scope, say so and give the command; do not imply usability from a green
  suite.
- `README.md` and `docs/architecture.md`: update the role matrix, the
  researcher read-only shell, the external-path reconciliation, and the solo
  modes.

**Tests:**

- Prompt tests assert the legacy appendix/no-room rule and the delivery-state
  wording.
- A docs-integrity test covers the new headings and links.

**Acceptance:** a worker in a forum room never calls a legacy tool successfully;
a delivery report does not omit a required installation step.

### Phase 7 — Pilots and rollout

**Pilots (required before calling the work complete):**

1. A one-shot pair over a small repository change: expect, incremental ready,
   finish with files, peer suite, reconcile, final approval.
2. A restart over a previous-generation tree: the 18-path delegation changeset;
   the peer approves and retries after a reconciliation error.
3. A simulated `execution.failed` burst: no candidates, no false `PAIR_BROKEN`,
   no room growth.
4. A researcher-only diagnosis with shell: no room, no join, one bounded
   question, evidence in the research report.
5. A solo copilot audit of a stable artifact: no room, no join, audit report.
6. An external update with eight profile paths: both reconcile the same paths,
   the room closes, no false cancel.
7. An escalation: the peer escalates, the host wakes, resolves, and the pair
   continues.
8. A real interruption: kill one participant mid-suite; one candidate after the
   grace; the host wakes; the other participant stops; recovery is explicit.

**Rollout:**

- `bun run test`
- `./pas test`
- `./pas validate`
- `git diff --check`
- `./pas install --target=opencode`
- Verify the installed prompts and `pas-toolkit.ts` byte-match `dist/`.
- Restart the OpenCode service or open a new session so the plugin code and
  prompts reload.
- Re-run the pilots on the installed version, not only the local plugin.

## 4. File impact

| File | Changes |
|---|---|
| `src/tools/pas-toolkit.ts` | Event filtering/dedupe; `finish files`; reconciliation semantics; external paths; status summary; compact mutation outputs; escalate wake; `expect` terminal check; `replace` target inference; `restart` generation guard. |
| `src/agents/pas_researcher.md` | Read-only shell permission and policy; investigator role; command evidence in the report. |
| `src/agents/pas_engineer.md` | Incremental ready; all topics before finish; `finish files`; wait for final approval; stalled-room escalation. |
| `src/agents/pas_copilot.md` | Peer patience; final-approval retry; report/verdict consistency; solo audit mode without a room; legacy appendix. |
| `src/agents/Pulsar Agent Squad.md` | Role matrix; researcher shell routing; solo read-only; recovery decision table; few-shots; delivery state; status summary. |
| `src/agents/Pulsar Agent Turbo.md` | Same role/recovery/forum rules, compact. |
| `docs/architecture.md` | Presence, reconciliation, external paths, status summary, role matrix. |
| `docs/domain.md` | Researcher investigator, solo audit, external effects, stall candidate. |
| `README.md` | Role/pairing/installation summary. |
| `tests/unit/pair-forum.test.ts` | Storm, finish files, reconciliation, external paths, status summary, expect/replace/restart, escalate wake. |
| `tests/unit/participant-lifecycle.test.ts` | Event burst, candidate dedupe, timer, wake. |
| `tests/unit/complexity-routing.test.ts` | Researcher shell permission and read-only policy. |
| `tests/unit/room-admin-prompts.test.ts` | Few-shots, decision table, delivery state. |
| `tests/unit/prompt-parity.test.ts` | Researcher/worker prompt changes; legacy appendix. |
| `tests/integration/build.test.ts` | Built prompt content for the new rules. |

## 5. Implementation record (2026-11-02)

All phases landed in the working tree. Deviations and decisions taken during
implementation:

- **Phases 0–5** implemented as planned. `applyParticipantLifecycle` now returns
  whether it created a stall candidate; only that return schedules the single
  grace timer, so duplicate `execution.interrupted` events neither extend the
  grace nor add room events. `execution.failed` and `execution.succeeded` are
  ignored by the lifecycle.
- **`finish` files** are validated against the delegation changeset and the
  driver's submission is retained; a peer submission from before `finish` is
  cleared so the peer reconciles after the final suite. Empty `files: []` is a
  valid explicit reconciliation; omitting `files` is not.
- **`expect`** rejects a participant already marked unavailable or finished;
  **`replace`** infers the role from `participant_session`; **`restart`** rejects
  a stale `generation`. All three cases are covered in
  `tests/unit/pair-forum.test.ts`.
- **Escalations** wake the host once per post id (`forum.notified_escalations`);
  repeated posts do not re-wake.
- **Phase 6** took the cheap path: the legacy protocol stays, but both worker
  prompts state that any `pas_room_*` step applies only to a room without a
  `forum`, and the forum section is the complete workflow. The engineer's close
  and correction path was rewritten forum-first. A full deletion of the legacy
  appendix remains optional.
- **`docs/architecture.md`** describes the researcher shell as non-mutating and
  the reconciliation as changeset-based, including external absolute paths.
- The `build.test.ts` assertion that pinned "no shell" for the researcher was
  updated to the new read-only-shell contract; it was the only integration
  failure after the prompts changed.

### Phase 8 — post-install review (2026-11-02)

The real session `ses_e643a20fdffepAjif8XMyxJQDJ` kept working after the
install. Generations 8–10 confirm the event fix in production: zero
`participant_stall_candidate` entries, versus 804 in generation 7 and 1,651 in
generation 1; room size dropped from 860 KB to 12–79 KB. Escalation wakes
(10:45, 11:06, 11:16) and the final close with reconciliation worked.

The same session exposed four gaps, now addressed:

- **An aborted room blocked the session.** `create` rejected it, `cancel`
  rejected it as already aborted, and `restart` preserved the old `goal` and
  `scope`; the host reused the wrong room and closed it with the old acceptance
  scope. `create` now archives an aborted room and opens the next generation
  with the supplied goal, scope, and paths. A closed room still requires both
  participants to be confirmed finished.
- **A returned participant left its partner waiting.** The driver returned at
  10:12; the peer waited until 10:21 and returned `BLOCKED`. Report completion
  now sends one `PARTNER_FINISHED` wake to the live partner with the pending
  close items, and returns `incomplete_return` with the exact pending list.
- **Prompt reload was not observable.** The plugin reloaded on the running
  runtime, but prompts are read at session/service start; the session still used
  the old guidance (solo copilots for diagnosis, early peer returns).
  `docs/architecture.md` now states the restart requirement.
- **Investigation routing.** The host prompt has an explicit routing rule and
  the copilot refuses investigation briefs without a room, pointing to
  `pas_researcher`.

## 6. Decisions taken and remaining items

1. **External writes — decided.** Decision A is implemented: the pair room
   keeps external paths in `reconcile`, and `authorized_paths: []` only disables
   the workspace fingerprint. Alternative B (writer+verifier handoff without a
   room) is rejected because it loses the room's joint close.
2. **Researcher shell policy — decided.** `shell: allow` with a strict
   non-mutating prompt, documented as a table of allowed inspections. A curated
   command allowlist remains an optional hardening follow-up.
3. **Solo copilot audit — decided.** Kept for stable-artifact acceptance audits
   only. Solo copilot investigation is forbidden; that work goes to the
   researcher.
4. **Feature 00004 — out of scope.** The native-host bus fix is a code change
   and should use the pair. It can proceed in another session, but it runs
   against the installed plugin, which does not yet include this hardening.
5. **T3 open room — remaining.** Session `ses_e68ca00adffeNLS5UqvyicaiyD` still
   has a generation 3 room with four approved topics and no `finish`. Recover it
   (resume peer and driver with the corrected order) or cancel/restart it. Do
   not create a new generation while it is open.
6. **Rollout — remaining.** Install on the OpenCode target and run the Phase 7
   pilots against the installed version.

## 7. Definition of done

- Phase 0/1 tests pass and a simulated storm creates no room growth.
- The researcher runs a command-based diagnosis solo without a room and
  without editing.
- A pair closes after a reconciliation mismatch without a new generation.
- A peer waits through an ordinary quiet period and retries a recoverable final
  approval.
- The host is woken by `escalate` and by `PAIR_BROKEN`, with a correct recovery
  recommendation.
- `status` and mutation outputs are bounded.
- The prompts and docs state the role matrix and the delivery state.
- An aborted room can be replaced by a new room with a new goal and scope.
- A participant that returns early wakes its partner once with the pending
  close items, and the host receives `incomplete_return`.
- Read-only investigation never goes to a solo copilot.
- `bun run test`, `./pas test`, `./pas validate`, `git diff --check`, install,
  and the installed-version pilots pass.
