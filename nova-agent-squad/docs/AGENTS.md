# Agent Versioning and Maintenance Guide

This document describes how to version, maintain, and update the Nova Agent Squad agents.

## Versioning Scheme

Nova Agent Squad follows **Semantic Versioning** (SemVer):

- **MAJOR**: Breaking changes to agent behavior, permission changes, or removal of features
- **MINOR**: New features, additional rules, or backward-compatible behavior changes
- **PATCH**: Bug fixes, documentation updates, minor clarifications

### Version Location

The current version is documented in:
- `CHANGELOG.md` (human-readable history)
- Agent frontmatter (optional, for future tooling)

## Versioning Workflow

### Before Making Changes

1. **Assess impact**: Will this change how the agent behaves?
2. **Test locally**: Copy agents to your OpenCode config and verify
3. **Check dependencies**: Does this affect other agents?

### Making Changes

1. Update the relevant agent `.md` file
2. Test the change locally
3. Update `CHANGELOG.md`:
   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Changed
   - Description of what changed
   ```
4. Commit with conventional message:
   ```bash
   git commit -m "feat: description of change"
   ```

### Release Process

1. Ensure all changes are committed
2. Update `CHANGELOG.md` with release version
3. Tag the release:
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin main --tags
   ```

## Agent File Structure

Each agent is a Markdown file with YAML frontmatter:

```markdown
---
description: Agent description
mode: primary|subagent
temperature: 0.1
permission:
  edit: deny|allow
  bash: deny|allow
  webfetch: allow|deny
  task:
    "*": deny
    "agent-name": allow
---

[Agent prompt content...]
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | Human-readable description for agent list |
| `mode` | Yes | `primary` or `subagent` |
| `hidden` | No | Hide from `@` autocomplete (subagents only) |
| `temperature` | No | Model temperature (default varies by model) |
| `permission` | No | Tool-specific permissions |
| `default_agent` | No | For primary agents, sets default |

## Operational Policy: condition-based handoff

For `nas_researcher`, `nas_planner`, `nas_developer`, and `nas_qa`:

- Handoff triggers are condition-based: **blocked, at risk, or insufficient progress**.

### Structured handoff (compatible contract extension)

Existing XML tags must remain unchanged. If operational handoff is needed, agents append:

```xml
<operational_handoff>
current_progress: [...]
remaining_work: [...]
risks: [...]
recommendation: [CONTINUE | DO_NOT_CONTINUE]
question_for_user: [... or "N/A"]
</operational_handoff>
```

## Common Update Patterns

## Planning Confirmation Policy (Hybrid)

When updating the orchestrator prompt, keep this behavior aligned with docs and tests:

- In planning, confirm only scope changes or critical assumptions.
- Do not ask confirmation for minor analysis/spec steps.
- Keep the apply gate question exact: "Implementation plan is ready. Do you want me to apply it now?"
- Keep single-use authorization per scope and never auto-approve new scopes.
- Never delegate to `nas_developer` until the implementation plan has been presented to the user and explicitly approved.
- After any implementation, delegate to `nas_qa` automatically before reporting completion or asking for next steps.
- Do not ask whether QA should run. QA is mandatory and automatic after implementation.
- Build the Skill Assignment Contract — which skills are relevant, which subagent needs them — before delegating to `nas_planner`.
- Present a delegation plan to the user that lists each subagent, execution order, and exact approved skills.
- Use a task-specific skill assignment contract for every approved plan.
- Search repo-local and runtime/global skills so `prompt-optimizer` remains discoverable.
- Echo the exact approved skills in delegation prompts and handoffs.
- Determine skills from the current task, discovered capabilities, and user-approved constraints.
- Do not inject permanent named-skill defaults into the Skill Assignment Contract.
- Keep task-specific skill assignments explicit in the approved delegation plan.
- **Planning Quality Gate**: validate non-empty planner output and critical sections before presentation; retry once with missing items; on second failure escalate and do not claim readiness.
- **Turn boundary**: the plan presentation is the final response for that turn; do not issue the native `question` tool, `ask` tool, or any interactive prompt in the same turn; wait for the user's next message.

## Gherkin persistence contract

Keep Gherkin persistence rules aligned across prompts, docs, config comments, and
tests.

- The orchestrator decides whether repository Gherkin persistence happens via `gherkin.persist_to_repo`.
- The planner is the only agent allowed to author or modify repository `.feature` files.
- For OpenCode, planner write permissions use `permission.edit` with a `*.feature` allowlist. Do not use `permission.write`.
- Developer and QA consume persisted Gherkin read-only.
- QA remains mandatory before completion.
- `when: always` => planner writes/updates repo feature files on each planning/replanning pass
- `when: on_done` => planner writes/updates repo feature files once the plan is finalized/approved for implementation, before developer execution
- `when: always` is the lightweight mode for persisted pre-implementation review artifacts.
- `when: on_done` is approval-gated and does NOT persist repo `.feature` files before implementation approval.
- `when: never` => no repo writes; Gherkin stays in delegation/output only
- `format: merged` => persisted files are full canonical `.feature` files for developer and QA consumption
- `format: delta` => reserved/experimental unless separately contracted

### Adding a New Rule

1. Identify the appropriate agent
2. Add rule to the prompt in the correct section
3. Test locally
4. Update CHANGELOG as MINOR or PATCH depending on impact

Example:
```markdown
### ADDED RULE
- New rule description here
```

### Changing Permissions

1. Update the `permission` section in frontmatter
2. Test that the agent still functions
3. Update CHANGELOG as MAJOR if this breaks workflows

### Adding a New Agent

1. Create new `.md` file in `.opencode/agents/`
2. Add appropriate frontmatter
3. Update README.md to document the new agent
4. Update CHANGELOG as MINOR
5. Update this guide if workflow changes

## Best Practices

### Do

- Test changes locally before committing
- Use clear, specific descriptions in prompts
- Maintain XML output contracts (they're used by other agents)
- Keep prompts focused on single responsibilities
- Document non-obvious behaviors

### Don't

- Remove authorization gates without MAJOR version bump
- Change XML tag names (breaks agent communication)
- Make changes without testing first
- Forget to update CHANGELOG

## Agent Communication Contracts

Agents communicate using structured XML tags:

### Orchestrator → User
```xml
<analysis>
(Reasoning...)
</analysis>
(Direct response...)
```

### Orchestrator → Researcher
Delegation via Task tool with context

### Researcher → Orchestrator
```xml
<research_report>
<feasibility>(Summary...)</feasibility>
<codebase_findings>(Files, patterns found...)</codebase_findings>
<external_findings>(Docs, APIs, best practices...)</external_findings>
<impacted_areas>(Files and modules...)</impacted_areas>
<risks>(Risk descriptions...)</risks>
<sources_consulted>(All sources investigated...)</sources_consulted>
</research_report>
```

### Orchestrator → Planner
Delegation via Task tool with research report + original request

### Planner → Orchestrator
```xml
<planning_output>
<feasibility>(Verdict...)</feasibility>
<approach>(Technical strategy...)</approach>
<gherkin>Feature: ...</gherkin>
<implementation_tasks>(Ordered steps...)</implementation_tasks>
</planning_output>
```

### Developer → QA (via output)
```xml
<tdd_cycle>
Phase: [Red|Green|Refactor|Linting|Integration]
Action: [Description]
</tdd_cycle>
```

### QA → Orchestrator
```xml
<qa_status>
Status: [APPROVED|REJECTED|BLOCKED]
</qa_status>
<fail_category>NONE|tests_fail|test_insufficiency|clean_code_warning|scope_creep|contract_violation|skill_violation|linter_fail|specs_drift|same_error|other</fail_category>
<validation_details>
(Checks performed...)
</validation_details>
<required_action>
(Next steps...)
</required_action>
```

## Auto-Iteration System

Nova Agent Squad supports automatic iteration on certain failure categories to improve efficiency.

### Fail Categories

| Category | Description | Auto-Iterable? |
|----------|-------------|----------------|
| `tests_fail` | Test suite fails | Yes |
| `test_insufficiency` | Gherkin/function/path/edge case coverage insufficient | Yes |
| `clean_code_warning` | Linter/clean-code warnings present | Yes |
| `scope_creep` | Files modified outside approved contract | No |
| `contract_violation` | Implementation violates contract terms | No |
| `skill_violation` | Skill mandamentos not followed in implementation | Yes |
| `linter_fail` | Linter/formatter configured and failed | Yes (if configured) |
| `specs_drift` | Specs/features/*.feature out of sync with implementation | No |
| `same_error` | Identical issue persists after iteration | No |
| `other` | Unclassified failure | No |

### Auto-Iteration Rules

1. **Max iterations**: 2 auto-iterations maximum before forced escalation
2. **Same error detection**: If the same `fail_category` persists after 2 iterations, escalate immediately
3. **Orchestrator coordination**: The orchestrator tracks `auto_iteration_count` and `last_fail_category` in checkpoints
4. **No consent required**: Auto-iterable failures do NOT require user consent — the orchestrator informs the user
5. **Linter special case**: `linter_fail` is auto-iterable only if a linter is configured; if no linter exists, it becomes a WARNING (recommendation only) rather than a blocker
6. **First retry guarantee**: The first auto-iterable QA FAIL always triggers retry 1/2
7. **`same_error` timing**: Treat `same_error` as meaningful only after at least one completed auto-iteration

### Category-Specific Notes

- **`skill_violation`**: QA validates skill mandamentos conceptually; violations are auto-iterable
- **`linter_fail`**: If linter is configured → auto-iterable; if no linter → WARNING with recommendation
- **`specs_drift`**: NOT auto-iterable — requires human decision (escalate to user) or planner re-delegation

### User Notifications

- **Auto-iteration**: "Automatically retrying after QA failure in [category] (retry N/2)."
- **Forced escalation (max)**: "Maximum auto-iterations reached (2/2) — escalating to the user."
- **Category changed**: "QA failure category changed from [last_category] to [category]. This may indicate a different issue than the one being auto-iterated, so I’m escalating to you instead of retrying automatically."
- **Pattern detected**: "Repeated QA failure pattern detected after retry 2/2 — escalating to the user."

## Troubleshooting

### Agent not being picked up

1. Check file is in `~/.config/opencode/agents/` (global) or `.opencode/agents/` (project)
2. Verify YAML frontmatter is valid
3. Restart OpenCode

### Permission issues

1. Check `permission` section in frontmatter
2. Ensure syntax is correct YAML
3. Test with minimal permissions first

### Agent behaving unexpectedly

1. Review prompt for conflicting instructions
2. Check temperature and steps settings
3. Test with reduced complexity

## References

- [OpenCode Agents Documentation](https://opencode.ai/docs/agents/)
- [OpenCode Permissions](https://opencode.ai/docs/permissions/)
- [Keep a Changelog](https://keepachangelog.com/)
- [Semantic Versioning](https://semver.org/)
