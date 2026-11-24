#!/usr/bin/env bash
# Contract: `pas update` command surface and behavior.
#
# - update is registered as a top-level subcommand and shown in `pas --help`
# - update --help documents its flags
# - default update plans a fast-forward pull plus the OpenCode installer
# - --rebuild alone plans only the OpenCode build
# - --check shows the plan without pulling, building, installing, or writing
# - a failed install after a successful pull exits non-zero, reports partial
#   completion, and leaves the checkout at the fast-forwarded revision
# - update does not implement release-based updater logic
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_ENTRY="$REPO_ROOT/src/cli/index.ts"

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

assert_eq() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $label (expected '$expected', got '$actual')"
    exit 1
  fi
}

help_output="$(bun run "$CLI_ENTRY" --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"

# Scenario: update is exposed as a top-level subcommand in `pas --help`
assert_contains "$help_output" "update" "pas --help"

# Scenario: `pas update --help` documents the available options
update_help="$(bun run "$CLI_ENTRY" update --help 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
assert_contains "$update_help" "--check" "pas update --help"
assert_contains "$update_help" "--rebuild" "pas update --help"
assert_contains "$update_help" "--reinstall" "pas update --help"

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
output="$(bun run "$CLI_ENTRY" update --check 2>&1)"
exit_code=$?
set -e
popd >/dev/null
rm -rf "$tmpdir"

if [ "$exit_code" -eq 0 ]; then
  echo "FAIL: pas update --check should fail outside a git repo (got exit 0)"
  exit 1
fi

# --- Integration fixtures: Git boundary + CLI process boundary ---------------
mkdir -p /tmp/opencode
fixture_root="$(mktemp -d /tmp/opencode/pas-update-contract.XXXXXX)"
cleanup() { rm -rf "$fixture_root"; }
trap cleanup EXIT

upstream="$fixture_root/upstream.git"
work="$fixture_root/work"
other="$fixture_root/other"

git init --bare -q "$upstream"
git -C "$upstream" symbolic-ref HEAD refs/heads/main

git init -q -b main "$work"
git -C "$work" config user.email "pas-test@example.com"
git -C "$work" config user.name "PAS Test"
git -C "$work" config commit.gpgsign false
cat > "$work/package.json" <<'JSON'
{
  "name": "pas-update-fixture",
  "private": true,
  "scripts": {
    "cli": "false"
  }
}
JSON
echo "one" > "$work/fixture.txt"
git -C "$work" add -A
git -C "$work" commit -qm "initial"
git -C "$work" remote add origin "$upstream"
git -C "$work" push -qu origin main

# Scenario D2 (@contract): check mode prints the plan and never pulls, builds,
# or installs.
before_head="$(git -C "$work" rev-parse HEAD)"
default_output="$(cd "$work" && bun run "$CLI_ENTRY" update --check 2>&1)"
assert_contains "$default_output" "git pull --ff-only" "update --check default plan"
assert_contains "$default_output" "pas install --target=opencode" "update --check default plan"
assert_contains "$default_output" "not modifying anything" "update --check default plan"
assert_eq "$(git -C "$work" rev-parse HEAD)" "$before_head" "update --check must not pull"
if [ -e "$work/dist" ]; then
  echo "FAIL: update --check must not build dist"
  exit 1
fi

rebuild_output="$(cd "$work" && bun run "$CLI_ENTRY" update --rebuild --check 2>&1)"
assert_contains "$rebuild_output" "pas build --target=opencode" "update --rebuild --check plan"
assert_not_contains "$rebuild_output" "pas install" "update --rebuild --check plan"

reinstall_output="$(cd "$work" && bun run "$CLI_ENTRY" update --reinstall --check 2>&1)"
assert_contains "$reinstall_output" "pas install --target=opencode" "update --reinstall --check plan"

# Scenario D3 (@integration): a fast-forward pull completes, the default
# install fails, update reports partial completion, and the checkout stays at
# the fast-forwarded revision.
git clone -q "$upstream" "$other"
git -C "$other" config user.email "pas-test@example.com"
git -C "$other" config user.name "PAS Test"
git -C "$other" config commit.gpgsign false
echo "two" >> "$other/fixture.txt"
git -C "$other" commit -qam "second"
git -C "$other" push -q origin main
target_head="$(git -C "$other" rev-parse HEAD)"
assert_eq "$(git -C "$work" rev-parse HEAD)" "$before_head" "fixture should be one commit behind before update"

set +e
update_output="$(cd "$work" && bun run "$CLI_ENTRY" update 2>&1)"
update_code=$?
set -e

if [ "$update_code" -eq 0 ]; then
  echo "FAIL: update should exit non-zero when the install fails after pulling"
  exit 1
fi
assert_contains "$update_output" "partial" "update failure report"
assert_contains "$update_output" "pas install --target=opencode" "update failure report"
assert_eq "$(git -C "$work" rev-parse HEAD)" "$target_head" "update must not roll back the completed pull"

echo "PASS: pas update command contract checks"
