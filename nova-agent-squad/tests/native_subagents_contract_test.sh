#!/usr/bin/env bash
set -euo pipefail

assert_exists() {
  local path="$1"
  if [ ! -e "$path" ]; then
    echo "FAIL: missing $path"
    exit 1
  fi
}

assert_not_exists() {
  local path="$1"
  if [ -e "$path" ]; then
    echo "FAIL: unexpected $path"
    exit 1
  fi
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq "$pattern" "$file"; then
    echo "FAIL: '$pattern' not found in $file"
    exit 1
  fi
}

# Scenario: Native NAS subagents are generated in dist templates, not stored as legacy per-platform sources
assert_exists "dist/platforms/cursor/AGENTS.md"
assert_exists "dist/platforms/gemini-cli/AGENTS.md"
assert_exists "dist/platforms/kiro/AGENTS.md"
assert_exists "dist/platforms/codex/AGENTS.md"
assert_not_exists ".cursor/agents"
assert_not_exists ".gemini/agents"
assert_not_exists ".kiro/agents"
assert_not_exists ".codex/agents"

# Scenario: Installation matrix reflects experimental flags and Kiro CLI row
assert_contains "docs/installation-matrix.md" "Gemini CLI"
assert_contains "docs/installation-matrix.md" "experimental.enableAgents"
assert_contains "docs/installation-matrix.md" "Codex"
assert_contains "docs/installation-matrix.md" "Experimental"
assert_contains "docs/installation-matrix.md" "Kiro IDE"
assert_contains "docs/installation-matrix.md" "Kiro CLI"
assert_contains "docs/installation-matrix.md" "runtime subagent"

# Scenario: README documents centralized source/build/install flow and platform prerequisites
assert_contains "README.md" "src/agents"
assert_contains "README.md" "config/platforms.manifest"
assert_contains "README.md" "nas build"
assert_contains "README.md" "nas install --target=opencode"
assert_contains "README.md" "experimental.enableAgents"
assert_contains "README.md" "Kiro CLI"

echo "PASS: native subagents contract checks"
