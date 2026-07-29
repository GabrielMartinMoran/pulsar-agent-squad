#!/usr/bin/env bash
set -euo pipefail

bun run src/cli/index.ts build --target=opencode >/tmp/nas-build-opencode-memory.log

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq -- "$pattern" "$file"; then
    echo "FAIL: '$pattern' not found in $file"
    exit 1
  fi
}

# Scenario: Orchestrator memory backend priority includes OpenSpec before stateless fallback
assert_contains "src/agents/Nova Agent Squad.md" "- memory_backend: robust_or_stateless"
assert_contains "src/agents/Nova Agent Squad.md" "- Mind tools via MCP"
assert_contains "src/agents/Nova Agent Squad.md" "- OpenSpec via MCP"
assert_contains "src/agents/Nova Agent Squad.md" "- Engram via MCP"
assert_contains "src/agents/Nova Agent Squad.md" "- claude-mem via MCP"
assert_contains "src/agents/Nova Agent Squad.md" "- Stateless only if no memory backend is available"
assert_contains "src/agents/Nova Agent Squad.md" "if any memory backend is configured/available, agent MUST use it and MUST NOT fall back to stateless"

# Scenario: Built OpenCode artifact mirrors orchestrator memory policy
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "- OpenSpec via MCP"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "- Stateless only if no memory backend is available"
assert_contains "dist/platforms/opencode/agents/Nova Agent Squad.md" "if any memory backend is configured/available, agent MUST use it and MUST NOT fall back to stateless"

# Scenario: Architecture docs codify same backend priority and non-negotiable usage rule
assert_contains "docs/architecture.md" "1. **Mind**: Primary memory backend via MCP"
assert_contains "docs/architecture.md" "2. **OpenSpec**: Secondary memory backend via MCP"
assert_contains "docs/architecture.md" "3. **Engram**: Tertiary memory backend via MCP"
assert_contains "docs/architecture.md" "4. **claude-mem**: Quaternary memory backend via MCP"
assert_contains "docs/architecture.md" "5. **Stateless**: Only when no memory backend is available"
assert_contains "docs/architecture.md" "If any memory backend is configured/available, agents MUST use it and MUST NOT fall back to stateless."

# Scenario: README mirrors memory policy at feature overview level
assert_contains "README.md" "- **Mind** (MCP)"
assert_contains "README.md" "- **OpenSpec** (MCP)"
assert_contains "README.md" "- **Engram** (MCP)"
assert_contains "README.md" "- **claude-mem** (MCP)"
assert_contains "README.md" "- **Stateless** only when no memory backend is available"
assert_contains "README.md" "If any memory backend is configured/available, agents MUST use it and MUST NOT fall back to stateless."

echo "PASS: memory policy contract checks"
