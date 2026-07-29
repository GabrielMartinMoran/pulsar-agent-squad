# Nova Agent Squad Architecture

This document provides a detailed technical overview of the Nova Agent Squad architecture, including agent roles, communication protocols, permissions, and the anti-hallucination system.

## System Overview

Nova Agent Squad (NAS) is a five-agent system built on OpenCode's agent framework. Each agent has a specific role, strict permissions, and communicates through structured XML contracts.

```
┌────────────────────────────────────────────────────────────────┐
│                           USER                                 │
│                             │                                  │
│                             V                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │          Nova Agent Squad (Orchestrator)                 │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ • Plans and coordinates                            │  │  │ 
│  │  │ • Challenges weak requests                         │  │  │ 
│  │  │ • Manages authorization gates                      │  │  │ 
│  │  │ • Delegates to subagents                           │  │  │
│  │  │ • NEVER edits code                                 │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                             │                                  │
│        ┌──────────────┬─────┴────────┬──────────────┐          │
│        V              V              V              V          │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│   │   nas_   │   │   nas_   │   │   nas_   │   │   nas_   │    │
│   │researcher│   │ planner  │   │developer │   │    qa    │    │
│   └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
└────────────────────────────────────────────────────────────────┘
```

## Agent Roles

### 1. Nova Agent Squad (Orchestrator)

**Mode**: Primary  
**Permissions**: No edit, no bash, task delegation only

The orchestrator acts as Manager and Tech Lead. It is the only agent that interacts directly with the user.

**Responsibilities**:
- Receive and clarify requirements
- Build the Agreement Contract (scope, constraints, assumptions)
- Discover and assign skills
- Delegate to Researcher for feasibility analysis
- Build the Skill Assignment Contract — which skills are relevant, which subagent needs them — before delegating to Planner
- Present findings and request user authorization, including a delegation plan with subagent order and exact skills
- Delegate to Developer for implementation only after the user explicitly approves the presented plan
- Delegate to QA automatically after implementation and before any completion update
- Handle blockers and escalation

**Key Rules**:
- Never write code
- Never edit files
- In planning, confirm only scope changes or critical assumptions
- Do not request confirmation for minor analysis/spec steps
- Ask for explicit user confirmation when scope changes from the approved contract
- Ask for explicit user confirmation for any critical assumption before delegating implementation
- Request explicit apply authorization before delegation
- Do not ask whether QA should run. QA is mandatory and automatic after implementation.
- **Planning Quality Gate**: validate non-empty planner output and critical sections before presentation; retry once with missing items; on second failure escalate and do not claim readiness.
- **Turn boundary**: the plan presentation is the final response for that turn; do not use the native question tool or any interactive prompt in the same turn.

### 2. nas_researcher

**Mode**: Subagent (hidden)
**Permissions**: Read, search, webfetch, websearch, limited read-only bash (`git`, `curl`, `wget`); no edit

**Operational handoff policy**:
- Handoff is condition-based: **blocked, at risk, or insufficient progress**.

The researcher exhaustively investigates the codebase and external sources. It does NOT produce Gherkin scenarios — that is the planner's job.

**Responsibilities**:
- Map codebase and identify impacted areas
- Research external documentation, library APIs, and best practices
- Exhaust all available information sources (websearch, webfetch, MCPs)
- Validate skill requirements
- Report feasibility and risks
- Produce comprehensive research reports for the planner

**Output Format**:
```xml
<research_report>
<feasibility>(Summary)</feasibility>
<codebase_findings>(Files, patterns, conventions found)</codebase_findings>
<external_findings>(Documentation, APIs, best practices found)</external_findings>
<impacted_areas>(Files and modules affected)</impacted_areas>
<dependencies>(Internal and external dependencies)</dependencies>
<risks>(Risk descriptions with severity)</risks>
<existing_tests>(Test patterns and coverage gaps)</existing_tests>
<assumptions>(What was inferred)</assumptions>
<sources_consulted>(All sources investigated)</sources_consulted>
</research_report>
```

### 3. nas_planner

**Mode**: Subagent (hidden)
**Permissions**: Read, search, write (Gherkin only), webfetch, websearch; no edit, no bash

**Operational handoff policy**:
- Handoff is condition-based: **blocked, at risk, or insufficient progress**.

The planner designs the implementation strategy using SDD methodology. It receives the researcher's report and produces tagged Gherkin scenarios, technical design, and implementation tasks. It is the only agent allowed to author or modify repository `.feature` files, and it persists Gherkin feature files only when the orchestrator-controlled persistence policy enables that pass.

**Responsibilities**:
- Analyze the research report and validate findings
- Consult external documentation for design decisions (library APIs, best practices)
- Design the implementation strategy and architecture decisions
- Produce tagged Gherkin scenarios as acceptance contracts
- Persist Gherkin feature files to `gherkin.storage_path` only when the orchestrator-controlled `gherkin.persist_to_repo` contract authorizes repository writes
- Define ordered implementation tasks for the developer
- Update the plan and Gherkin files when re-delegated with user feedback

**Output Format** (Memory-Centric SDD):
```xml
<planning_output>
<feasibility>(Verdict based on research + own analysis)</feasibility>
<approach>(Technical strategy and architecture decisions)</approach>
<external_docs_consulted>(URLs and what was learned)</external_docs_consulted>

<!-- Change Memory block for Memory-Centric SDD -->
<change_memory>
<id>sdd-{type}-{name}-{timestamp}</id>
<type>feature | fix | refactor | docs | test | chore</type>
<name>short descriptive name</name>
<proposal>
## Intent
Why are we doing this?

## Scope
In scope: ...
Out of scope: ...
</proposal>
<approach>
## Technical Approach
How will it be implemented?

## Design Decisions
- Decision 1: ... (because ...)
</approach>
<gherkin>
@delta-added
Feature: [Name]
  Scenario: [Scenario 1]
    Given [Context]
    When [Action]
    Then [Expected result]
</gherkin>
<tasks>
## Phase 1: ...
- [ ] 1.1 Task description
</tasks>
<status>PENDING</status>
</change_memory>

<implementation_tasks>(Ordered steps for the developer)</implementation_tasks>
<gherkin_persisted>(Files created/updated)</gherkin_persisted>
<risks>(Risk descriptions and mitigations)</risks>
<assumptions>(What was inferred)</assumptions>
<memory_writes>
- space: "projects/{repo-name}"
  name: "sdd-{type}-{name}"
  content: (Full change_memory XML)
  tags: ["cat:sdd", "type:change_memory", "status:pending", "delta:{type}"]
</memory_writes>
</planning_output>
```

### 4. nas_developer

**Mode**: Subagent (hidden)  
**Permissions**: Full edit, bash, webfetch

**Operational handoff policy**:
- Handoff is condition-based: **blocked, at risk, or insufficient progress**.

The developer implements features using strict TDD methodology.

**Responsibilities**:
- Validate authorization metadata
- Write failing tests (RED)
- Implement minimum code to pass (GREEN)
- Refactor for clarity
- Run linters and formatters
- Execute integration tests
- Provide handoff to QA

**Pre-Flight Checks**:
```yaml
apply_approved: true
approval_scope: [feature identifier]
approved_by_user: [explicit confirmation]
```

**TDD Cycle**:
```xml
<tdd_cycle>
Phase: [Red|Green|Refactor|Linting|Integration]
Action: [File changed or command executed]
</tdd_cycle>
```

### 5. nas_qa

**Mode**: Subagent (hidden)  
**Permissions**: Read, bash; no edit

**Operational handoff policy**:
- Handoff is condition-based: **blocked, at risk, or insufficient progress**.

The QA agent validates implementation against specifications.

**Responsibilities**:
- Execute test suites
- Verify Gherkin alignment
- Check for code quality issues
- Detect scope drift
- Validate authorization
- Report with structured status

**Status Values** (English):
- `APPROVED`: Implementation matches contract and passes all checks
- `REJECTED`: Issues found, fix required
- `BLOCKED`: Missing or contradictory requirements

**Output Format**:
```xml
<qa_status>
Status: [APPROVED|REJECTED|BLOCKED]
</qa_status>
<fail_category>NONE|tests_fail|test_insufficiency|clean_code_warning|scope_creep|contract_violation|skill_violation|linter_fail|specs_drift|same_error|other</fail_category>
<validation_details>
(List of checks performed and evidence)
</validation_details>
<required_action>
(If REJECTED: fix instructions.
 If BLOCKED: question for Orchestrator)
</required_action>
```

## Auto-Iteration System

The orchestrator supports automatic iteration on certain failure categories to improve efficiency.

### Fail Categories

| Category | Description | Auto-Iterable? |
|----------|-------------|----------------|
| `tests_fail` | Test suite fails | Yes |
| `test_insufficiency` | Gherkin/function/path/edge case coverage insufficient | Yes |
| `clean_code_warning` | Linter/clean-code warnings present | Yes |
| `skill_violation` | Skill guidance not applied conceptually | Yes |
| `linter_fail` | Linter/formatter configured and failed | Yes (if configured) |
| `scope_creep` | Files modified outside approved contract | No |
| `contract_violation` | Implementation violates contract terms | No |
| `specs_drift` | Specs/features/*.feature out of sync with implementation | No |
| `same_error` | Identical issue persists after iteration | No |
| `other` | Unclassified failure | No |

### Iteration Rules

1. **Max iterations**: 2 auto-iterations maximum before forced escalation
2. **Same error detection**: If the same `fail_category` persists after 2 iterations, escalate immediately
3. **Orchestrator coordination**: The orchestrator tracks `auto_iteration_count` and `last_fail_category` in checkpoints
4. **No consent required**: Auto-iterable failures do NOT require user consent — the orchestrator informs the user
5. **First retry guarantee**: The first auto-iterable QA FAIL always triggers retry 1/2
6. **`same_error` timing**: Treat `same_error` as meaningful only after at least one completed auto-iteration

### User Notifications

- **Auto-iteration**: "Automatically retrying after QA failure in [category] (retry N/2)."
- **Forced escalation (max)**: "Maximum auto-iterations reached (2/2) — escalating to the user."
- **Category changed**: "QA failure category changed from [last_category] to [category]. This may indicate a different issue than the one being auto-iterated, so I’m escalating to you instead of retrying automatically."
- **Pattern detected**: "Repeated QA failure pattern detected after retry 2/2 — escalating to the user."

### Checkpoint State for Auto-Iteration

```yaml
auto_iteration_count: 0  # Increments on auto-iteration, resets on escalation or PASS
last_fail_category: NONE # Compared for same-error detection
```

## Project Configuration

NAS requires a mandatory project config file at `.agents/nas.config.yaml`. This file configures memory, mind spaces, Gherkin persistence, and modification policies.

### Config Schema

```yaml
version: "1.1"  # Required: config schema version

memory:
  enabled: true  # Enable/disable enhanced memory
  provider: mind  # mind | openspec | engram | claude-mem | stateless

mind_spaces:
  project_space:
    enabled: true
    name: "projects/<repo-name>"
    description: "Project context, decisions, architecture, and session checkpoints"

gherkin:
  enabled: true
  storage_path: "specs/features"
  persist_to_repo:
    when: "on_done"   # always = every planning/replanning pass; on_done = once the plan is finalized/approved before developer execution; never = delegation/output only
    format: "merged"   # merged = canonical full .feature files; delta = reserved/experimental unless separately contracted
  include:
    - "product/*"
    - "application/*"
  exclude:
    - "researcher/*"
    - "sandbox/*"

# Memory-Centric SDD Configuration
sdd:
  enabled: true                    # enable Memory-Centric SDD
  change_memory:
    auto_create: true              # auto-create Change Memory on planning
  delta:
    removal_policy: "remove"       # remove | mark_deprecated
    resolve_on: "on_done"          # on_done | on_archive | manual | never
  memory_tracking: true            # track lifecycle in memory

config_policy:
  require_confirmation: true
```

### First-Run Enforcement

Startup always checks `.agents/nas.config.yaml` before any normal workflow.

**On startup, the orchestrator MUST:**
1. Check for config existence
2. If missing: halt normal workflow, ask user for authorization to create
3. On authorization: delegate config creation to `nas_developer` (orchestrator has no write tools)
4. If not authorized: refuse to proceed without it

### Config Modification Policy

- Any config change requires explicit user confirmation
- Changes are delegated to `nas_developer` (not written by orchestrator)
- Config modifications are auditable via git history

### Runtime Config Propagation

When delegating runtime config to subagents, pass `version` plus only the
enabled `memory`, `mind_spaces`, and `gherkin` blocks.

- Do not pass disabled config blocks unless the task is config editing.
- Subagents use `mind_spaces` config for memory integration.

### Gherkin persistence contract

The orchestrator decides whether repository Gherkin persistence happens via `gherkin.persist_to_repo`. The planner is the only agent allowed to author or modify repository `.feature` files. Developer and QA consume persisted Gherkin read-only, and QA remains mandatory before completion.

For OpenCode, planner write permissions use `permission.edit` with a
`*.feature` allowlist. Do not use `permission.write`.

- `when: always` => planner writes/updates repo feature files on each planning/replanning pass
- `when: on_done` => planner writes/updates repo feature files once the plan is finalized/approved for implementation, before developer execution
- `when: always` is the lightweight mode for persisted pre-implementation review artifacts.
- `when: on_done` is approval-gated and does NOT persist repo `.feature` files before implementation approval.
- `when: never` => no repo writes; Gherkin stays in delegation/output only
- `format: merged` => persisted files are full canonical `.feature` files for developer and QA consumption
- `format: delta` => reserved/experimental unless separately contracted

## Authorization System

### The Three-Layer Guard

```
Layer 1: Orchestrator Gate (including Planning Quality Gate)
    │
    ▼
"Implementation plan is ready. Do you want me to apply it now?"
    │
    ▼
Layer 1.5: Planning Quality Gate
    │
    ├── Non-empty planner output?
    ├── All critical sections present?
    ├── Retry once with missing items
    └── Second failure → escalate, don't ask approval
    │
    ▼
Layer 2: Developer Pre-Flight
    │
    ├── apply_approved: true?
    ├── approval_scope matches?
    └── approved_by_user confirmed?
    │
    ▼
Layer 3: QA Verification
    │
    ├── Tests pass?
    ├── Contract met?
    └── Authorization valid?
```

### Authorization Metadata

When the orchestrator delegates to developer, it must include:

```yaml
apply_authorization:
  approved: true
  approval_scope: "user-authentication-feature"
  approved_by_user: "yes apply it"
  timestamp: "2025-03-07T10:30:00Z"
```

### Scope Rules

- Authorization is **single-use per scope**
- After one feature is applied, new features require new authorization
- Prior approvals do NOT auto-apply to subsequent changes
- Each change scope is explicitly named in the authorization
- Never delegate to nas_developer until the implementation plan has been presented to the user and the user has explicitly approved it.
- After any implementation by nas_developer, delegate to nas_qa automatically before reporting completion, summarizing success, or asking for next steps.

### Skill assignment contract

The orchestrator builds the Skill Assignment Contract before delegating to
`nas_planner`. That contract is user-visible when the plan is presented, and it
includes a delegation plan that lists each subagent, the execution order, and
the exact skills assigned to that subagent.

Skill discovery must search repo-local skill sources (`.opencode/skills/`,
`.agents/skills/`, `.claude/skills/`) and runtime/global available skills so
skills like `prompt-optimizer` remain discoverable.

Determine skills from the current task, discovered capabilities, and
user-approved constraints.

Do not inject permanent named-skill defaults into the Skill Assignment
Contract. Task-specific skill assignments stay explicit in the approved
delegation plan.

Delegation prompts and handoffs must echo the exact approved skills for each
subagent.

## Structured handoff extension (compatible)

To preserve compatibility, existing XML contracts stay intact and agents may append a structured handoff block when blocked, at risk, or insufficient progress is present:

```xml
<operational_handoff>
current_progress: [...]
remaining_work: [...]
risks: [...]
recommendation: [CONTINUE | DO_NOT_CONTINUE]
question_for_user: [... or "N/A"]
</operational_handoff>
```

## Skill System

### Discovery

The orchestrator discovers skills from:
1. **Project-level**: `./.opencode/skills/`
2. **Global-level**: `~/.config/opencode/skills/`

### Assignment Contract

```yaml
skill_assignment:
  available_skills:
    - tdd
    - react
    - typescript
  required_by_role:
    researcher: []
    developer: [tdd, typescript]
    qa: []
    orchestrator: []
  missing_skills: []
  critical_missing: []
```

### Skill Validation

- **Orchestrator**: Validates at planning time
- **Developer**: Validates in pre-flight; returns BLOCKED if missing
- **QA**: Validates before testing; returns BLOCKED if can't validate

## Memory Integration

### Backend Priority

1. **Mind**: Primary memory backend via MCP
2. **OpenSpec**: Secondary memory backend via MCP
3. **Engram**: Tertiary memory backend via MCP
4. **claude-mem**: Quaternary memory backend via MCP
5. **Stateless**: Only when no memory backend is available

### Auto-Detection

```yaml
memory_backend: robust_or_stateless
```

In `robust_or_stateless` mode:
- Check backends in priority order: Mind → OpenSpec → Engram → claude-mem
- If a backend is configured/available, agents MUST use it
- Agents MUST NOT fall back to stateless while any backend is configured/available
- If none are available, operate stateless and say so

If any memory backend is configured/available, agents MUST use it and MUST NOT fall back to stateless.

### What Gets Persisted

- Agreement contracts
- Accepted assumptions
- Skill assignments
- Key decisions
- Final approvals

## Permissions Matrix

| Tool | Orchestrator | Researcher | Planner | Developer | QA |
|------|-------------|-----------|---------|----------|-----|
| read | ✓ (`.agents/nas.config.yaml` only) | ✓ | ✓ | ✓ | ✓ |
| write | ✗ | ✗ | ✓ (Gherkin only) | ✓ | ✗ |
| edit | ✗ | ✗ | ✗ | ✓ | ✗ |
| bash | ✗ | Limited read-only | ✗ | ✓ | ✓ |
| webfetch | ✓ | ✓ | ✓ | ✓ | ✓ |
| websearch | ✓ | ✓ | ✓ | ✗ | ✗ |
| task | ✓ (restricted) | ✗ | ✗ | ✗ | ✗ |
| grep/glob | ✗ | ✓ | ✓ | ✓ | ✓ |

### Task Permissions (Orchestrator)

```yaml
permission:
  task:
    "*": deny
    "nas_researcher": allow
    "nas_planner": allow
    "nas_developer": allow
    "nas_qa": allow
```

## Workflow Diagram

```
User Request
     │
     ▼
┌────────────┐
│Clarify     │◄── Questions to user
│Ambiguities │
└─────┬──────┘
      │
      ▼
┌────────────┐
│Delegate to │◄── Researcher investigates exhaustively
│Researcher  │
└─────┬──────┘
      │
      ▼
┌────────────┐
│Delegate to │◄── Planner receives research report
│Planner     │    Designs strategy + Gherkin + tasks
└─────┬──────┘
      │
      ▼
┌────────────┐
│Present     │◄── User reviews plan
│Plan        │
└─────┬──────┘
      │
      ▼
┌────────────┐
│Request     │◄── "Apply now?"
│Authorization│
└─────┬──────┘
      │
   [User says "yes"]
      │
      ▼
┌────────────┐
│Delegate to │◄── With auth metadata
│Developer   │
└─────┬──────┘
      │
      ▼
┌────────────┐
│Implement   │◄── TDD cycle
│(TDD)       │
└─────┬──────┘
      │
      ▼
┌────────────┐
│Delegate to │
│QA          │
└─────┬──────┘
      │
      ▼
   ┌───────┐
   │ QA    │
   │Report │
   └──┬────┘
      │
   [APPROVED]
      │
      ▼
  User notified
```

## Error Handling

### Blocked States

| Agent | Blocked By | Resolution |
|-------|------------|------------|
| Orchestrator | Missing critical skill | Ask user: proceed without skill or wait? |
| Researcher | Insufficient sources or access | Return to orchestrator with partial report |
| Planner | Incomplete research report | Return to orchestrator for re-investigation |
| Developer | No apply authorization | Return to orchestrator for authorization |
| Developer | Missing required skill | Return to orchestrator |
| QA | Can't validate (missing skill/tool) | Return to orchestrator |
| QA | Contradictory requirement | Return to orchestrator |

### Escalation Path

```
Developer ──fix──► QA ──approve──► Orchestrator ──notify──► User
     ▲              │
     │              └──reject──► Developer (fix loop)
     │                              │
     │                    [auto-iterable?]
     │                         │
     │              ┌───────────┴───────────┐
     │              │                       │
     │         [count < 2]              [count >= 2]
     │              │                       │
     │     Auto-iterate               Escalate to User
     │     + inform user
     │
     └──block──► Orchestrator ──clarify──► User
```

### Auto-Iteration Escalation

When QA returns a FAIL verdict:

1. **Auto-iterable categories** (`tests_fail`, `test_insufficiency`, `clean_code_warning`, `skill_violation`, `linter_fail` when configured):
   - If `auto_iteration_count == 0`: re-delegate to developer, then QA for retry 1/2
   - If `auto_iteration_count < 2` and the category matches `last_fail_category`: re-delegate to developer, then QA
   - If `count >= 2` or the category changes: escalate to user

2. **Non-auto-iterable categories** (`scope_creep`, `contract_violation`, `specs_drift`, `same_error`, `other`):
   - Escalate to user immediately

3. **`same_error` timing**: only treat `same_error` as meaningful after at least one completed auto-iteration

4. **On PASS**: reset `auto_iteration_count` to 0 and `last_fail_category` to NONE

## Anti-Hallucination Mechanisms

1. **Explicit Contracts**: Everything in writing (Agreement Contract, Skill Assignment, Gherkin)
2. **Authorization Gates**: No implementation without explicit approval
3. **Three-Layer Validation**: Orchestrator assumptions → Developer pre-flight → QA verification
4. **Pre-Commit Validation**: Tests must actually pass (not claimed)
5. **Scope Enforcement**: No deviation from approved Gherkin
6. **Stateless Awareness**: Reports when memory unavailable (prevents false assumptions)

## Model Trust Tiers and Operational Guidance

### Roles requiring high-compliance

- **Orchestrator** and **nas_developer** should run on a high-compliance model because they enforce authorization gates, permission contracts, and scope boundaries.
- **nas_developer_mini** (experimental) is calibrated for smaller models with conservative posture, explicit escalation, and strong scope discipline. It handles only low-risk top-left L cells of the 2D routing matrix. QA validates mini and full developer paths identically.
- **nas_planner** should run on a high-compliance model for precise specification writing and design decisions.
- **nas_qa** should also prefer a high-compliance model for strict rejection/approval behavior tied to test evidence.

### Recommended behavior for lower-trust models

- A lower-trust model should be limited to non-authoritative support tasks (draft analysis, summarization, optional research notes).
- A lower-trust model must not be the final decision-maker for apply authorization, permission interpretation, or QA approval.
- If a lower-trust model sees denied tools, missing authorization, or contradictory requirements, it should return BLOCKED/escalate instead of inventing workaround paths.

## Best Practices

### For Users

- Be specific in requirements
- Confirm or correct assumptions
- Review Gherkin before approving
- Say "yes" only when ready to apply
- Don't approve new changes just because previous ones were approved

### For Developers Extending Agents

- Never remove authorization gates
- Maintain XML output contracts
- Test locally before committing
- Update CHANGELOG
- Consider impact on other agents
- Document non-obvious behaviors

## References

- [OpenCode Agents Documentation](https://opencode.ai/docs/agents/)
- [OpenCode Permissions](https://opencode.ai/docs/permissions/)
- [OpenCode Skills](https://opencode.ai/docs/skills/)
- [Gherkin Language](https://cucumber.io/docs/gherkin/)
- [Mind Memory](https://github.com/GabrielMartinMoran/mind)
