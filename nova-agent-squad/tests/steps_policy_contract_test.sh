#!/usr/bin/env bash
set -euo pipefail

bun run src/cli/index.ts build --target=opencode >/tmp/nas-build-opencode-steps.log

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

# Scenario: Frontmatter no longer uses step limits
assert_not_contains "dist/platforms/opencode/agents/nas_researcher.md" "steps:"
assert_not_contains "dist/platforms/opencode/agents/nas_planner.md" "steps:"
assert_not_contains "dist/platforms/opencode/agents/nas_developer.md" "steps:"
assert_not_contains "dist/platforms/opencode/agents/nas_qa.md" "steps:"
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "steps:"

for file in \
  "dist/platforms/opencode/agents/nas_researcher.md" \
  "dist/platforms/opencode/agents/nas_planner.md" \
  "dist/platforms/opencode/agents/nas_developer.md" \
  "dist/platforms/opencode/agents/nas_qa.md"
do
  # Scenario: All step-threshold language was removed
  assert_not_contains "$file" "STEP CONTROL POLICY"
  assert_not_contains "$file" "<=10: standard"
  assert_not_contains "$file" ">=20: complex task; evaluate closeness to completion"
  assert_not_contains "$file" ">=27: mandatory decision: close if near completion or handoff to orchestrator if substantial work remains"
  assert_not_contains "$file" "hard cap"
  assert_not_contains "$file" "soft thresholds"

  # Scenario: Handoff remains and is condition-based
  assert_contains "$file" "blocked, at risk, or insufficient progress"
  assert_not_contains "$file" "blocked, risk, or insufficient progress"
  # Scenario: Mandatory handoff format to orchestrator
  assert_contains "$file" "current_progress"
  assert_contains "$file" "remaining_work"
  assert_contains "$file" "risks"
  assert_contains "$file" "recommendation: [CONTINUE | DO_NOT_CONTINUE]"
  assert_contains "$file" "question_for_user"
done

# Scenario: Documentation alignment
assert_not_contains "docs/AGENTS.md" "hard cap"
assert_not_contains "docs/AGENTS.md" "soft thresholds"
assert_not_contains "docs/AGENTS.md" "<=10"
assert_not_contains "docs/AGENTS.md" ">=20"
assert_not_contains "docs/AGENTS.md" ">=27"
assert_contains "docs/AGENTS.md" "handoff"
assert_contains "docs/AGENTS.md" "blocked, at risk, or insufficient progress"
assert_not_contains "docs/AGENTS.md" "blocked, risk, or insufficient progress"

assert_not_contains "docs/architecture.md" "hard cap"
assert_not_contains "docs/architecture.md" "soft thresholds"
assert_not_contains "docs/architecture.md" "<=10"
assert_not_contains "docs/architecture.md" ">=20"
assert_not_contains "docs/architecture.md" ">=27"
assert_contains "docs/architecture.md" "handoff"
assert_contains "docs/architecture.md" "blocked, at risk, or insufficient progress"
assert_not_contains "docs/architecture.md" "blocked, risk, or insufficient progress"

assert_not_contains "README.md" "hard cap"
assert_not_contains "README.md" "soft thresholds"
assert_not_contains "README.md" "<=10"
assert_not_contains "README.md" ">=20"
assert_not_contains "README.md" ">=27"
assert_contains "README.md" "handoff"
assert_contains "README.md" "blocked, at risk, or insufficient progress"
assert_not_contains "README.md" "blocked, risk, or insufficient progress"

echo "PASS: operational handoff policy contract checks"
