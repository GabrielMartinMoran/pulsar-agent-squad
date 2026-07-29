#!/usr/bin/env bash
# NAS bootstrap installer.
#
# Single-command entry point for fresh installs. Defaults to the canonical
# opencode target and reuses the existing `nas install` flow.
#
# Contract:
#   - Does NOT auto-install bun. If bun is missing, exits with a clear error.
#   - Does NOT auto-edit `default_agent` in any runtime config.
#   - Does NOT implement release-based updater logic.
#   - Reuses `nas install --target=opencode` (same code path as the CLI).
#
# Usage:
#   ./install.sh                 # install opencode (default)
#   ./install.sh --target=cursor # install a different target

set -euo pipefail

# Locate this script's directory so we can find the shared helper and the `nas` launcher
get_script_dir() {
  local source="${BASH_SOURCE[0]}"
  while [[ -L "$source" ]]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  local dir
  dir="$(cd -P "$(dirname "$source")" && pwd)"
  echo "$dir"
}

ROOT_DIR="$(get_script_dir)"

# Source the shared bun-detection helper
# shellcheck source=scripts/lib/find-bun.sh
source "$ROOT_DIR/scripts/lib/find-bun.sh"

# Default install target
TARGET="opencode"

# Parse args. We accept --target=<name> (and --target <name>) to keep the door
# open for future targets without redesigning the script.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target=*)
      TARGET="${1#*=}"
      shift
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--target <name>]"
      echo ""
      echo "Bootstraps a Nova Agent Squad install for a single platform target."
      echo ""
      echo "Options:"
      echo "  --target <name>   Platform target to install (default: opencode)."
      echo "  -h, --help        Show this help and exit."
      echo ""
      echo "Prerequisites: bun must be on PATH (or in a common install location)."
      echo "See: https://bun.sh"
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      echo "Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

# Resolve bun. If missing, surface a clear, actionable error and exit.
BUN_CMD="$(find_bun)"
if [[ -z "$BUN_CMD" ]]; then
  echo "Error: bun not found. Install from https://bun.sh or add it to PATH, then re-run." >&2
  exit 1
fi

echo ">> nas install: target=${TARGET}"
echo ">> Using bun: ${BUN_CMD}"

# Delegate to the canonical install flow. Reusing `nas install` keeps a single
# source of truth and avoids duplicating the manifest/destdir logic.
exec "$BUN_CMD" run cli install --target="$TARGET"
