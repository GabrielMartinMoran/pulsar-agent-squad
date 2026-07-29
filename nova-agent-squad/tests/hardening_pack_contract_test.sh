#!/usr/bin/env bash
set -euo pipefail

bun run src/cli/index.ts build --target=opencode >/tmp/nas-build-opencode-hardening.log

assert_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq "$pattern" "$file"; then
    echo "FAIL: '$pattern' not found in $file"
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  if grep -Fq "$pattern" "$file"; then
    echo "FAIL: '$pattern' should not be present in $file"
    exit 1
  fi
}

assert_contains_text() {
  local text="$1"
  local pattern="$2"
  local context="$3"
  if ! printf '%s\n' "$text" | grep -Fq "$pattern"; then
    echo "FAIL: '$pattern' not found in $context"
    exit 1
  fi
}

assert_not_contains_text() {
  local text="$1"
  local pattern="$2"
  local context="$3"
  if printf '%s\n' "$text" | grep -Fq "$pattern"; then
    echo "FAIL: '$pattern' should not be present in $context"
    exit 1
  fi
}

orchestrator_file="dist/platforms/opencode/agents/Nova Agent Squad.md"
frontmatter="$(awk 'BEGIN{c=0} /^---$/ {c++; if (c==2) exit; next} c==1 {print}' "$orchestrator_file")"
planner_file="src/agents/nas_planner.md"
planner_frontmatter="$(awk 'BEGIN{c=0} /^---$/ {c++; if (c==2) exit; next} c==1 {print}' "$planner_file")"
built_planner_file="dist/platforms/opencode/agents/nas_planner.md"
built_planner_frontmatter="$(awk 'BEGIN{c=0} /^---$/ {c++; if (c==2) exit; next} c==1 {print}' "$built_planner_file")"

# Scenario: Orchestrator denies edit and bash
assert_contains_text "$frontmatter" "edit: deny" "$orchestrator_file frontmatter"
assert_contains_text "$frontmatter" "bash: deny" "$orchestrator_file frontmatter"

# Scenario: Orchestrator task permission is explicit NAS subagent allowlist only
assert_contains_text "$frontmatter" '"*": deny' "$orchestrator_file frontmatter"
assert_contains_text "$frontmatter" '"nas_researcher": allow' "$orchestrator_file frontmatter"
assert_contains_text "$frontmatter" '"nas_developer": allow' "$orchestrator_file frontmatter"
assert_contains_text "$frontmatter" '"nas_qa": allow' "$orchestrator_file frontmatter"
assert_not_contains_text "$frontmatter" '"nas_orchestrator": allow' "$orchestrator_file frontmatter"

# Scenario: Planner write scope uses valid edit permissions for only *.feature files
assert_not_contains_text "$planner_frontmatter" "tools:" "$planner_file frontmatter"
assert_contains_text "$planner_frontmatter" '"*": deny' "$planner_file frontmatter"
assert_contains_text "$planner_frontmatter" '"*.feature": allow' "$planner_file frontmatter"
assert_not_contains_text "$planner_frontmatter" "write: allow" "$planner_file frontmatter"
assert_not_contains_text "$planner_frontmatter" "edit: deny" "$planner_file frontmatter"

assert_not_contains_text "$built_planner_frontmatter" "tools:" "$built_planner_file frontmatter"
assert_contains_text "$built_planner_frontmatter" '"*": deny' "$built_planner_file frontmatter"
assert_contains_text "$built_planner_frontmatter" '"*.feature": allow' "$built_planner_file frontmatter"
assert_not_contains_text "$built_planner_frontmatter" "write: allow" "$built_planner_file frontmatter"
assert_not_contains_text "$built_planner_frontmatter" "edit: deny" "$built_planner_file frontmatter"

# Scenario: Hard guardrails block workaround paths when denied tools or missing authorization occur
assert_contains "$orchestrator_file" "If any required action needs a denied tool, abort that path and escalate to user."
assert_contains "$orchestrator_file" "No workaround, no alternate tool path, and no hidden implementation attempts."

assert_contains "dist/platforms/opencode/agents/nas_researcher.md" "If a required tool is denied, abort and escalate to Orchestrator; do not attempt workarounds."
assert_contains "dist/platforms/opencode/agents/nas_planner.md" "If a required tool is denied, abort and escalate to Orchestrator; do not attempt workarounds."
assert_contains "dist/platforms/opencode/agents/nas_developer.md" "If any required tool is denied, abort implementation and escalate to Orchestrator immediately."
assert_contains "dist/platforms/opencode/agents/nas_developer.md" "If apply authorization is missing/invalid, stop and return BLOCKED; do not edit files and do not run workaround paths."
assert_contains "dist/platforms/opencode/agents/nas_qa.md" "If a required validation tool is denied, abort validation and escalate to Orchestrator; no workaround path."

# Scenario: Model trust tiers and lower-trust operational guidance are documented
assert_contains "docs/architecture.md" "## Model Trust Tiers and Operational Guidance"
assert_contains "docs/architecture.md" "high-compliance model"
assert_contains "docs/architecture.md" "lower-trust model"
assert_contains "docs/architecture.md" "Roles requiring high-compliance"
assert_contains "docs/architecture.md" "Recommended behavior for lower-trust models"

# Scenario: Orchestrator has read permission for nas.config.yaml only
assert_contains_text "$frontmatter" '".agents/nas.config.yaml": allow' "$orchestrator_file frontmatter"
assert_contains_text "$frontmatter" 'websearch: allow' "$orchestrator_file frontmatter"
assert_contains_text "$frontmatter" 'todowrite: allow' "$orchestrator_file frontmatter"

# Scenario: Researcher bash uses glob allowlist
researcher_file="src/agents/nas_researcher.md"
researcher_frontmatter="$(awk 'BEGIN{c=0} /^---$/ {c++; if (c==2) exit; next} c==1 {print}' "$researcher_file")"
assert_contains_text "$researcher_frontmatter" '"git *": allow' "$researcher_file frontmatter"
assert_contains_text "$researcher_frontmatter" '"curl *": allow' "$researcher_file frontmatter"
assert_contains_text "$researcher_frontmatter" '"wget *": allow' "$researcher_file frontmatter"
assert_contains_text "$researcher_frontmatter" '"*": deny' "$researcher_file frontmatter"

echo "PASS: hardening pack contract checks"
