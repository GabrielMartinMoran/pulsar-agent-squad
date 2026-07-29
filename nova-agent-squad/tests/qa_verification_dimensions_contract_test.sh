#!/usr/bin/env bash
set -euo pipefail

# Stable QA verification contract:
# 1. Skill compliance validation
# 2. Linter/Formatter validation
# 3. Specs/Gherkin drift detection

assert_contains() {
  local file="$1"
  local pattern="$2"
  local desc="${3:-'$pattern' not found in $file}"
  if ! grep -Fq "$pattern" "$file"; then
    echo "FAIL: $desc"
    exit 1
  fi
}

echo "Testing QA verification dimensions contract..."

# 1. Skill compliance validation
echo "  [1/5] Checking skill_compliance validation block in nas_qa.md..."
assert_contains "src/agents/nas_qa.md" "skill_compliance" "skill_compliance block missing from nas_qa.md"
assert_contains "src/agents/nas_qa.md" "skill_violation" "skill_violation fail_category missing from nas_qa.md"
assert_contains "src/agents/nas_qa.md" "Skill Assignment Contract" "Skill Assignment Contract reference missing"
assert_contains "src/agents/nas_qa.md" "Validate developer skill application conceptually from the assigned skill list." "QA must validate skill usage conceptually"
assert_contains "src/agents/nas_developer.md" "<skill_application>" "Developer report must expose skill_application block"

# 2. Linter/Formatter validation
echo "  [2/5] Checking linter/formatter validation in nas_qa.md..."
assert_contains "src/agents/nas_qa.md" "linter_fail" "linter_fail fail_category missing from nas_qa.md"
assert_contains "src/agents/nas_qa.md" "linter" "Linter validation section missing"
assert_contains "src/agents/nas_qa.md" "recommend an appropriate linter/formatter for the detected project stack" "Generalized linter guidance missing"
if grep -Fq "Language-specific recommendations if no linter" src/agents/nas_qa.md; then
  echo "FAIL: stack-specific no-linter heading should be removed"
  exit 1
fi

# 3. Specs/Gherkin drift detection
echo "  [3/5] Checking specs drift detection in nas_qa.md..."
assert_contains "src/agents/nas_qa.md" "specs_drift" "specs_drift fail_category missing from nas_qa.md"
assert_contains "src/agents/nas_qa.md" "specs/features" "specs drift detection section missing"

# 4. Check stable section naming, sibling XML blocks, and deduplicated clean-code rule
echo "  [4/5] Checking QA output structure in nas_qa.md..."
assert_contains "src/agents/nas_qa.md" "## QA evaluation dimensions" "Stable QA evaluation heading missing"
if grep -Fq "New Verification Dimensions" src/agents/nas_qa.md; then
  echo "FAIL: transitional heading should be removed from nas_qa.md"
  exit 1
fi

skill_open=$(grep -n '^<skill_compliance>$' src/agents/nas_qa.md | cut -d: -f1 | head -n 1)
skill_close=$(grep -n '^</skill_compliance>$' src/agents/nas_qa.md | cut -d: -f1 | head -n 1)
linter_open=$(grep -n '^<linter_check>$' src/agents/nas_qa.md | cut -d: -f1 | head -n 1)
linter_close=$(grep -n '^</linter_check>$' src/agents/nas_qa.md | cut -d: -f1 | head -n 1)
specs_open=$(grep -n '^<specs_drift>$' src/agents/nas_qa.md | cut -d: -f1 | head -n 1)
specs_close=$(grep -n '^</specs_drift>$' src/agents/nas_qa.md | cut -d: -f1 | head -n 1)

if [ -z "$skill_open" ] || [ -z "$skill_close" ] || [ -z "$linter_open" ] || [ -z "$linter_close" ] || [ -z "$specs_open" ] || [ -z "$specs_close" ]; then
  echo "FAIL: one or more QA XML blocks are missing"
  exit 1
fi

if [ "$skill_close" -ge "$linter_open" ]; then
  echo "FAIL: <linter_check> must be a sibling after </skill_compliance>"
  exit 1
fi

if [ "$linter_close" -ge "$specs_open" ]; then
  echo "FAIL: <specs_drift> must be a sibling after </linter_check>"
  exit 1
fi

if [ "$(grep -Fc "clean-code warnings are WARNING level only" src/agents/nas_qa.md)" -ne 1 ]; then
  echo "FAIL: clean-code warning rule should appear exactly once in nas_qa.md"
  exit 1
fi

echo "  [4b/5] Checking fail category table in nas_qa.md..."
if ! grep -E '`skill_violation`.*Yes' src/agents/nas_qa.md >/dev/null; then
  echo "FAIL: skill_violation not marked as auto-iterable in nas_qa.md"
  exit 1
fi
assert_contains "src/agents/nas_qa.md" "linter_fail" "linter_fail not in fail category table"

# 5. Check AGENTS.md has updated Auto-Iteration System table
echo "  [5/5] Checking Auto-Iteration System table in docs/AGENTS.md..."
assert_contains "docs/AGENTS.md" "skill_violation" "skill_violation missing from AGENTS.md"
assert_contains "docs/AGENTS.md" "linter_fail" "linter_fail missing from AGENTS.md"
assert_contains "docs/AGENTS.md" "specs_drift" "specs_drift missing from AGENTS.md"

echo "PASS: QA verification dimensions contract checks"
