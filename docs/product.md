> Owner: PAS maintainers · Updated: 2026-11-24

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
- **Bounded delegation and reports** — both primary modes send one short XML
  brief at real handoffs, with non-binding hints separated from authorized
  scope; researcher reports lead with an answer, coverage, limits, and closure;
  QA re-verifies existing behavior without a manufactured TDD cycle while
  developer TDD and full-suite checks remain. Contracts:
  `specs/features/product/bounded-open-code-delegation.feature` (A1–A3).
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
- **Distribution and updates** — a real install builds the selected manifest
  artifacts before copying, a dry run only previews, one update selection
  drives both the printed plan and the executed actions, and OpenCode agent
  installs keep a destination-local inventory. Install rejects a symlinked or
  non-regular destination before copying. Reinstalls retire only unmodified
  agents that inventory records; install and uninstall preserve edited,
  symlinked, and unowned files and keep the ownership marker. Contracts:
  `specs/features/product/open-code-distribution.feature` (D1–D5).
- **Tool policies** — deny-only rules kept in a versioned PAS store, scoped per
  agent or across all PAS agents, with list, setup, block, unblock, clear,
  dry-run, and doctor reporting. Build injects them into generated frontmatter
  in the agent's existing format without relaxing unrelated rules, and the
  deny survives reinstall and uninstall. The manual runtime-enforcement check
  remains a separate disposable-profile gate. Contracts:
  `specs/features/product/open-code-tool-policies.feature` (P1–P5).

## Scope boundaries

The MVP targets OpenCode first; multi-runtime support, NAS migration, and
permanent daemons are out of scope. The scope boundaries are native to this doc
(migrated from the retired PRD, 2026-10-14).

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
