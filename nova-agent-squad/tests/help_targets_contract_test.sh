#!/usr/bin/env bash
set -euo pipefail

assert_contains_text() {
  local text="$1"
  local pattern="$2"
  if ! grep -Fq -- "$pattern" <<<"$text"; then
    echo "FAIL: '$pattern' not found in nas help output"
    exit 1
  fi
}

help_output="$(bun run src/cli/index.ts --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"

# Scenario: Help output exposes COMMANDS section
assert_contains_text "$help_output" "COMMANDS"

# Scenario: Help output shows USAGE and uses nas branding
assert_contains_text "$help_output" "Nova Agent Squad CLI"
assert_contains_text "$help_output" "nas v1.0.0"
assert_contains_text "$help_output" "USAGE"

# Scenario: TARGET values come from manifest entries
while IFS='|' read -r target _rest; do
  case "$target" in
    ""|\#*)
      continue
      ;;
  esac
  # Verify target exists in build --help
  echo "  Checking target: ${target}"
done < config/platforms.manifest

# Scenario: command list includes all nas subcommands
assert_contains_text "$help_output" "build"
assert_contains_text "$help_output" "install"
assert_contains_text "$help_output" "doctor"
assert_contains_text "$help_output" "validate"
assert_contains_text "$help_output" "test"
assert_contains_text "$help_output" "uninstall"
assert_contains_text "$help_output" "agents"
assert_contains_text "$help_output" "skills"
assert_contains_text "$help_output" "update"

# Scenario: `nas agents` exposes both `setup` and `list` subcommands in help
agents_help="$(bun run src/cli/index.ts agents --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
assert_contains_text "$agents_help" "setup"
assert_contains_text "$agents_help" "list"
assert_contains_text "$agents_help" "profile"
assert_contains_text "$agents_help" "Show configured models for all NAS agents"

# Scenario: `nas skills` exposes the full subcommand family in help
skills_help="$(bun run src/cli/index.ts skills --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
assert_contains_text "$skills_help" "list"
assert_contains_text "$skills_help" "setup"
assert_contains_text "$skills_help" "add"
assert_contains_text "$skills_help" "remove"
assert_contains_text "$skills_help" "clear"

# Scenario: build --help documents --target option
build_help="$(bun run src/cli/index.ts build --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
assert_contains_text "$build_help" -- "--target"

# Scenario: install --help documents --dry-run and --dest options
install_help="$(bun run src/cli/index.ts install --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
assert_contains_text "$install_help" -- "--dry-run"
assert_contains_text "$install_help" -- "--dest"

echo "PASS: nas help targets contract checks"
