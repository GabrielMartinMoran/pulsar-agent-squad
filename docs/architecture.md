> Owner: PAS maintainers · Updated: 2026-11-01

# Architecture

Pulsar Agent Squad (PAS) is a cost-efficient, contract-driven engineering
harness: one strong model runs the control plane and delegates bounded work to
lightweight workers. This doc is a map — it points to the sources instead of
restating them.

## What PAS is

PAS keeps engineering discipline while reserving strong-model reasoning for the
decisions that need it. The Lead plans, approves, and adjudicates; light workers
research, implement, and verify under closed contracts. Sources:
`docs/product.md` (product view), `specs/features/product/*.feature`
(behavior).

## Execution model

The primary runtime is OpenCode; Pi is a supported second runtime target
(`docs/adr/0006-pi-runtime-target.md`). The roster contains two selectable
primary modes and three shared workers, each with its own prompt and permission
profile under `src/agents/` (OpenCode) or `src/agents/pi/` (Pi). The copiloted
pair — `pas_engineer` and `pas_copilot` — is the implementation unit: one
delegation spawns both, and the Lead adjudicates their reconciled report. Turbo
changes execution ownership, not the worker roster or state/approval contracts.

| Agent | Model | Role | Prompt |
|---|---|---|---|
| PAS Lead | strong | Original control plane: plan, approve, adjudicate, persist | `src/agents/Pulsar Agent Squad.md` |
| Pulsar Agent Turbo | strong | Optional primary: direct research/implementation/QA; selective background workers | `src/agents/Pulsar Agent Turbo.md` |
| `pas_researcher` | light | Read-only evidence worker | `src/agents/pas_researcher.md` |
| `pas_engineer` | light | Driver of the copiloted pair: bounded TDD, self-verifies every unit | `src/agents/pas_engineer.md` |
| `pas_copilot` | light | Read-only peer: audits by re-executing, reviews code, skills and UI/UX | `src/agents/pas_copilot.md` |

On OpenCode, permissions are per role and enforced by the runtime, not by
prompt text: the original Lead reads `.pas/**`, `specs/**/*.feature`, and
`docs/**`, and edits only PAS artifacts. Turbo can read/execute/edit source and
owns the same PAS artifacts, subject to single-use approval. The engineer writes
source but never `.pas/**` or Gherkin; the copilot is read-only with shell, so it
can re-execute checks without ever editing the tree; the researcher is read-only
without shell. The exact profiles are the frontmatter of each prompt; the Lead
contract is `## Runtime permissions and capabilities`. Sources:
`specs/features/product/lead-runtime-permissions.feature`,
`specs/features/product/worker-internal-parallelism.feature`,
`specs/features/product/turbo-mode.feature`.

Pi caveat: Pi exposes tool allowlists but no path-scoped denies, so the same role
boundaries are a soft, contractual boundary — prompt text plus QA audit, not a
runtime denial. See `docs/adr/0006-pi-runtime-target.md`.

The two modes share **engineering quality**, not execution ownership. In
delegated work the implementation unit is the pair. Related acceptance units
may be open together: the engineer and copilot run concurrently because the copilot
is read-only, so no two sessions ever hold write access. The engineer runs
scoped tests after each TDD phase; the copilot records an independent audit per
unit and runs the full project suite before the ack. A check can cover multiple
units on an unchanged tree. When Turbo acts as its own
developer, it follows targeted Red → Green → Refactor tests, then the full
project suite before its own verification. When Turbo acts as its own verifier,
it checks the stable diff, scenarios, test-level strategy/pyramid, skills, lint
and read-only format evidence before one objective verdict. Independent reads
and resource-isolated checks can run concurrently inside Turbo; writes, TDD
transitions and shared-resource operations stay ordered. The source contracts
are `src/agents/Pulsar Agent Turbo.md`, `src/agents/pas_engineer.md`,
`src/agents/pas_copilot.md`, `specs/features/product/turbo-mode.feature`,
`specs/features/product/copiloted-agents.feature` and
`specs/features/product/worker-internal-parallelism.feature`.

## Distribution pipeline

Prompts and the state toolkit ship as built artifacts:

```text
src/agents/*.md + src/tools/pas-toolkit.ts
  -> ./pas install --target=opencode -> build dist/platforms/opencode/{agents,plugins}/
                                      -> ~/.config/opencode/{agents,plugins}/

src/agents/pi/ + src/skills/pi/ + src/tools/pi/pas-toolkit/
  + src/templates/platforms/pi/settings.snippet.json
  -> ./pas install --target=pi -> build dist/platforms/pi/{agents,skills,extensions}/
                               -> ~/.pi/agent/{agents,skills,extensions}/
```

The OpenCode build ships every prompt in `src/agents/` — both primaries, the
researcher, and the copiloted pair — and names no agent explicitly in the
manifest. The Pi build copies `src/agents/pi/` verbatim and keeps its native
`pi-subagents` frontmatter; that roster still ships `pas_researcher`,
`pas_developer` and `pas_qa`, an asymmetry preserved on purpose
(`docs/adr/0010-copiloted-engineer-and-copilot.md`). The OpenCode build injects
`permission.skill` rules into agent prompts.

The Pi toolkit extension is assembled as a thin `index.ts` adapter
plus a byte copy of the canonical core as `core.ts`. Pi installation always
installs the sources in `config/pi-packages.txt`; `--dry-run` previews only.
`pas agents setup` is a separate path from distribution: it writes Pi model
overrides into the real `~/.pi/agent/settings.json` with a timestamped backup,
while `pas install` builds the selected target before copying artifacts and
installing packages. `--dry-run` skips the build and does not write files.
Sources: `src/cli/commands/build.ts`, `src/cli/commands/install.ts`,
`src/cli/commands/agents/setup.ts`,
`config/platforms.manifest`, `config/pi-packages.txt`. Builds are
deterministic; the installed copy must match the freshly built `dist/`. Edit
`src/` and run install to rebuild and copy — never edit `dist/` or the installed
copy. `pas build` remains available when you only need generated artifacts.

## Room protocol

A delegation runs in a **room** under `.pas/rooms/`, keyed by the root session
so the Lead, engineer and copilot resolve the same store without passing ids.
New delegations use the pairing forum: `pas_pair_room` manages the room and host
recovery, `pas_pair_topic` opens and reads topics, `pas_pair_post` records
discussion and reviews, and `pas_pair_feed` waits for updates. Several topics
may be open at once and each may cover multiple scenarios. The peer approves a
specific revision with independent command evidence. Final approval requires
approved topics, scenario coverage, a passing suite, and matching reconciliation.
Topic reads and the feed share per-session read positions. They return unread
posts by default; topic reads with `all: true` return the complete history.
The feed returns a room summary rather than the full transcript. A topic read
warns when discussion reaches 20 posts or 32 KiB of message text, excluding
readiness and approval posts. This advisory never blocks work or forces escalation.
The room records hashes of authorized paths at creation to compare subsequent
changes. Topic paths can narrow freshness checks; omitted paths cover all
authorized paths. Symlinks and oversized inputs are rejected instead of claiming
freshness when verification is unavailable. Fingerprints cover only declared
paths and do not prove that a participant ran its command. Host interruption
does not revert files, and an unconfirmed runtime stop is not a confirmed stop.

The earlier interface remains available for existing legacy rooms. The Lead
opens a legacy room as **host**; the engineer joins as **driver** and the read-only
copilot as **peer**. One unit is one acceptance scenario and moves through
`open → audited → closed`. A close needs a current peer audit with command,
exit code and output, no unread messages and no open
`blocking` finding unless explicitly overruled. Missing peer review cannot be
overruled. The driver announces `ready_for_final_audit` after all units close
and stops editing; the final suite must follow that announcement. The terminal
ack needs this green full-suite audit and a reconciled file list. An
escalation cuts the turn and rejects close, end and ack until the host resolves
it. The protocol is **code, not prose**: it lives in `src/tools/pas-toolkit.ts`
and is pinned by `specs/features/product/copiloted-agents.feature`. The two
prompts are v1 and are expected to change after a pilot; the protocol is the
part the tests hold.

Acceptance auditing does not validate the engineer's TDD history. A peer can
audit existing behavior directly, without driver evidence or a new RED, and
the driver can record ordinary checks as `stage: verification`. Explicit TDD
`green` evidence still follows `red` when the engineer implements changed
behavior; this is not a per-scenario acceptance prerequisite. One executed
check may support several scenarios while the reviewed tree stays unchanged.
Units may be open concurrently and a clean audit uses an empty findings array.
The peer reviews ready portions before final readiness; the pair coordinates
stability and reopens affected units when later changes invalidate a review.
The room does not automatically detect working-tree changes.
Sources: `src/tools/pas-toolkit.ts` (`recordEvidence`, `auditUnit`, `closeUnit`),
`docs/adr/0013-acceptance-audit-independent-of-tdd.md`,
`tests/unit/verification-only-audit.test.ts`.

Each pair member receives a complete `<delegation_contract version="1.0">`
from the primary. It identifies approval and persistent plan/state references,
objective, acceptance, included/excluded scope, hard constraints, advisory
implementation hints, execution policy, checks, skills, and response format.
The template is embedded in both primary prompts so installed agents need no
PAS source checkout to delegate; a test keeps the templates identical. The
workers load their own assigned skills and the relevant referenced artifacts.

Room `authorized_paths` stores editable files or directory roots, not forecast
files; it does not enforce filesystem edits. Scope, explicit exclusions, and
runtime permissions still govern changes. Necessary in-area implementation
adaptations are allowed, while changed behavior or authority requires a
decision. No `authorization.yaml` is introduced. Sources:
`src/agents/Pulsar Agent Squad.md` (Delegation input contract),
`src/agents/Pulsar Agent Turbo.md` (Delegation input contract),
`src/agents/pas_engineer.md`, `src/agents/pas_copilot.md`,
`docs/adr/0011-bounded-delegation-contract.md`. Structural tests live in
`tests/unit/delegation-contract.test.ts`; live evaluation cases and evidence
requirements live in `docs/delegation-evaluation.md`.

`pas_room_inbox` waits up to 10 seconds by default, polling internally and
returning early on messages or meaningful state updates. Its returned cursor
covers evidence, audits, unit state, escalation, reconciliation, and lifecycle
changes, but excludes read receipts and identical file rewrites. Timeout means
the pair can wait again; `wait_s: 0` remains an immediate check. Waiting does
records declared waiting once per call, not on every poll. Activity and read
receipts are excluded from the progress cursor, so they do not produce a
notification loop. Cancellation clears the outstanding wait state.

Participant availability (`active`, `finished`, `unavailable`) is separate from
declared activity (`working`, `waiting_for_response`, with `waiting_for`).
`session.execution.started` reactivates a current member; per-step
`execution.succeeded/failed/interrupted` events and idle timestamps do **not**
mean the subagent finished. Only the host marks a returned child finished,
through `pas_room_activity` with its exact session and generation, after
receiving its actual result and runtime confirmation that it is idle. A worker
making a tool call is alive: its own `working` declaration always reactivates
it while the room is open. Room membership and `outcome: succeeded` are not
acceptance PASS. Finished participants trigger `PEER_UNAVAILABLE`, not repeated
waits for a message that will never execute their session.

When both active participants wait, `MUTUAL_WAIT` elects the role with the next
protocol action. The notice is deduplicated per participant and progress episode;
the responsibility remains visible on timeout until actual progress occurs.
Declared working periods, stale waiting state, and completed rooms do not create
false mutual waits. Activity source is shown so a self-declaration is not
mistaken for runtime-confirmed termination.

The host-only `pas_room_stop` aborts the room before calling OpenCode V2
`session.interrupt({ sessionID, resume: false })` for current driver/peer IDs.
Each request has a five-second deadline and cancellation signal. Results are
recorded separately; missing capability, rejection and timeout are unconfirmed
stops. After a killswitch, reset refuses replacement while any old execution is
unconfirmed. No source rollback, session deletion, or automatic kill is performed.
Selective stop aborts the pair but leaves the unselected execution running.
Sources: `docs/adr/0014-participant-lifecycle-and-killswitch.md`,
`src/tools/pas-toolkit.ts` (`waitForUpdates`, `applyParticipantLifecycle`,
`stopRoom`), `tests/unit/participant-lifecycle.test.ts`.

The driver has 180 steps and the peer 160; neither may return merely because
the partner is still working. The discussion cap is 32 messages per unit.
Correction rounds count distinct review points (open/reopen or driver check
evidence) with blocking findings, not repeated observations or ordinary dialogue. A successful
peer recheck can resolve finding IDs. Final corrections `reopen` the affected
unit and invalidate readiness and reconciliation; the pair re-verifies before
closing it and announcing a new stable tree. These are protocol updates, not
runtime filesystem guards against an agent that edits without reporting it.
Sources: `src/tools/pas-toolkit.ts`, `src/agents/pas_engineer.md`,
`src/agents/pas_copilot.md`, `docs/adr/0012-collaborative-pairing-lifecycle.md`,
`specs/features/product/pairing-coordination.feature`,
`tests/unit/pairing-coordination.test.ts`.

## Project bootstrap

The installed, single-file `pas_toolkit` exposes `init` in addition to
`list`, `check`, `new`, and `archive`. `init` previews a portable config by
default. With `confirm: true` (allowed by the agent **only after explicit
workspace-scoped user approval**), it atomically creates
`.pas/pas.config.yaml` with exclusive-write semantics, never overwriting an
existing config. Project identity defaults to a sanitized directory name; a
validated slug override is supported. No feature state is created until
separately requested. The reviewable default example is
`src/templates/pas.config.example.yaml`, checked for parity against the
template embedded in `src/tools/pas-toolkit.ts`; the repository's own
`.pas/pas.config.yaml` is not the template. This bootstrap is identical for
both primary modes.

## State

Feature state is the local source of truth. It lives in numbered directories
(`NNNNN-slug`) under `.pas/state/active/` and `.pas/state/archived/`, capped by
`max_active` (default one). A new feature takes the next five-digit ID: the
highest valid number across active and archived, plus one, starting at `00001`.
Every lifecycle operation runs through the installed `pas_toolkit` plugin
(`list`, `check`, `new`, `archive`); the tool blocks malformed or conflicting
state instead of guessing, and the Lead surfaces hygiene violations, offering
cleanups as separately authorized work. Configuration: `.pas/pas.config.yaml`.
Sources: `specs/features/product/state-hygiene.feature`,
`docs/adr/0001-feature-state-numbered-dirs.md`,
`docs/adr/0003-pas-toolkit-as-installed-tool.md`,
`src/agents/Pulsar Agent Squad.md` (State lifecycle and hygiene).

## Memory

Mind is the configured memory backend (`memory:` block in
`.pas/pas.config.yaml`). The Lead persists checkpoints and durable decisions;
workers only request `memory_writes` and never write memory directly. Local
artifacts stay understandable without Mind. Sources: `.pas/pas.config.yaml`
(memory block), `src/agents/Pulsar Agent Squad.md` (Checkpoint cycle).

## ADR index

Architecturally significant decisions, oldest first:

- `docs/adr/0001-feature-state-numbered-dirs.md` — numbered, single-writer
  feature state directories.
- `docs/adr/0002-living-docs-as-maps.md` — living docs as maps, updated in the
  same change.
- `docs/adr/0003-pas-toolkit-as-installed-tool.md` — state tooling distributed
  by the installer.
- `docs/adr/0004-retire-the-prd.md` — the PRD is retired; docs, specs, prompts,
  and ADRs are the living sources.
- `docs/adr/0005-optional-autonomous-turbo-lead.md` — independent optional
  primary mode, shared background workers, and retained PAS safety gates.
- `docs/adr/0006-pi-runtime-target.md` — Pi as a first-class second runtime
  target, with native sources, a thin toolkit adapter, and a soft permission
  boundary.
- `docs/adr/0007-expanded-pi-package-defaults.md` — four active Pi packages,
  adding structured questions and todo tracking to the defaults.
- `docs/adr/0008-pi-settings-snippet-stays-inert.md` — the settings snippet stays
  inert; tiering is documented in the README and installs back up edited copies.
- `docs/adr/0009-pi-settings-writes-from-setup.md` — agents setup is
  target-aware and writes Pi model overrides into the real settings with backup;
  it supersedes ADR 0008's "never merges" clause only.
- `docs/adr/0010-copiloted-engineer-and-copilot.md` — implementation becomes a
  pair: a writing engineer and a runtime-enforced read-only copilot, with the
  step contract in code; Pi keeps the previous roster on purpose.
- `docs/adr/0011-bounded-delegation-contract.md` — explicit XML pair briefs with
  persistent approval/state references, bounded autonomy, and meaningful
  escalation; forecast files are advisory.
- `docs/adr/0012-collaborative-pairing-lifecycle.md` — long-poll update waits,
  independent current-revision audits, stable final verification, and continued
  collaboration instead of premature partial returns.
- `docs/adr/0013-acceptance-audit-independent-of-tdd.md` — acceptance auditing
  checks implementation, coverage, and passing tests without requiring RED
  evidence or reconstructing implementation cycles.
- `docs/adr/0014-participant-lifecycle-and-killswitch.md` — ten-second
  activity-aware waits, real availability tracking, and bounded host interruption
  of current participant executions.
