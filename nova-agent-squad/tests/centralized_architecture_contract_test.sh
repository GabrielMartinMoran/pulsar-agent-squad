#!/usr/bin/env bash
set -euo pipefail

assert_exists() {
  local path="$1"
  if [ ! -e "$path" ]; then
    echo "FAIL: missing $path"
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

assert_not_exists() {
  local path="$1"
  if [ -e "$path" ]; then
    echo "FAIL: unexpected legacy artifact $path"
    exit 1
  fi
}

# Scenario: source-of-truth central exists (OpenCode canon + templates + manifest)
assert_exists "src/agents/Nova Agent Squad.md"
assert_exists "src/agents/nas_researcher.md"
assert_exists "src/agents/nas_planner.md"
assert_exists "src/agents/nas_developer.md"
assert_exists "src/agents/nas_qa.md"
assert_exists "src/templates/platforms/cursor/AGENTS.md.tmpl"
assert_exists "src/templates/platforms/codex/AGENTS.md.tmpl"
assert_exists "src/templates/platforms/kiro/AGENTS.md.tmpl"
assert_exists "src/templates/platforms/gemini-cli/AGENTS.md.tmpl"
assert_exists "src/templates/platforms/claude-code/CLAUDE.md.tmpl"
assert_exists "src/templates/platforms/vscode/nas.instructions.md.tmpl"
assert_exists "config/platforms.manifest"

# Scenario: build by target emits expected outputs under dist/
bun run src/cli/index.ts build --target=opencode >/tmp/nas-build-opencode.log
assert_exists "dist/platforms/opencode/agents/Nova Agent Squad.md"
assert_exists "dist/platforms/opencode/agents/nas_researcher.md"
assert_exists "dist/platforms/opencode/agents/nas_planner.md"
assert_exists "dist/platforms/opencode/agents/nas_developer.md"
assert_exists "dist/platforms/opencode/agents/nas_qa.md"

bun run src/cli/index.ts build --target=cursor >/tmp/nas-build-cursor.log
assert_exists "dist/platforms/cursor/AGENTS.md"
assert_contains "dist/platforms/cursor/AGENTS.md" "nas_orchestrator"
assert_contains "dist/platforms/cursor/AGENTS.md" "nas_researcher"
assert_contains "dist/platforms/cursor/AGENTS.md" "nas_planner"
assert_contains "dist/platforms/cursor/AGENTS.md" "nas_developer"
assert_contains "dist/platforms/cursor/AGENTS.md" "nas_qa"

# Scenario: install by target resolves destination from central manifest and supports dry-run
install_output="$(bun run src/cli/index.ts install --target=cursor --dry-run --destdir=/tmp/nas-contract-test 2>&1)"
echo "$install_output" | grep -Fq "DRY-RUN"
echo "$install_output" | grep -Fq "/tmp/nas-contract-test/.cursor/agents"

# Scenario: OpenCode remains canonical install flow
opencode_install_output="$(bun run src/cli/index.ts install --target=opencode --dry-run --destdir=/tmp/nas-contract-test 2>&1)"
echo "$opencode_install_output" | grep -Fq "/tmp/nas-contract-test/.config/opencode/agents"

# Scenario: legacy per-platform source artifacts were removed from repo
assert_not_exists ".cursor/agents"
assert_not_exists ".gemini/agents"
assert_not_exists ".kiro/agents"
assert_not_exists ".codex/agents"

echo "PASS: centralized architecture contract checks"
