#!/usr/bin/env bash
set -euo pipefail

bun run src/cli/index.ts build --target=opencode >/tmp/nas-build-opencode-rename.log

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

# Scenario 1: Agent files are fully renamed
assert_exists "dist/platforms/opencode/agents/Nova Agent Squad.md"
assert_exists "dist/platforms/opencode/agents/nas_researcher.md"
assert_exists "dist/platforms/opencode/agents/nas_developer.md"
assert_exists "dist/platforms/opencode/agents/nas_qa.md"

# Scenario 2: Primary agent permissions and workflow references use nas_* IDs
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" '"nas_researcher": allow'
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" '"nas_developer": allow'
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" '"nas_qa": allow'
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "invoke nas_developer"

# Scenario 3: CLI uses Nova Agent Squad branding and nas_* IDs
assert_contains "src/cli/index.ts" "Nova Agent Squad CLI"
assert_contains "src/cli/commands/uninstall.ts" "nas_researcher.md"
assert_contains "src/cli/commands/uninstall.ts" "nas_developer.md"
assert_contains "src/cli/commands/uninstall.ts" "nas_qa.md"

# Scenario 4: Core documentation uses Nova Agent Squad and nas_* IDs
assert_contains "README.md" "Nova Agent Squad"
assert_contains "docs/architecture.md" "Nova Agent Squad"
assert_contains "docs/AGENTS.md" "Nova Agent Squad"
assert_contains "CHANGELOG.md" "Nova Agent Squad"
assert_contains "CONTRIBUTING.md" "Nova Agent Squad"

echo "PASS: rename Nova + NAS contract checks"
