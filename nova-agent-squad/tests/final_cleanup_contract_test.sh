#!/usr/bin/env bash
set -euo pipefail

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
    echo "FAIL: unexpected '$pattern' found in $file"
    exit 1
  fi
}

# Scenario: validate command references centralized source and dist paths
assert_contains "src/cli/commands/validate.ts" "join('src', 'agents'"
assert_contains "src/cli/commands/validate.ts" 'dist/platforms/opencode/agents'

# Scenario: build command copies from centralized source
assert_contains "src/cli/commands/build.ts" "readdirSync(sourceDir)"
assert_contains "src/cli/commands/build.ts" "writeFileSync(destFile, content)"

# Scenario: test command builds opencode artifacts before contractual checks
assert_contains "src/cli/commands/test.ts" "Build opencode"
assert_contains "src/cli/commands/test.ts" "parseManifest()"
assert_contains "src/cli/commands/test.ts" "target === 'opencode'"

# Scenario: build artifacts are ignored by policy
assert_contains ".gitignore" "dist/"

echo "PASS: final cleanup contract checks"
