#!/usr/bin/env bash
set -euo pipefail

bun run src/cli/index.ts build --target=opencode >/tmp/nas-build-opencode-hybrid.log

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq "$pattern" "$file"; then
    echo "FAIL: '$pattern' not found in $file"
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  if grep -Fq "$pattern" "$file"; then
    echo "FAIL: '$pattern' should not be present in $file"
    exit 1
  fi
}

# Scenario: Planning without unnecessary confirmations
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "In planning: confirm only scope changes or critical assumptions."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Do not ask for confirmation for minor analysis/spec steps."

# Scenario: Confirmation on scope change
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Must ask for explicit user confirmation when scope changes from the approved contract."

# Scenario: Confirmation on critical assumption
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Must ask for explicit user confirmation for any critical assumption before delegating implementation."

# Scenario: Exact mandatory apply gate
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Implementation plan is ready. Do you want me to apply it now?"
assert_contains "README.md" "Implementation plan is ready. Do you want me to apply it now?"
assert_contains "docs/architecture.md" "Implementation plan is ready. Do you want me to apply it now?"

# Scenario: Block without explicit approval
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Only after a clear affirmative answer can you invoke nas_developer or nas_developer_mini."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Prior approvals from earlier in the same conversation do NOT auto-authorize new changes."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Never delegate to nas_developer or nas_developer_mini until the implementation plan has been presented to the user and the user has explicitly approved it."

# Scenario: Skill assignment contract step is fused and canonical before planner delegation
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Build the Skill Assignment Contract — which skills are relevant, which subagent needs them — before delegating to nas_planner."
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "4. **Build the Skill Assignment Contract before delegating to nas_planner.**"

# Scenario: User-visible delegation plan includes exact per-subagent skills
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Delegation order with exact approved skills"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Determine skills from the current task, discovered capabilities, and user-approved constraints."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Do not inject permanent named-skill defaults into the Skill Assignment Contract."
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "nas_planner → [prompt-optimizer]"
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "nas_developer → [prompt-optimizer]"
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "nas_developer → [prompt-optimizer, docs-writer]"

# Scenario: Skill discovery includes repo-local and runtime/global sources
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Search repo-local skill sources (.opencode/skills/, .agents/skills/, .claude/skills/) and runtime/global available skills."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Delegation prompts and handoffs must echo the exact approved skills for each subagent."

# Scenario: Authorization and confirmation policy is canonical and non-duplicated
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "## Authorization and confirmation policy"
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "## Authorization Gates"
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "## Confirmation Policy"

# Scenario: First auto-iterable QA failure triggers retry 1/2
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "The first auto-iterable QA FAIL must trigger retry 1/2."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" '`same_error` detection only applies after at least one completed auto-iteration.'
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Automatically retrying after QA failure in [category] (retry N/2)."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Maximum auto-iterations reached (2/2) — escalating to the user."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "QA failure category changed from [last_category] to [category]. This may indicate a different issue than the one being auto-iterated, so I’m escalating to you instead of retrying automatically."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Repeated QA failure pattern detected after retry 2/2 — escalating to the user."
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Auto-iterando en [category]... (iteration N/2)"
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Máximo de iteraciones alcanzado (2/2) — escalando"
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Patrón detectado: mismo issue tras 2 iteraciones — escalando"
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "QA failure category changed from [last_category] to [category] — escalating to the user."

# Scenario: QA is mandatory and automatic after implementation
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "After any implementation (full or mini), delegate to nas_qa automatically before reporting completion, summarizing success, or asking for next steps."
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Do not ask whether QA should run. QA is mandatory and automatic after implementation."

# Documentation alignment
assert_contains "README.md" "confirm only scope changes"
assert_contains "docs/architecture.md" "confirm only scope changes or critical assumptions"
assert_contains "docs/AGENTS.md" "confirm only scope changes or critical assumptions"
assert_contains "README.md" "delegation plan"
assert_contains "README.md" "Do not ask whether QA should run"
assert_contains "README.md" "task-specific skill assignment contract"
assert_not_contains "README.md" "For prompt and instruction changes, the default delegation plan uses"
assert_contains "docs/architecture.md" "delegation plan"
assert_contains "docs/architecture.md" "Do not ask whether QA should run"
assert_contains "docs/architecture.md" "Do not inject permanent named-skill defaults into the Skill Assignment"
assert_contains "docs/architecture.md" "QA failure category changed from [last_category] to [category]. This may indicate a different issue than the one being auto-iterated, so I’m escalating to you instead of retrying automatically."
assert_not_contains "docs/architecture.md" "For prompt and instruction changes, the default approved assignments are:"
assert_contains "docs/AGENTS.md" "delegation plan"
assert_contains "docs/AGENTS.md" "Do not ask whether QA should run"
assert_contains "docs/AGENTS.md" "task-specific skill assignment contract"
assert_contains "docs/AGENTS.md" "QA failure category changed from [last_category] to [category]. This may indicate a different issue than the one being auto-iterated, so I’m escalating to you instead of retrying automatically."
assert_not_contains "docs/AGENTS.md" 'For prompt and instruction changes, assign `prompt-optimizer` to `nas_planner` and `nas_developer`.'

# === FEAT-009: orchestrator plan handoff hardening ===

# Scenario: Planning Quality Gate exists in orchestrator prompt and docs
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Planning Quality Gate"
assert_contains "docs/architecture.md" "Planning Quality Gate"
assert_contains "docs/AGENTS.md" "Planning Quality Gate"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Planner output is non-empty"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "retry once with missing items"

# Scenario: Conversion-to-final-response wording — step 9 replaces lossy summarize
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "planner output into a complete user-facing final response"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "out-of-scope"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "key technical decisions"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Impacted files and contracts"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Gherkin acceptance scenarios"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "TDD phases and ordered implementation tasks"

# Scenario: Turn boundary — plan presentation is the final response for that turn
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Do not call the native"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "plan presentation is the final response for that turn"

# Scenario: Empty/incomplete retry + escalation
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "retry once with missing items"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "report the blocker"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "do not claim readiness or ask approval"

# Scenario: Raw XML prohibition
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Raw XML tags"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "never shown to the user"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "formatted as user-facing Markdown prose"

# Scenario: docs alignment — README reflects Planning Quality Gate + turn boundary
assert_contains "README.md" "Planning Quality Gate"
assert_contains "README.md" "planning quality gate"
assert_contains "README.md" "turn boundary"
assert_contains "README.md" "nine user-facing sections"

# Scenario: docs alignment — architecture reflects Planning Quality Gate + Three-Layer Guard update
assert_contains "docs/architecture.md" "Layer 1: Orchestrator Gate (including Planning Quality Gate)"

# Scenario: docs alignment — AGENTS.md Planning Confirmation Policy reflects Planning Quality Gate + no same-turn question
assert_contains "docs/AGENTS.md" "Planning Quality Gate"
assert_contains "docs/AGENTS.md" "do not issue the native"
assert_contains "docs/AGENTS.md" "plan presentation is the final response for that turn"

echo "PASS: hybrid confirmations contract checks"
