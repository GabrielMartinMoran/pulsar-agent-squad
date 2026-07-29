#!/usr/bin/env bash
set -euo pipefail

bun run src/cli/index.ts build --target=opencode >/tmp/nas-build-project-config.log

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq -- "$pattern" "$file"; then
    echo "FAIL: '$pattern' not found in $file"
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  if grep -Fq -- "$pattern" "$file"; then
    echo "FAIL: '$pattern' should NOT be in $file"
    exit 1
  fi
}

# Scenario: Canonical project-space description is aligned everywhere
for file in \
  "src/agents/Nova Agent Squad.md" \
  "README.md" \
  "docs/architecture.md"; do
  assert_contains "$file" ".agents/nas.config.yaml"
  assert_contains "$file" \
    "description: \"Project context, decisions, architecture, and session checkpoints\""
done

# Scenario: Repository config matches the documented contract
assert_contains ".agents/nas.config.yaml" "version: \"1.1\""
assert_contains ".agents/nas.config.yaml" "provider: mind"
assert_contains ".agents/nas.config.yaml" "name: \"projects/nova-agent-squad\""
assert_contains ".agents/nas.config.yaml" "storage_path: \"specs/features\""
assert_contains ".agents/nas.config.yaml" "persist_to_repo:"
assert_contains ".agents/nas.config.yaml" 'when: "on_done"   # always = every planning/replanning pass; on_done = once the plan is finalized/approved before developer execution; never = delegation/output only'
assert_contains ".agents/nas.config.yaml" 'format: "merged"   # merged = canonical full .feature files; delta = reserved/experimental unless separately contracted'
assert_contains ".agents/nas.config.yaml" "include:"
assert_contains ".agents/nas.config.yaml" "exclude:"
assert_contains ".agents/nas.config.yaml" "sdd:"
assert_contains ".agents/nas.config.yaml" "require_confirmation: true"

# Scenario: Gherkin persistence contract is explicit across prompts and docs
assert_contains "src/agents/Nova Agent Squad.md" 'The orchestrator decides whether repository Gherkin persistence happens via `gherkin.persist_to_repo`.'
assert_contains "src/agents/nas_planner.md" 'You are the only agent allowed to author or modify repository `.feature` files.'
assert_contains "src/agents/nas_planner.md" 'Write only repository `*.feature` files'
assert_contains "src/agents/Nova Agent Squad.md" '`when: always` is the lightweight mode for persisted pre-implementation review artifacts.'
assert_contains "src/agents/Nova Agent Squad.md" '`when: on_done` is approval-gated and does NOT persist repo `.feature` files before implementation approval.'
assert_contains "src/agents/nas_planner.md" '`when: always` is the lightweight mode for persisted pre-implementation review artifacts.'
assert_contains "src/agents/nas_planner.md" '`when: on_done` is approval-gated and does NOT persist repo `.feature` files before implementation approval.'
assert_contains "src/agents/nas_developer.md" 'Do NOT write or modify Gherkin feature files — the planner controls repository `.feature` authorship.'
assert_contains "src/agents/nas_qa.md" 'Consume persisted Gherkin read-only. Never author or modify `.feature` files.'
assert_contains "README.md" '`when: always` => planner writes/updates repo feature files on each planning/replanning pass'
assert_contains "README.md" '`when: always` is the lightweight mode for persisted pre-implementation review artifacts.'
assert_contains "README.md" '`when: on_done` => planner writes/updates repo feature files once the plan is finalized/approved for implementation, before developer execution'
assert_contains "README.md" '`when: on_done` is approval-gated and does NOT persist repo `.feature` files before implementation approval.'
assert_contains "README.md" '`when: never` => no repo writes; Gherkin stays in delegation/output only'
assert_contains "README.md" '`format: merged` => persisted files are full canonical `.feature` files for developer and QA consumption'
assert_contains "README.md" '`format: delta` => reserved/experimental unless separately contracted'
assert_contains "docs/architecture.md" '`when: on_done` => planner writes/updates repo feature files once the plan is finalized/approved for implementation, before developer execution'
assert_contains "docs/architecture.md" '`when: always` is the lightweight mode for persisted pre-implementation review artifacts.'
assert_contains "docs/architecture.md" '`when: on_done` is approval-gated and does NOT persist repo `.feature` files before implementation approval.'
assert_contains "docs/architecture.md" '`format: delta` => reserved/experimental unless separately contracted'

# Scenario: Startup halts when config is missing
assert_contains "src/agents/Nova Agent Squad.md" "If config missing"
assert_contains "src/agents/Nova Agent Squad.md" "HALT normal workflow"
assert_contains "src/agents/Nova Agent Squad.md" "authorization to create"
assert_contains "src/agents/Nova Agent Squad.md" "NAS cannot proceed without config"

assert_contains "README.md" "halts"
assert_contains "README.md" "asks for authorization"
assert_contains "README.md" "refuses to proceed without it"

assert_contains "docs/architecture.md" "halt normal workflow"
assert_contains "docs/architecture.md" "authorization to create"
assert_contains "docs/architecture.md" "proceed without it"

# Scenario: Config changes always require explicit confirmation
for file in \
  "src/agents/Nova Agent Squad.md" \
  "README.md" \
  "docs/architecture.md"; do
  assert_contains "$file" "explicit user confirmation"
  assert_contains "$file" "nas_developer"
done

# Scenario: Runtime config propagation stays explicit and minimal
assert_contains "src/agents/Nova Agent Squad.md" \
  'Pass `version`, then `memory`, `mind_spaces`, `gherkin` (only where `enabled: true`)'
assert_contains "src/agents/Nova Agent Squad.md" \
  "Do not pass disabled config blocks unless the task is config editing"

assert_contains "README.md" \
  'When delegating runtime config, pass `version` plus only the enabled'
assert_contains "README.md" \
  '`memory`, `mind_spaces`, and `gherkin` blocks. Do not pass disabled config'
assert_contains "README.md" \
  "blocks unless the task is config editing."

assert_contains "docs/architecture.md" \
  'When delegating runtime config to subagents, pass `version` plus only'
assert_contains "docs/architecture.md" \
  'enabled `memory`, `mind_spaces`, and `gherkin` blocks.'
assert_contains "docs/architecture.md" \
  "Do not pass disabled config blocks unless the task is config editing."

# Scenario: Generated artifact matches the canonical source contract
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" ".agents/nas.config.yaml"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "version: \"1.1\""
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "persist_to_repo:"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" 'The orchestrator decides whether repository Gherkin persistence happens via `gherkin.persist_to_repo`.'
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Do not pass disabled"

# Scenario: Architecture drift is removed
assert_not_contains "docs/architecture.md" "version: \"1.2\""
assert_not_contains "docs/architecture.md" \
  'description: "Project context, decisions, and session checkpoints"'

# Scenario: Default quality gate runs contract tests via nas test
# nas test reads all .sh files from tests/ dynamically
assert_contains "src/cli/commands/test.ts" "testDir = 'tests'"
assert_contains "src/cli/commands/test.ts" "endsWith('.sh')"
assert_contains "src/cli/commands/test.ts" "spawnSync"

echo "PASS: project config contract checks"
