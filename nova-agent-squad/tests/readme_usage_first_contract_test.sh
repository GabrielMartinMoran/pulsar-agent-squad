#!/usr/bin/env bash
# Contract: README is structured for humans — usage first, maintenance later,
# and includes install + update guidance.
#
# This is a regression test for the human-first README restructure.
set -euo pipefail

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq "$pattern" "$file"; then
    echo "FAIL: '$pattern' not found in $file"
    exit 1
  fi
}

assert_section_before() {
  # Assert that section $1 appears in README.md before section $2
  local first="$1"
  local second="$2"
  local first_line
  local second_line
  first_line="$(grep -n -F "$first" README.md | head -1 | cut -d: -f1 || true)"
  second_line="$(grep -n -F "$second" README.md | head -1 | cut -d: -f1 || true)"
  if [ -z "$first_line" ] || [ -z "$second_line" ]; then
    echo "FAIL: missing section '$first' or '$second' in README.md"
    exit 1
  fi
  if [ "$first_line" -ge "$second_line" ]; then
    echo "FAIL: '$first' must appear before '$second' in README.md (got lines $first_line vs $second_line)"
    exit 1
  fi
}

# Scenario: README has human-first install guidance
assert_contains "README.md" "./install.sh"
assert_contains "README.md" "nas install"

# Scenario: README documents the new `nas update` workflow
assert_contains "README.md" "nas update"

# Scenario: README has an explicit Updating section
assert_contains "README.md" "## Updating"

# Scenario: Usage-first structure — Quick Start appears before
# Architecture and before maintenance sections.
assert_section_before "## Quick Start" "## Architecture"
assert_section_before "## Updating" "## Architecture"

# Scenario: README does not lead with raw make/build references
# (Makefile is removed; no `make` install instructions should appear in the Quick Start path)
if grep -nE "^make (install|build)" README.md; then
  echo "FAIL: README still references 'make install|build'"
  exit 1
fi

echo "PASS: README usage-first restructure contract checks"
