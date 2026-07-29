#!/usr/bin/env bash
# Contract: root install.sh bootstrap + shared bun-detection helper.
#
# - install.sh exists at repo root and is executable
# - install.sh defaults to the opencode target
# - install.sh delegates to `nas install --target=opencode` (reuse existing flow)
# - A shared bun-detection helper exists at scripts/lib/find-bun.sh
# - Both `nas` (root) and install.sh source the shared helper (single source of truth)
set -euo pipefail

assert_exists() {
  local path="$1"
  if [ ! -e "$path" ]; then
    echo "FAIL: missing $path"
    exit 1
  fi
}

assert_executable() {
  local path="$1"
  if [ ! -x "$path" ]; then
    echo "FAIL: not executable: $path"
    exit 1
  fi
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq -e "$pattern" "$file"; then
    echo "FAIL: '$pattern' not found in $file"
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  if grep -Fq -e "$pattern" "$file"; then
    echo "FAIL: '$pattern' unexpectedly found in $file"
    exit 1
  fi
}

# Scenario: shared bun-detection helper exists and is reusable
assert_exists "scripts/lib/find-bun.sh"
# Helper defines a find_bun shell function.
assert_contains "scripts/lib/find-bun.sh" "find_bun"

# Scenario: `nas` (root launcher) sources the shared helper — no duplicate function body.
# The shared helper is sourced instead of redefining find_bun inline.
assert_exists "nas"
assert_executable "nas"
# Either `nas` sources scripts/lib/find-bun.sh, or it has no duplicate
# find_bun() { ... } body of its own. We allow either pattern, but the
# cleanest contract is: the helper is sourced.
assert_contains "nas" "scripts/lib/find-bun.sh"

# Scenario: root install.sh bootstrap exists and is executable
assert_exists "install.sh"
assert_executable "install.sh"
# install.sh must also source the shared helper
assert_contains "install.sh" "scripts/lib/find-bun.sh"

# Scenario: install.sh defaults to the opencode target
assert_contains "install.sh" "opencode"

# Scenario: install.sh does NOT auto-install bun
assert_not_contains "install.sh" "curl -fsSL https://bun.sh/install"
assert_not_contains "install.sh" "npm install -g bun"
assert_not_contains "install.sh" "brew install bun"

# Scenario: install.sh does NOT auto-edit default_agent (any actual mutation
# would have to write a key=value pair, not just mention the term in a comment)
assert_not_contains "install.sh" "default_agent="
assert_not_contains "install.sh" "opencode.json"

# Scenario: install.sh delegates to `nas install --target=opencode` (reuse existing flow)
assert_contains "install.sh" "nas install"
assert_contains "install.sh" "--target=opencode"

echo "PASS: install.sh + shared bun-helper contract checks"
