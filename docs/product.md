> Owner: PAS maintainers · Updated: 2026-10-29

# Product

PAS lets a developer run a serious engineering workflow frequently without
paying for a strong model in every role: the original strong Lead delegates
bounded work to light workers, while optional Pulsar Agent Turbo does routine
research, implementation, and verification directly, invoking the same light
workers selectively. This doc is the product map; the behavior contracts are the Gherkin
specs it points to. Vision, goals, and users are native to this doc
(migrated from the retired PRD, 2026-10-14).

## Feature groups

Each group names its behavior contracts:

- **Lead orchestration** — planning-first workflow, parallel research batches,
  strictly sequential implementation. Contracts:
  `specs/features/product/lead-parallel-research.feature`.
- **Turbo mode** — optional autonomous primary, context- and risk-aware
  selective background delegation, mandatory verification and original PAS
  approval/artifact guarantees. Contract:
  `specs/features/product/turbo-mode.feature`.
- **Runtime permissions** — fixed, documented permission profiles per role;
  denials are policy and route work instead of blocking it. Contracts:
  `specs/features/product/lead-runtime-permissions.feature`.
- **First-run workspace config** — preview a portable PAS configuration,
  request explicit approval, and create it safely using the installed
  `pas_toolkit init` operation without cloning the harness. Contract:
  `specs/features/product/project-config-bootstrap.feature`.
- **State lifecycle** — numbered feature directories, single-writer state
  operations through the installed toolkit, hygiene detection. Contracts:
  `specs/features/product/state-hygiene.feature`.
- **Parallelism** — worker-internal batching guards: concurrent independent
  checks, sequential shared state. Contracts:
  `specs/features/product/worker-internal-parallelism.feature`.
- **Gherkin tags** — one class tag per scenario fixes its lightest reliable
  test level. Contracts:
  `specs/features/product/gherkin-tag-policy.feature`.
- **Project documentation** — living docs as maps, updated with the change,
  with an ADR trail. Contracts:
  `specs/features/product/project-documentation.feature`.
- **Pi runtime target** — the same PAS workflow on Pi: native subagents and
  skills, deterministic build and install, plugin installation from an editable
  list, and a contractual permission boundary. Contract:
  `specs/features/product/pi-runtime-target.feature`.
- **Target-aware agents setup** — `pas agents setup` asks which tool to
  configure, offers only OpenCode and Pi, and writes real per-subagent model
  overrides with backups. Contract:
  `specs/features/product/target-aware-agents-setup.feature`.

## Scope boundaries

The MVP remains OpenCode-first. Pi is a supported second runtime target
(`docs/adr/0006-pi-runtime-target.md`), including agent model setup through
`pas agents setup`; general multi-runtime support, NAS migration, and permanent
daemons remain out of scope. The scope boundaries are
native to this doc (migrated from the retired PRD, 2026-10-14).

## Who it serves

Developers who want lower model cost per approved change, an auditable trail,
review before source changes, and resumable features. Users, use cases, and
success metrics are native to this doc
(migrated from the retired PRD, 2026-10-14).

## Success metrics

The first evaluation compares PAS against an equivalent NAS workflow on a
representative task corpus and measures:

- Cost per approved change.
- First-pass approval rate.
- Test and QA failure rate.
- Scope-violation rate.
- Defects found after completion.
- Worker escalation rate.
- Automatic retry rate.
- Artifact completeness.
- Time to approved plan.

A trial is valid only when the intended agent and model executed the task; a
runtime fallback invalidates it.
