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
  local file="$1" pattern="$2"
  if ! grep -Fq -- "$pattern" "$file"; then
    echo "FAIL: '$pattern' not found in $file"
    exit 1
  fi
}

assert_not_contains() {
  local file="$1" pattern="$2"
  if grep -Fq -- "$pattern" "$file"; then
    echo "FAIL: '$pattern' should NOT be in $file"
    exit 1
  fi
}

# Scenario: OpenCode build emits agents (but NOT per-agent caveman reference files).
bun run src/cli/index.ts build --target=opencode >/tmp/nas-caveman-build.log
assert_exists "dist/platforms/opencode/agents/nas_developer.md"
assert_exists "dist/platforms/opencode/agents/nas_qa.md"

# Scenario: No per-agent caveman reference files in dist/ (build injects inline).
if [ -f "dist/platforms/opencode/references/nas_caveman_developer.md" ]; then
  echo "FAIL: dist/platforms/opencode/references/nas_caveman_developer.md should not exist (caveman is now inline)"
  exit 1
fi
if [ -f "dist/platforms/opencode/references/nas_caveman_qa.md" ]; then
  echo "FAIL: dist/platforms/opencode/references/nas_caveman_qa.md should not exist (caveman is now inline)"
  exit 1
fi

# Scenario: No monolithic nas_caveman.md (without suffix) lingers in dist.
if [ -f "dist/platforms/opencode/references/nas_caveman.md" ]; then
  echo "FAIL: stale monolithic dist/platforms/opencode/references/nas_caveman.md should not exist"
  exit 1
fi

# Scenario: OpenCode install dry-run does NOT install per-agent caveman references.
install_output="$(bun run src/cli/index.ts install --target=opencode --dry-run --destdir=/tmp/nas-caveman-contract 2>&1)"
if echo "$install_output" | grep -Fq "nas_caveman_developer.md\|nas_caveman_qa.md"; then
  echo "FAIL: install should NOT reference per-agent caveman files (caveman is now inline)"
  exit 1
fi

# Scenario: Source agents contain injection markers (build-time injection points).
assert_contains "src/agents/nas_developer.md" "<!-- INJECT:caveman_developer -->"
assert_contains "src/agents/nas_qa.md" "<!-- INJECT:caveman_qa -->"

# Scenario: Source agents do NOT contain "fail closed" or "read ~/.config/opencode/references" anymore.
assert_not_contains "src/agents/nas_developer.md" "fail closed"
assert_not_contains "src/agents/nas_developer.md" "read \`~/.config/opencode/references/"
assert_not_contains "src/agents/nas_qa.md" "fail closed"
assert_not_contains "src/agents/nas_qa.md" "read \`~/.config/opencode/references/"

# Scenario: Source agents do NOT contain external_directory references.
assert_not_contains "src/agents/nas_developer.md" "external_directory"
assert_not_contains "src/agents/nas_qa.md" "external_directory"

# Scenario: Source agents do NOT contain caveman_reference_read.
assert_not_contains "src/agents/nas_developer.md" "caveman_reference_read"
assert_not_contains "src/agents/nas_qa.md" "caveman_reference_read"

# Scenario: Built dist agents contain caveman rules inline.
DEV_DIST="dist/platforms/opencode/agents/nas_developer.md"
QA_DIST="dist/platforms/opencode/agents/nas_qa.md"
assert_contains "$DEV_DIST" "NAS Caveman Reference"
assert_contains "$QA_DIST" "NAS Caveman Reference"
assert_contains "$DEV_DIST" "## Preserve exactly"
assert_contains "$QA_DIST" "## Preserve exactly"
assert_contains "$DEV_DIST" "## Do not apply to"
assert_contains "$QA_DIST" "## Do not apply to"

# Scenario: Built dist agents contain agent-specific caveman rules.
assert_contains "$DEV_DIST" "## Developer"
assert_contains "$QA_DIST" "## QA"

# Scenario: Built dist agents do NOT contain injection markers.
assert_not_contains "$DEV_DIST" "<!-- INJECT:caveman_developer -->"
assert_not_contains "$DEV_DIST" "<!-- INJECT:caveman_qa -->"
assert_not_contains "$QA_DIST" "<!-- INJECT:caveman_developer -->"
assert_not_contains "$QA_DIST" "<!-- INJECT:caveman_qa -->"

# Scenario: Built dist agents do NOT contain external file references.
assert_not_contains "$DEV_DIST" "nas_caveman_developer.md"
assert_not_contains "$DEV_DIST" "nas_caveman_qa.md"
assert_not_contains "$QA_DIST" "nas_caveman_developer.md"
assert_not_contains "$QA_DIST" "nas_caveman_qa.md"

# Scenario: Built dist agents do NOT contain caveman_reference_read.
assert_not_contains "$DEV_DIST" "caveman_reference_read"
assert_not_contains "$QA_DIST" "caveman_reference_read"

# Scenario: Built dist agents do NOT contain external_directory.
assert_not_contains "$DEV_DIST" "external_directory"
assert_not_contains "$QA_DIST" "external_directory"

# Scenario: Eta template source has developer and qa agent-specific sections.
TEMPLATE="src/cli/templates/nas_caveman.eta"
assert_exists "$TEMPLATE"
assert_contains "$TEMPLATE" "if (it.agent === 'developer'"
assert_contains "$TEMPLATE" "else if (it.agent === 'qa'"
assert_contains "$TEMPLATE" "## Developer"
assert_contains "$TEMPLATE" "## QA"

# Scenario: Shared content exists in both built dist agents (inlined from template).
# Attribution
assert_contains "$DEV_DIST" "Julius Brussee's Caveman skill"
assert_contains "$QA_DIST" "Julius Brussee's Caveman skill"
# Core rules
assert_contains "$DEV_DIST" "## Auto-clarity"
assert_contains "$QA_DIST" "## Auto-clarity"
assert_contains "$DEV_DIST" "## General"
assert_contains "$QA_DIST" "## General"
assert_contains "$DEV_DIST" "## Conflict"
assert_contains "$QA_DIST" "## Conflict"
assert_contains "$DEV_DIST" "## Test coverage"
assert_contains "$QA_DIST" "## Test coverage"
assert_contains "$DEV_DIST" "Test coverage is a project artifact"
assert_contains "$QA_DIST" "Test coverage is a project artifact"

# Scenario: Developer dist output does NOT contain QA-only terms.
assert_not_contains "$DEV_DIST" "QA is read-only"
assert_not_contains "$DEV_DIST" "Caveman never authorizes edits"

# Scenario: QA dist output does NOT contain Developer-only terms.
assert_not_contains "$QA_DIST" "RED done"
assert_not_contains "$QA_DIST" "TDD engineer"

# Scenario: QA prompt remains read-only (source) and scopes caveman to its own prose only (dist).
assert_not_contains "src/agents/nas_qa.md" "Only proceed with edits when explicitly requested"
assert_contains "src/agents/nas_qa.md" "If asked to edit or fix files, refuse and escalate to Orchestrator because QA is read-only."
assert_contains "$QA_DIST" "Use this style only for QA's own visible/intermediate verification prose"
assert_contains "$QA_DIST" "Keep final \`<qa_verdict>\`, evidence, logs, errors, filenames, XML/tags, and Gherkin exact"

# Scenario: v3 carryover — both built dist agents carry the "## Think in caveman (mandatory)" subsection.
assert_contains "$DEV_DIST" "## Think in caveman (mandatory)"
assert_contains "$QA_DIST" "## Think in caveman (mandatory)"

# Scenario: v3 carryover — both branches include the good/bad thinking example pair (lesson: example > directive).
assert_contains "$DEV_DIST" "Good thinking"
assert_contains "$DEV_DIST" "Bad thinking"
assert_contains "$QA_DIST" "Good thinking"
assert_contains "$QA_DIST" "Bad thinking"

# Scenario: Strengthened protected-surface boundary explicitly lists the forbidden surfaces.
assert_contains "$DEV_DIST" "Caveman never alters"
assert_contains "$QA_DIST" "Caveman never alters"
assert_contains "$DEV_DIST" "code, tests, Gherkin, XML/tags"
assert_contains "$QA_DIST" "code, tests, Gherkin, XML/tags"
assert_contains "$DEV_DIST" "file paths, commands"
assert_contains "$QA_DIST" "file paths, commands"
assert_contains "$DEV_DIST" "logs/errors, docs"
assert_contains "$QA_DIST" "logs/errors, docs"
assert_contains "$DEV_DIST" "structured output contracts"
assert_contains "$QA_DIST" "structured output contracts"

# Scenario: Strengthened boundary names the role-specific output contracts in BOTH dists.
assert_contains "$DEV_DIST" "\`<implementation_report>\`"
assert_contains "$DEV_DIST" "\`<qa_verdict>\`"
assert_contains "$QA_DIST" "\`<implementation_report>\`"
assert_contains "$QA_DIST" "\`<qa_verdict>\`"

# Scenario: Developer branch includes developer-flavored thinking example (TDD RED/GREEN).
assert_contains "$DEV_DIST" "RED. Need test for"
assert_contains "$DEV_DIST" "GREEN. 12/12 pass."

# Scenario: QA branch includes QA-flavored thinking example (read-only verification, no TDD markers).
assert_contains "$QA_DIST" "Check \`<qa_verdict>\` line"

# Scenario: No v4 anti-pattern — the hard first-sentence rule is forbidden.
assert_not_contains "$DEV_DIST" "## First sentence rule"
assert_not_contains "$QA_DIST" "## First sentence rule"
assert_not_contains "$DEV_DIST" "Your FIRST sentence of thinking must be caveman"
assert_not_contains "$QA_DIST" "Your FIRST sentence of thinking must be caveman"

# Scenario: QA think-in-caveman does NOT leak developer TDD thinking markers.
assert_not_contains "$QA_DIST" "RED. Need test for"
assert_not_contains "$QA_DIST" "GREEN. 12/12 pass."

# Scenario: Eta template source contains the new subsection heading (so future renders keep it).
assert_contains "$TEMPLATE" "## Think in caveman (mandatory)"

# Scenario: No OpenCode references config is introduced.
if [ -f "opencode.json" ]; then
  assert_not_contains "opencode.json" '"references"'
fi

# Scenario: Original monolithic source file no longer exists.
if [ -f "src/references/nas_caveman.md" ]; then
  echo "FAIL: monolithic src/references/nas_caveman.md should not exist after per-agent migration"
  exit 1
fi

# Scenario: QA dist agent does not leak Developer-specific heading.
assert_not_contains "$QA_DIST" "## Developer"

echo "PASS: caveman reference contract checks"
