#!/usr/bin/env bash
# NAS launcher — resolves a bun executable via the shared helper and execs the CLI.
#
# This is a thin shell wrapper. All real logic lives in src/cli/index.ts.
# Bun detection is delegated to scripts/lib/find-bun.sh so install.sh and other
# shell entry points share the exact same lookup path.

# Get the directory of this script (resolve symlinks)
get_script_dir() {
  local source="${BASH_SOURCE[0]}"
  while [[ -L "$source" ]]; do
    local dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  local dir="$(cd -P "$(dirname "$source")" && pwd)"
  echo "$dir"
}

root_path="$(get_script_dir)"

# Source the shared bun-detection helper
# shellcheck source=scripts/lib/find-bun.sh
source "$root_path/scripts/lib/find-bun.sh"

# Find bun
BUN_CMD=$(find_bun)
if [[ -z "$BUN_CMD" ]]; then
  echo "Error: bun not found. Install from https://bun.sh or add to PATH" >&2
  exit 1
fi

exec "$BUN_CMD" run cli "$@"
