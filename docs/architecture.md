> Owner: PAS maintainers · Updated: 2026-10-29

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
profile under `src/agents/` (OpenCode) or `src/agents/pi/` (Pi). Turbo changes
execution ownership, not the worker roster or state/approval contracts.

| Agent | Model | Role | Prompt |
|---|---|---|---|
| PAS Lead | strong | Original control plane: plan, approve, adjudicate, persist | `src/agents/Pulsar Agent Squad.md` |
| Pulsar Agent Turbo | strong | Optional primary: direct research/implementation/QA; selective background workers | `src/agents/Pulsar Agent Turbo.md` |
| `pas_researcher` | light | Read-only evidence worker | `src/agents/pas_researcher.md` |
| `pas_developer` | light | Bounded TDD implementer, one atomic task | `src/agents/pas_developer.md` |
| `pas_qa` | light | Read-only verifier, one PASS/FAIL/BLOCKED verdict | `src/agents/pas_qa.md` |

On OpenCode, permissions are per role and enforced by the runtime, not by
prompt text: the original Lead reads `.pas/**`, `specs/**/*.feature`, and
`docs/**`, and edits only PAS artifacts. Turbo can read/execute/edit source and
owns the same PAS artifacts, subject to single-use approval; the developer
shells and writes source but never PAS artifacts;
researcher and QA are read-only. The exact profiles are the frontmatter of each
prompt; the Lead contract is `## Runtime permissions and capabilities`. Sources:
`specs/features/product/lead-runtime-permissions.feature`,
`specs/features/product/worker-internal-parallelism.feature`,
`specs/features/product/turbo-mode.feature`.

Pi caveat: Pi exposes tool allowlists but no path-scoped denies, so the same role
boundaries are a soft, contractual boundary — prompt text plus QA audit, not a
runtime denial. See `docs/adr/0006-pi-runtime-target.md`.

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

## Distribution pipeline

Prompts and the state toolkit ship as built artifacts:

```text
src/agents/*.md + src/tools/pas-toolkit.ts
  -> ./pas build --target=opencode  -> dist/platforms/opencode/{agents,plugins}/
  -> ./pas install --target=opencode -> ~/.config/opencode/{agents,plugins}/

src/agents/pi/ + src/skills/pi/ + src/tools/pi/pas-toolkit/
  + src/templates/platforms/pi/settings.snippet.json
  -> ./pas build --target=pi  -> dist/platforms/pi/{agents,skills,extensions}/
  -> ./pas install --target=pi -> ~/.pi/agent/{agents,skills,extensions}/
```

The OpenCode build injects `permission.skill` rules into agent prompts; the Pi
build copies Pi agent sources verbatim and keeps their native `pi-subagents`
frontmatter. The Pi toolkit extension is assembled as a thin `index.ts` adapter
plus a byte copy of the canonical core as `core.ts`. Pi installation always
installs the sources in `config/pi-packages.txt`; `--dry-run` previews only.
`pas agents setup` is a separate path from distribution: it writes Pi model
overrides into the real `~/.pi/agent/settings.json` with a timestamped backup,
while `pas install` only copies artifacts and installs packages.
Sources: `src/cli/commands/build.ts`, `src/cli/commands/install.ts`,
`src/cli/commands/agents/setup.ts`,
`config/platforms.manifest`, `config/pi-packages.txt`. Builds are
deterministic; the installed copy must match `dist/`. Edit `src/` and rebuild —
never edit `dist/` or the installed copy.

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
