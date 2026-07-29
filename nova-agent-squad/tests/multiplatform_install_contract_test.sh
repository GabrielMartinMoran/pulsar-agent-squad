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

# Scenario: Approved platform guide/matrix exists
assert_exists "docs/installation-matrix.md"
for platform in \
  "OpenCode" \
  "Cursor" \
  "Cursor CLI Agent" \
  "Claude Code" \
  "Codex" \
  "Gemini CLI" \
  "Kiro" \
  "VS Code"
do
  assert_contains "docs/installation-matrix.md" "$platform"
done

# Scenario: Artifacts or templates per platform
assert_exists "dist/platforms/opencode"
assert_exists "dist/platforms/cursor"
assert_exists "dist/platforms/cursor-cli-agent"
assert_exists "dist/platforms/claude-code"
assert_exists "dist/platforms/codex"
assert_exists "dist/platforms/gemini-cli"
assert_exists "dist/platforms/kiro"
assert_exists "dist/platforms/vscode"

# Scenario: OpenCode documents why it does not use a file-based template
assert_exists "src/templates/platforms/opencode/README.md"
assert_contains "src/templates/platforms/opencode/README.md" "kind=dir"
assert_contains "src/templates/platforms/opencode/README.md" "src/agents"

# Scenario: Antigravity is temporarily not viable + reason
assert_contains "docs/installation-matrix.md" "Antigravity"
assert_contains "docs/installation-matrix.md" "Temporarily not viable"
assert_contains "docs/installation-matrix.md" "no verifiable technical documentation"

# Scenario: OpenCode without regressions in the main installation path
assert_contains "README.md" "nas install --target=opencode"
assert_contains "src/cli/commands/install.ts" "resolveDest"

echo "PASS: multiplatform installation contract checks"
