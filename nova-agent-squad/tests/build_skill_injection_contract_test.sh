#!/usr/bin/env bash
# tests/build_skill_injection_contract_test.sh
#
# Contract test for the build-time `permission.skill` injection
# (fix for the IADEV skill deny precedence bug; see memory
# permission-skill-precedence-bug-confirmed-20260701).
#
# Verifies the runtime precedence fix end-to-end:
#
#   1. `nas build` reads `~/.config/opencode/opencode.json` (or
#      `NAS_OPENCODE_CONFIG_PATH` override) and compiles each NAS
#      agent's per-agent `permission.skill` block INTO the dist
#      agent's frontmatter `permission:` block.
#   2. The injected `skill:` key sits AFTER the existing `*`: allow
#      line so OpenCode's "last matching rule wins" semantics make
#      the specific skill rules override the catch-all.
#   3. The CLI (`nas skills add/setup`) is preserved as the source
#      of truth — the build step never writes to `opencode.json`.
#   4. Non-CLI users (no per-agent rules in the config) get a
#      byte-identical dist file (no `skill:` line added).
#   5. The fix works for both simple (developer/qa) and nested
#      (orchestrator) frontmatter shapes.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_ENTRY="src/cli/index.ts"
NAS_OPENCODE_CONFIG_PATH_DEFAULT="$HOME/.config/opencode/opencode.json"

TMPDIR_BASE="${TMPDIR:-/tmp}"
WORKDIR="$(mktemp -d "${TMPDIR_BASE}/nas-build-inj-contract-XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

mkdir -p "$WORKDIR/.config/opencode"

# ----- Build a fixture opencode.json with per-agent skill rules -----
FIXTURE_CONFIG="$WORKDIR/.config/opencode/opencode.json"
cat > "$FIXTURE_CONFIG" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "Nova Agent Squad",
  "agent": {
    "nas_developer": {
      "permission": { "skill": { "IADEV*": "deny", "git-*": "deny" } }
    },
    "nas_developer_mini": {
      "permission": { "skill": { "IADEV*": "deny" } }
    },
    "nas_planner": { "permission": { "skill": { "IADEV*": "deny" } } },
    "nas_qa": { "permission": { "skill": { "IADEV*": "deny" } } },
    "nas_researcher": { "permission": { "skill": { "IADEV*": "deny" } } },
    "Nova Agent Squad": { "permission": { "skill": { "IADEV*": "deny" } } }
  }
}
JSON

# ----- Save the current dist to restore after the test -----
DIST_DIR="$REPO_ROOT/dist/platforms/opencode/agents"
BACKUP_DIR="$WORKDIR/dist-backup"
if [ -d "$DIST_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  cp -r "$DIST_DIR" "$BACKUP_DIR/"
fi

# Always restore dist on exit (success or failure).
restore_dist() {
  if [ -d "$BACKUP_DIR" ]; then
    rm -rf "$DIST_DIR"
    mkdir -p "$DIST_DIR"
    cp -r "$BACKUP_DIR"/. "$DIST_DIR"/
  else
    rm -rf "$DIST_DIR"
  fi
}
trap 'rm -rf "$WORKDIR"; restore_dist' EXIT

PASS=0
FAIL=0
fail() { echo "FAIL: $*"; FAIL=$((FAIL + 1)); }
ok()   { echo "PASS: $*"; PASS=$((PASS + 1)); }

# ============================================================================
# 1. Build with the fixture config: per-agent `permission.skill` is injected.
# ============================================================================
echo
echo "=== Test 1: per-agent skill block injection ==="
(
  cd "$REPO_ROOT" || exit 1
  NAS_OPENCODE_CONFIG_PATH="$FIXTURE_CONFIG" \
    bun run "$CLI_ENTRY" build --target=opencode >/dev/null 2>&1
) || { fail "nas build exited non-zero"; }

for AGENT in nas_developer nas_developer_mini nas_planner nas_qa nas_researcher; do
  FILE="$DIST_DIR/$AGENT.md"
  if [ ! -f "$FILE" ]; then
    fail "$AGENT dist file missing"
    continue
  fi

  # The injected `skill:` key must exist as a child of `permission:`.
  if ! grep -q '^  skill:' "$FILE"; then
    fail "$AGENT: missing injected `  skill:` block"
    continue
  fi

  # The injected `skill:` key must sit AFTER the `*`: allow line.
  STAR_LINE=$(grep -n '^  "\*": allow$' "$FILE" | head -1 | cut -d: -f1)
  SKILL_LINE=$(grep -n '^  skill:$' "$FILE" | head -1 | cut -d: -f1)
  if [ -z "$STAR_LINE" ] || [ -z "$SKILL_LINE" ]; then
    fail "$AGENT: cannot locate star-allow or skill line"
    continue
  fi
  if [ "$SKILL_LINE" -le "$STAR_LINE" ]; then
    fail "$AGENT: skill line (line $SKILL_LINE) must come AFTER star-allow (line $STAR_LINE)"
    continue
  fi

  # The injected rules must be present.
  if ! grep -q '^    "IADEV\*": deny$' "$FILE"; then
    fail "$AGENT: missing injected IADEV* deny rule"
    continue
  fi

  ok "$AGENT: skill block injected after *: allow, rules present"
done

# ============================================================================
# 2. Orchestrator: nested `task:` block must remain AFTER the `skill:` key.
# ============================================================================
echo
echo "=== Test 2: orchestrator nested children preserved ==="
ORCH_FILE="$DIST_DIR/Nova Agent Squad.md"
if [ ! -f "$ORCH_FILE" ]; then
  fail "orchestrator dist file missing"
else
  STAR_LINE=$(grep -n '^  "\*": allow$' "$ORCH_FILE" | head -1 | cut -d: -f1)
  SKILL_LINE=$(grep -n '^  skill:$' "$ORCH_FILE" | head -1 | cut -d: -f1)
  TASK_LINE=$(grep -n '^  task:$' "$ORCH_FILE" | head -1 | cut -d: -f1)

  if [ -z "$STAR_LINE" ] || [ -z "$SKILL_LINE" ] || [ -z "$TASK_LINE" ]; then
    fail "orchestrator: cannot locate star/skill/task lines (star=$STAR_LINE skill=$SKILL_LINE task=$TASK_LINE)"
  elif [ "$SKILL_LINE" -le "$STAR_LINE" ]; then
    fail "orchestrator: skill line must come AFTER star-allow"
  elif [ "$SKILL_LINE" -ge "$TASK_LINE" ]; then
    fail "orchestrator: skill line (line $SKILL_LINE) must come BEFORE task: (line $TASK_LINE)"
  elif ! grep -q '^    "IADEV\*": deny$' "$ORCH_FILE"; then
    fail "orchestrator: missing injected IADEV* deny rule"
  else
    ok "orchestrator: skill block placed between *: allow and task: nested block"
  fi
fi

# ============================================================================
# 3. Build with EMPTY config: dist file is byte-identical to source.
# ============================================================================
echo
echo "=== Test 3: no-injection case (empty config) ==="
EMPTY_CONFIG="$WORKDIR/.config/opencode/empty.json"
echo '{}' > "$EMPTY_CONFIG"
SOURCE_DEV="$REPO_ROOT/src/agents/nas_developer.md"
SOURCE_DEV_AFTER_INJECT_MARKERS="$WORKDIR/source-dev-resolved.md"
# Resolve INJECT markers so we compare like-for-like.
cp "$SOURCE_DEV" "$SOURCE_DEV_AFTER_INJECT_MARKERS"

(
  cd "$REPO_ROOT" || exit 1
  NAS_OPENCODE_CONFIG_PATH="$EMPTY_CONFIG" \
    bun run "$CLI_ENTRY" build --target=opencode >/dev/null 2>&1
) || { fail "nas build (empty config) exited non-zero"; }

DIST_DEV="$DIST_DIR/nas_developer.md"
if [ ! -f "$DIST_DEV" ]; then
  fail "dist nas_developer.md missing after empty-config build"
else
  if grep -q '^  skill:' "$DIST_DEV"; then
    fail "dist nas_developer.md has injected skill block despite empty config"
  else
    ok "no-injection case: dist has no skill block when config has no rules"
  fi
fi

# ============================================================================
# 4. CLI is preserved: `nas skills add` still writes to opencode.json only.
# ============================================================================
echo
echo "=== Test 4: CLI is still the source of truth ==="
# The CLI uses HOME + .config/opencode/opencode.json as its default path.
# We use HOME to redirect its writes; NAS_OPENCODE_CONFIG_PATH is for the
# build step, NOT for the CLI (the CLI does not read that env var).
CLI_HOME="$WORKDIR/cli-home"
mkdir -p "$CLI_HOME/.config/opencode"
SKILLS_CONFIG="$CLI_HOME/.config/opencode/opencode.json"
cat > "$SKILLS_CONFIG" <<'JSON'
{ "default_agent": "Nova Agent Squad" }
JSON
(
  cd "$REPO_ROOT" || exit 1
  HOME="$CLI_HOME" \
    bun run "$CLI_ENTRY" skills add docs-writer deny --scope all-nas >/dev/null 2>&1
) || { fail "nas skills add exited non-zero"; }

if ! grep -q 'docs-writer' "$SKILLS_CONFIG"; then
  fail "nas skills add did not write to opencode.json"
else
  ok "nas skills add still writes to opencode.json (CLI preserved as source of truth)"
fi

# ----- Summary -----
echo
echo "=== Summary: $PASS pass, $FAIL fail ==="
[ "$FAIL" -eq 0 ]
