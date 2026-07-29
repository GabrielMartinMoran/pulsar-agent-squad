#!/usr/bin/env bash
set -euo pipefail

bun run src/cli/index.ts build --target=opencode >/tmp/nas-build-opencode-orchestrator.log

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

# Scenario: Orchestrator can ask at most 3 questions per message
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" 'native `question` tool'
assert_not_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "Ask at most 3 questions per message."

echo "PASS: orchestrator question limit contract checks"
