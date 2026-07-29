#!/usr/bin/env bash
set -euo pipefail

assert_contains() {
  local file="$1"
  local pattern="$2"
  local desc="${3:-'$pattern' not found in $file}"
  if ! grep -Fq "$pattern" "$file"; then
    echo "FAIL: $desc"
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  local desc="${3:-'$pattern' should not be present in $file}"
  if grep -Fq "$pattern" "$file"; then
    echo "FAIL: $desc"
    exit 1
  fi
}

echo "Checking developer prompt remediation..."
assert_contains "src/agents/nas_developer.md" "## Pre-flight checklist (STOP if any answer is NO)" "Developer pre-flight checklist heading missing"
assert_contains "src/agents/nas_developer.md" "## Tool Guidance" "Developer tool guidance section missing"
assert_contains "src/agents/nas_developer.md" "<skill_application>" "Developer skill_application block missing"
assert_contains "src/agents/nas_developer.md" "tests/users/register.test.ts" "Developer example should be stack-consistent"
assert_not_contains "src/agents/nas_developer.md" "test_user_registration.py" "Developer few-shot should not mix Python tests with TypeScript source"

echo "Checking researcher prompt quality contract..."
assert_contains "src/agents/nas_researcher.md" "## Tool guidance" "Researcher tool guidance section missing"
assert_contains "src/agents/nas_researcher.md" '| `bash` | Read-only shell inspection' "Researcher bash guidance missing"
assert_contains "src/agents/nas_researcher.md" "Limited bash access does not relax the read-only rule." "Researcher read-only clarification missing"
assert_contains "src/agents/nas_researcher.md" "## Few-shot example" "Researcher few-shot example heading missing"
assert_contains "src/agents/nas_researcher.md" "<research_report>" "Researcher few-shot output missing"

echo "Checking planner prompt quality contract..."
assert_contains "src/agents/nas_planner.md" "## Tool Guidance" "Planner tool guidance section missing"
assert_contains "src/agents/nas_planner.md" "## Few-shot example" "Planner few-shot example heading missing"
assert_contains "src/agents/nas_planner.md" "<planning_output>" "Planner few-shot output missing"

echo "PASS: prompt quality contract checks"
