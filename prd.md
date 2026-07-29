# Product requirements document: Pulsar Agent Squad

**Status:** Draft  
**Feature ID:** `0001`  
**Feature slug:** `pulsar-agent-squad`  
**Product:** Pulsar Agent Squad (PAS)  
**Reference repository:** Nova Agent Squad (NAS)  
**NAS reference snapshot:** `./nova-agent-squad/`  
**Runtime for the MVP:** OpenCode

## Summary

Pulsar Agent Squad is a cost-efficient, contract-driven engineering harness.
It keeps one strong model in a control-plane role and delegates bounded work to
lightweight researcher, developer, and QA workers.

PAS is an independent sibling product of NAS. NAS is the reference for role
separation, authorization, quality gates, memory integration, Gherkin, and
distribution patterns. PAS must not inherit NAS's roster, configuration
namespace, model assumptions, or unresolved contract drift by accident.

The repository includes a local NAS reference snapshot at
`./nova-agent-squad/`. It is available to the PAS planning and implementation
workflow for direct inspection. The snapshot is reference material, not PAS
source code, and PAS must not modify it as part of this feature.

## Implementation strategy

PAS is built in two deliberate phases. The first phase copies the executable
NAS CLI scaffold and renames its product-facing surface to `pas`. The second
phase replaces the copied NAS agent roster and prompts with the PAS Lead,
researcher light, developer light, and QA light contracts.

### Phase 1: CLI bootstrap

The PAS workspace reuses the NAS patterns for its launcher, CLI commands,
configuration safety, model discovery, skill policies, profiles, build,
installation, platform manifest, templates, and CLI tests. The copied command
surface is named `pas`, uses the PAS configuration namespace, and preserves the
global `specs/features` path.

The copied agent prompts remain NAS prompts during this bootstrap phase. They
are scaffolding only and must not be interpreted as the PAS agent contract.

### Phase 2: Agent migration

The agent roster and prompts are replaced after the CLI bootstrap is stable:

- `PAS Lead`: strong control plane combining orchestrator and planner phases.
- `pas_researcher`: lightweight read-only evidence worker.
- `pas_developer`: lightweight bounded TDD worker.
- `pas_qa`: lightweight evidence-based verifier.

The phase-2 migration must remove the NAS roster assumptions from the CLI,
frontmatter, templates, permissions, model guidance, and tests. The nested
`nova-agent-squad/` snapshot remains unchanged throughout both phases.

Phase 2 is complete when the executable roster contains only `Pulsar Agent
Squad`, `pas_researcher`, `pas_developer`, and `pas_qa`. The next phase must
implement the versioned contracts, state transitions, deterministic scope and
authorization enforcement, and runtime artifact writes described below.

## Problem

NAS provides a disciplined engineering workflow, but its current operating
model expects high-capability models in several roles. That increases the cost
of repeated research, implementation, and verification work.

The goal is not to remove engineering discipline. The goal is to reserve
strong-model reasoning for decisions that need it and use inexpensive models
for work that can be constrained, observed, and verified.

## Product vision

PAS lets a user run a serious software-engineering workflow frequently without
consuming the budget of a strong model in every role.

The system must prefer a safe stop over an unverified assumption. A lightweight
worker may propose, investigate, implement, or report, but it must not become
the sole authority for authorization, architectural decisions, or quality
approval.

## Goals

PAS must:

- Use a strong `PAS Lead` as the single control-plane authority.
- Combine NAS's orchestrator and planner responsibilities without removing
  their separate workflow phases.
- Use lightweight models by default for researcher, developer, and QA workers.
- Preserve explicit user authorization before source changes.
- Preserve TDD, scope control, Gherkin alignment, and mandatory QA.
- Persist feature state and Markdown artifacts locally under `.pas/state/`.
- Keep Gherkin specifications in the repository's global `specs/features/`
  location without a PAS-specific filename prefix.
- Support optional Mind integration without making the run unrecoverable when
  Mind is unavailable.
- Make model usage, worker results, retries, and escalation observable.
- Reduce cost per approved change relative to an equivalent NAS workflow.

## Non-goals

The MVP does not need to:

- Replace or migrate NAS.
- Provide complete multi-runtime support.
- Run as a permanent daemon or scheduler.
- Guarantee that a lightweight developer can solve every complex task.
- Include a permanently provisioned strong developer worker.
- Move living documentation from `docs/` into feature state directories.
- Rename or namespace the repository's global Gherkin files with `pas-`.
- Create Gherkin files before this PRD and its behavior are approved.

## Users and use cases

PAS serves developers who want to:

- Plan and implement changes with lower model cost.
- Run repeated engineering tasks while retaining an auditable trail.
- Review a plan before permitting source changes.
- Resume a feature workflow from local artifacts.
- See when a lightweight worker is uncertain or has reached its boundary.
- Compare quality and cost against a stronger NAS configuration.

## Agent topology

### PAS Lead

The `PAS Lead` is the only user-facing agent and runs on a strong model.

It must:

- Clarify scope and critical assumptions.
- Create the agreement contract.
- Delegate and evaluate research.
- Run the research sufficiency gate.
- Produce the technical plan, task breakdown, and acceptance strategy.
- Own the planning quality gate previously performed around `nas_planner`.
- Present the plan and wait for explicit implementation approval.
- Divide approved work into bounded worker tasks.
- Interpret worker handoffs and QA evidence.
- Replan, reduce scope, retry, or block when a worker cannot continue.
- Decide whether a run can be reported as complete.

The Lead must not edit source code. Escalation to the Lead means re-planning,
re-slicing, or stopping the run. It does not mean that the Lead silently takes
over implementation.

### Researcher light

The researcher runs on a lightweight model and is read-only.

It must collect evidence from the repository, documentation, external sources,
and configured tools. Its output must distinguish facts, hypotheses, risks,
assumptions, and unknowns.

It must not make final architectural, authorization, or quality decisions. If
the evidence is insufficient, it must return a structured blocked handoff.

### Developer light

The developer runs on a lightweight model and receives one bounded task at a
time.

It must:

- Validate authorization and task scope before editing.
- Read the relevant state artifact and global Gherkin specification.
- Write a failing test before production implementation when behavior changes.
- Modify only the approved files and paths.
- Run the required checks.
- Report actual files, commands, results, and remaining limitations.
- Stop and escalate on ambiguity, scope expansion, or architectural decisions.

The worker must not silently convert a complex task into an unapproved design.

### QA light

QA runs on a lightweight model with a fresh context containing the approved
contract, relevant artifacts, the actual diff, and test output.

It must:

- Run tests before beginning review.
- Verify authorization, scope, Gherkin alignment, and required checks.
- Report raw evidence instead of trusting a developer's claimed result.
- Identify missing test coverage, drift, and scope creep.
- Return `PASS`, `FAIL`, or `BLOCKED` using the versioned PAS contract.

QA is not the sole authority. Deterministic checks run first, and the PAS Lead
adjudicates ambiguous or high-risk results.

## Workflow

Every non-trivial PAS run follows these phases:

1. Validate `.pas/pas.config.yaml` and the feature-state invariant.
2. Create or load the single active feature state.
3. Clarify critical assumptions with the user.
4. Delegate repository and external research to researcher light.
5. Validate research sufficiency in the PAS Lead.
6. Produce and persist the plan, risks, tasks, and acceptance references.
7. Present the plan to the user.
8. Wait for explicit, single-use approval scoped to the feature or task set.
9. Delegate bounded implementation tasks to developer light.
10. Run deterministic checks and delegate QA light.
11. Let the PAS Lead interpret the QA evidence.
12. Retry only allowed failure categories and only within the configured retry
    count.
13. Replan, block, or ask the user when the worker boundary is reached.
14. Archive the complete feature state only after the feature lifecycle ends.

Trivial changes may use a reduced contract, but they must still respect
authorization and state invariants when they modify source files.

## State and artifact lifecycle

`docs/` contains living documentation about the PAS product and architecture.
It is not an active or archived feature store.

`specs/features/` contains global Gherkin specifications. PAS does not add a
`pas-` prefix to those filenames. The feature state references its
specification path rather than copying or moving the specification.

Feature state is stored as follows:

```text
.pas/
├── pas.config.yaml
└── state/
    ├── active/
    │   └── <NNNN>-<feature-slug>/
    │       ├── state.md
    │       ├── prd.md
    │       ├── research.md
    │       ├── design.md
    │       ├── tasks.md
    │       └── validation.md
    └── archived/
        └── <NNNN>-<feature-slug>/
```

The lifecycle rules are mandatory:

- At most one feature directory may exist in `state/active/`.
- Feature directories use a four-digit number beginning at `0001`.
- Before creating a new active feature, PAS scans `state/archived/` and uses
  the highest valid number plus one.
- If no archived feature exists, PAS uses `0001`.
- Archiving moves the complete directory from `active/` to `archived/`.
- Archiving never renumbers or copies a feature.
- Duplicate numbers, malformed directories, or multiple active features block
  state mutation.
- PAS must never delete an existing feature to resolve a state conflict.

## Local artifacts

The local feature state is the minimum source of truth for PAS. Mind can enrich
the workflow with decisions, context, and cross-session memory, but the local
state must remain understandable and auditable without it.

Each active feature should contain, when applicable:

- `state.md`: lifecycle status, feature ID, and references.
- `prd.md`: product requirements and approved scope.
- `research.md`: evidence, findings, sources, assumptions, and gaps.
- `design.md`: technical approach and decisions.
- `tasks.md`: ordered implementation tasks and exit criteria.
- `validation.md`: QA evidence, verdict, and remaining limitations.

Artifacts must record the model role used, relevant run ID, scope, status,
assumptions, risks, and links to the corresponding Gherkin specification.
Secrets, credentials, and unnecessary raw prompts must not be persisted.

## Contracts and quality gates

PAS must use versioned structured contracts. Markdown remains the human-readable
artifact format, but worker handoffs and machine validation must have a stable
schema.

The contracts must cover:

- Agreement scope.
- Research report and evidence provenance.
- Plan and task boundaries.
- Single-use apply authorization.
- Developer implementation report.
- QA verdict and failure category.
- Operational handoff and escalation.
- Feature state transitions.

Deterministic gates must validate, where the runtime supports them:

- Configuration schema.
- Active-state cardinality.
- Numeric feature IDs.
- Authorization scope.
- Modified files against the approved scope.
- Tests, types, and configured lint checks.
- Gherkin references and specification drift.
- Tool and skill permissions.
- Retry count and escalation state.

The model's declaration of `PASS`, `APPROVED`, or `DONE` is never sufficient
without supporting evidence.

## Model policy

PAS uses capability profiles rather than hardcoding a single provider:

| Role | Default profile | Authority |
|---|---|---|
| `PAS Lead` | Strong | User-facing and authoritative |
| Researcher | Light | Evidence producer |
| Developer | Light | Bounded implementer |
| QA | Light | Evidence producer and verifier |

The initial benchmark may use DeepSeek V4 Flash with a high reasoning variant
for lightweight workers, subject to actual runtime support and measured results.
The PRD does not assume that a model's marketing label proves compliance or
quality.

If a worker fails, the PAS Lead may replan or reduce the task. The MVP blocks
after the configured retry policy rather than silently promoting a model or
editing source from the control plane.

## NAS reference map

PAS must preserve these NAS invariants:

| NAS capability | PAS treatment | Reference |
|---|---|---|
| Planning-first workflow | Preserve, with planning internal to the Lead | `src/agents/Nova Agent Squad.md` |
| Explicit authorization | Preserve unchanged in principle | `docs/architecture.md` |
| Single-use scope approval | Preserve unchanged in principle | `docs/architecture.md` |
| TDD implementation | Preserve for developer light | `src/agents/nas_developer.md` |
| Mandatory QA | Preserve for every implementation path | `src/agents/nas_qa.md` |
| Gherkin acceptance contracts | Preserve, with global `specs/features/` ownership | `.agents/nas.config.yaml` |
| Handoff blocks | Preserve and version the schema | `docs/AGENTS.md` |
| Memory and checkpoints | Adapt as optional Mind integration | `src/agents/Nova Agent Squad.md` |
| Skills assignment | Preserve per-task assignment | `src/agents/Nova Agent Squad.md` |
| Mini developer posture | Reuse as input for developer light | `src/agents/nas_developer_mini.md` |
| Model profiles | Rebuild under PAS namespace | `src/cli/lib/profile-store.ts` |
| Build and installation | Reuse patterns, not NAS roster assumptions | `src/cli/commands/build.ts` |

PAS must not blindly inherit these NAS behaviors:

- A separate planner subagent when the Lead owns planning.
- NAS agent names or hardcoded roster lists.
- NAS configuration at `.agents/nas.config.yaml`.
- Broad wildcard permissions as the only enforcement layer.
- Inconsistent `qa_status` and `qa_verdict` contracts.
- Prompt-only authorization and scope enforcement.
- NAS's current assumption that most roles need heavy models.
- Legacy Gherkin paths or PAS-specific prefixes in global specs.

## Functional requirements

### FR-001: Validate PAS configuration

PAS must load `.pas/pas.config.yaml` before normal workflow execution and stop
when the configuration is invalid or the required state directories cannot be
validated.

### FR-002: Enforce one active feature

PAS must allow at most one feature directory under `.pas/state/active/`. Any
attempt to create or continue with multiple active features must return a
blocking error without deleting or moving existing state.

### FR-003: Allocate feature IDs safely

PAS must inspect archived feature directories, validate their numeric prefixes,
and allocate the next four-digit ID. It must block on malformed or conflicting
archived state rather than guessing.

### FR-004: Preserve feature state on archive

PAS must move the complete active feature directory to archived without changing
its ID, references, or artifact contents.

### FR-005: Preserve global specifications

PAS must read and reference Gherkin files under the configured global specs path.
It must not automatically rename or prefix those files with `pas-`.

### FR-006: Run a strong control plane

PAS must provide a Lead workflow that combines orchestration and planning while
keeping research, planning, approval, implementation, and QA as separate
auditable phases.

### FR-007: Constrain lightweight workers

PAS must provide explicit permissions, task boundaries, tool limits, uncertainty
handling, and output contracts for each light worker.

### FR-008: Require evidence-based QA

PAS must execute deterministic checks and collect raw QA evidence before the
Lead can report successful completion.

### FR-009: Persist local artifacts

PAS must write the relevant Markdown artifacts to the active feature state and
must be able to identify the current run, scope, model roles, and status from
local files.

### FR-010: Support optional Mind integration

When enabled and available, PAS may use Mind for durable context and decisions.
When unavailable, PAS must report the degraded mode and continue only when the
local artifacts contain the information required by the current phase.

### FR-011: Bound retries and escalation

PAS must classify worker failures, limit automatic retries, and return control to
the Lead or user when the failure is not safely recoverable.

### FR-012: Operate on OpenCode first

The MVP must support OpenCode agent installation, model configuration, skills,
and delegation. Other runtimes require separate compatibility contracts.

## Non-functional requirements

PAS must be auditable, resumable across interactive sessions, conservative with
source permissions, explicit about model identity, and economical in token use.

The system must prefer deterministic validation over model self-reporting. It
must expose enough run metadata to compare cost, latency, retries, escalation,
and quality against NAS.

## Success metrics

The first evaluation must compare PAS against an equivalent NAS workflow using a
representative task corpus. It must measure:

- Cost per approved change.
- First-pass approval rate.
- Test and QA failure rate.
- Scope-violation rate.
- Defects found after completion.
- Worker escalation rate.
- Automatic retry rate.
- Artifact completeness.
- Time to approved plan.

The benchmark must verify that the intended agent and model actually executed
each task. A runtime fallback to a different agent invalidates the trial.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Developer light cannot solve a complex task | Require task slicing, bounded retries, and explicit blocking |
| QA light misses a subtle defect | Run deterministic gates first and keep Lead adjudication authoritative |
| Lead becomes a single point of failure | Persist artifacts and make every phase inspectable |
| Prompt rules are ignored | Enforce schema, permissions, scope, and state outside the model where possible |
| Local artifacts become inconsistent | Validate state transitions and use atomic directory moves |
| Model routing is not what the benchmark expects | Record actual model/agent identity and fail invalid trials |
| Mind is unavailable | Continue from local artifacts only when the phase is self-contained |
| PAS inherits NAS drift | Treat NAS as reference material and create PAS-specific contracts |

## Acceptance boundary for this PRD

This PRD is complete when the product decisions, state lifecycle, agent
responsibilities, NAS reuse boundaries, model policy, artifact requirements,
quality gates, and success metrics are approved.

The Gherkin specification for PAS must be created afterward in the repository's
global `specs/features/` location, using the repository's existing naming
convention and without a `pas-` prefix.
