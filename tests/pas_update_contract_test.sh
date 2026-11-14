#!/usr/bin/env bash
# Contract: `pas update` command surface and behavior.
#
# - update is registered as a top-level subcommand and shown in `pas --help`
# - update --help documents its flags
# - update defaults to the current upstream branch via `git pull`
# - update does not implement release-based updater logic
# - update supports --check (dry-run style) and --rebuild/--reinstall convenience flags
set -euo pipefail

assert_contains() {
  local text="$1"
  local pattern="$2"
  local label="$3"
  if ! grep -Fq -- "$pattern" <<<"$text"; then
    echo "FAIL: '$pattern' not found in $label"
    exit 1
  fi
}

assert_not_contains() {
  local text="$1"
  local pattern="$2"
  local label="$3"
  if grep -Fq -- "$pattern" <<<"$text"; then
    echo "FAIL: '$pattern' unexpectedly found in $label"
    exit 1
  fi
}

help_output="$(bun run src/cli/index.ts --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"

# Scenario: update is exposed as a top-level subcommand in `pas --help`
assert_contains "$help_output" "update" "pas --help"

# Scenario: `pas update --help` documents the available options
update_help="$(bun run src/cli/index.ts update --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
assert_contains "$update_help" "--check" "pas update --help"
assert_contains "$update_help" "--rebuild" "pas update --help"
assert_contains "$update_help" "--reinstall" "pas update --help"
assert_contains "$update_help" "Pull, build, and install" "pas update --help"
assert_contains "$update_help" "build without installing" "pas update --help"

# Scenario: update source is a real, registered command module
src_file="src/cli/index.ts"
assert_contains "$(cat "$src_file")" "update" "src/cli/index.ts"
assert_exists_file="src/cli/commands/update.ts"
if [ ! -e "$assert_exists_file" ]; then
  echo "FAIL: missing $assert_exists_file"
  exit 1
fi

# Scenario: update invokes `git pull` (current upstream branch) — not release-based
update_src="$(cat src/cli/commands/update.ts)"
assert_contains "$update_src" "git pull" "src/cli/commands/update.ts"

# Scenario: update does NOT implement release-based updater logic.
# We only forbid active fetches against a release endpoint — a mention in a
# comment is fine. Look for actual HTTP-fetch-shaped code, not bare strings.
assert_not_contains "$update_src" "fetch(" "src/cli/commands/update.ts"
assert_not_contains "$update_src" "download" "src/cli/commands/update.ts"
assert_not_contains "$update_src" "tarball" "src/cli/commands/update.ts"

# Scenario: update exits non-zero (and does not modify files) when not in a git repo
tmpdir="$(mktemp -d)"
pushd "$tmpdir" >/dev/null
set +e
output="$(bun run /home/gabrielmoran/Git/pulsar-agent-squad/src/cli/index.ts update --check 2>&1)"
exit_code=$?
set -e
popd >/dev/null
rm -rf "$tmpdir"

if [ "$exit_code" -eq 0 ]; then
  echo "FAIL: pas update --check should fail outside a git repo (got exit 0)"
  exit 1
fi

# Check mode is write-free and previews the same selected actions as execution.
check_plan() {
  local label="$1"; shift
  local output
  local sandbox
  sandbox="$(mktemp -d)"
  git -C "$sandbox" init -q
  git -C "$sandbox" -c user.name=PAS -c user.email=pas@example.invalid commit --allow-empty -qm baseline
  output="$(cd "$sandbox" && bun run "$OLDPWD/src/cli/index.ts" update --check "$@" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
  rm -rf "$sandbox"
  local plan="$(sed -n '/>> Plan:/,/>> --check set:/p' <<<"$output")"
  assert_contains "$plan" "git pull" "$label plan"
  if [[ " $* " == *" --rebuild "* && " $* " != *" --reinstall "* ]]; then
    assert_contains "$plan" "pas build --target=opencode" "$label plan"
    assert_not_contains "$plan" "pas install" "$label plan"
  else
    assert_contains "$plan" "pas install --target=opencode" "$label plan"
    assert_not_contains "$plan" "pas build --target=opencode" "$label plan"
  fi
  assert_not_contains "$output" ">> pas build --target=opencode" "$label execution"
  assert_not_contains "$output" ">> pas install --target=opencode" "$label execution"
  assert_not_contains "$output" ">> git pull" "$label execution"
}

check_plan "default"
check_plan "rebuild-only" --rebuild
check_plan "reinstall-only" --reinstall
check_plan "combined" --rebuild --reinstall

echo "PASS: pas update command contract checks"
