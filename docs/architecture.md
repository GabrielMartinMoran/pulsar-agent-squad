> Owner: PAS maintainers · Updated: 2026-11-24

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

The runtime is OpenCode. The roster contains two selectable primary modes and
three shared workers, each with its own prompt and permission profile under
`src/agents/`. Turbo changes execution ownership, not the worker roster or
state/approval contracts.

| Agent | Model | Role | Prompt |
|---|---|---|---|
| PAS Lead | strong | Original control plane: plan, approve, adjudicate, persist | `src/agents/Pulsar Agent Squad.md` |
| Pulsar Agent Turbo | strong | Optional primary: direct research/implementation/QA; selective background workers | `src/agents/Pulsar Agent Turbo.md` |
| `pas_researcher` | light | Read-only evidence worker | `src/agents/pas_researcher.md` |
| `pas_developer` | light | Bounded TDD implementer, one atomic task | `src/agents/pas_developer.md` |
| `pas_qa` | light | Read-only verifier, one PASS/FAIL/BLOCKED verdict | `src/agents/pas_qa.md` |

Permissions are per role and enforced by the runtime, not by prompt text: the
original Lead reads `.pas/**`, `specs/**/*.feature`, and `docs/**`, and edits
only PAS artifacts. Turbo can read/execute/edit source and owns the same PAS
artifacts, subject to single-use approval; the developer shells and writes
source but never PAS artifacts. The researcher is a read-only evidence worker
whose hybrid shell profile allows commands by default, denies common file, Git,
and dependency mutations, and relies on its prompt to keep shell use to
inspection; QA is read-only with shell. The exact profiles are the frontmatter
of each prompt; the Lead contract is `## Runtime permissions and capabilities`.
Sources: `specs/features/product/lead-runtime-permissions.feature`,
`specs/features/product/worker-internal-parallelism.feature`,
`specs/features/product/turbo-mode.feature`,
`specs/features/product/bounded-open-code-delegation.feature` (A2, A4, A5).

The two modes share **engineering quality**, not execution ownership.
When Turbo acts as its own developer, it follows targeted Red → Green →
Refactor tests, then the full project suite before QA. When Turbo acts as its
own QA, it checks the stable diff, scenarios, test-level strategy/pyramid,
skills, lint and read-only format evidence before one objective verdict.
Independent reads and resource-isolated checks can run concurrently inside
Turbo; writes, TDD transitions and shared-resource operations stay ordered.
The source contracts are `src/agents/Pulsar Agent Turbo.md`,
`src/agents/pas_developer.md`, `src/agents/pas_qa.md`,
`specs/features/product/turbo-mode.feature` and
`specs/features/product/worker-internal-parallelism.feature`.

At an actual handoff, both primary modes use one short XML
`<delegation_brief>`: objective, authorized scope and exclusions, sources,
acceptance, required checks, expected evidence, and non-binding hints. The block
does not change when either mode delegates, the roster, or permissions; it is a
text contract, not runtime enforcement. Worker reports close the loop: the
researcher leads with a grounded answer plus coverage, limits, and an explicit
closure status, and separates source inspection from commands it actually ran;
its prompt limits shell use to inspection. QA may re-verify existing behavior
from current evidence without demanding a new Red/Green cycle; the developer
keeps TDD for behavior changes and the full suite. Sources:
`specs/features/product/bounded-open-code-delegation.feature` (A1–A5) and the
five prompts above.

User-facing communication follows one contract in both primary modes: routine
progress and substantive closings lead with the outcome, material issues are
reported promptly with whether other work can proceed, and quick answers stay
direct. Internal worker reports, approvals, delegation order, and QA semantics
are unchanged. Sources:
`specs/features/product/agent-output-communication.feature` (C1–C4),
`src/agents/Pulsar Agent Squad.md` (Subagent sequencing, Session termination),
and `src/agents/Pulsar Agent Turbo.md` (Compact handoff and final report).

## Distribution pipeline

Prompts and the state toolkit ship as built artifacts. The manifest is the
single source of target rows; commands select its rows before they build or
copy:

```text
src/agents/*.md + src/tools/pas-toolkit.ts + config/platforms.manifest
  -> ./pas build --target=opencode   -> dist/platforms/opencode/{agents,plugins}/
  -> ./pas install --target=opencode -> ~/.config/opencode/{agents,plugins}/
```

A real `pas install` builds every selected target from source and validates
the whole artifact set before the first destination write; a failed build
leaves the destination untouched. `--dry-run` never builds or writes: it
previews the existing artifacts or fails naming the missing ones. `pas update`
uses one action selection for both the plan it prints and the actions it runs:
`git pull --ff-only` plus the default OpenCode install, `--rebuild` alone
builds, `--reinstall` installs explicitly, and `--check` only prints. A failed
install after a completed pull reports partial completion and the checkout is
not rolled back. Builds are deterministic; the installed copy must match
`dist/`. Edit `src/` and rebuild — never edit `dist/` or the installed copy.

Each OpenCode agent destination carries a destination-local
`.pas-install-inventory.json` with relative filenames and SHA-256 digests,
written only after a successful copy. Before building or copying, the installer
checks the agents directory and every shipped agent path with `lstat`: a
symbolic link or non-regular entry is a conflicting path and aborts the install
before any artifact is copied. A reinstall prunes only a recorded retired file
that is still a regular, unmodified file; edited, symlinked, unowned, and user
files are never removed. Protected records keep their original digest, and the
marker remains after uninstall even with zero records, so a managed destination
never falls back to name-based removal. Only a destination with no marker keeps
the unchanged pre-inventory canonical fallback. A malformed or symlinked
inventory fails before any write or deletion. Sources:
`src/cli/lib/build-target.ts`, `src/cli/lib/install-inventory.ts`,
`src/cli/commands/{build,install,uninstall,update}.ts`,
`config/platforms.manifest`,
`specs/features/product/open-code-distribution.feature`.

## Tool policies

Tool denies are PAS-owned, deny-only, and persisted in a versioned store
(`pas/policies.json` inside the OpenCode config directory, resolved from
`XDG_CONFIG_HOME` or `HOME`). `pas tools list/setup/block/unblock/clear` never
edit `opencode.json(c)`, reject allow/ask effects, validate tool identifiers,
and write the store atomically; `--dry-run` and cancelled setup write nothing.
Invalid data is reported by `pas tools` and `pas doctor` without overwriting it.
Sources: `src/cli/lib/policy-store.ts`, `src/cli/lib/tool-policies.ts`,
`src/cli/commands/tools/*`, `specs/features/product/open-code-tool-policies.feature`.

Build is the injection boundary. `buildManifestEntries` loads and validates the
store before clearing any dist path, so an invalid store fails the build (and a
real install) before output is written. Per agent, skill injection runs first;
tool denies follow. Persistent source agents use the legacy `permission:` map,
so canonical actions are written as legacy keys in the same map
(`shell`→`bash`, `subagent`→`task`, `edit`→`edit`/`write`/`patch`) after every
existing rule. Native V2 `permissions:` lists get an appended
`resource: "*"` deny. Unrelated rules, rule order, and existing denies are
preserved; an injected deny only tightens. An agent-scoped `shell` deny
replaces a legacy `bash` map with one scalar `bash: deny`; without that deny the
source map ships unchanged. Reinstall rebuilds the artifacts, and uninstall
never removes the store. `pas update` and `pas install` share this build path.
Sources: `src/cli/lib/policy-injection.ts`, `src/cli/lib/build-target.ts`,
`src/cli/commands/install.ts`,
`specs/features/product/open-code-tool-policies.feature` (P3–P4),
`specs/features/product/bounded-open-code-delegation.feature` (A5).

Runtime enforcement is not proven by build assertions: scenario P5 is a manual
check in a disposable OpenCode V2 profile.

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
