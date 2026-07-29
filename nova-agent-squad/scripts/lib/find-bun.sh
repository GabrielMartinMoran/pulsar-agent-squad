#!/usr/bin/env bash
# Shared bun-detection helper for NAS shell entry points.
#
# Source this from `nas`, `install.sh`, or any other shell launcher that needs
# to locate a `bun` executable. This is the single source of truth for
# `find_bun` — do not redefine it inline in callers.
#
# Provides:
#   find_bun  - prints the absolute path of a usable bun executable, or returns 1
#
# Contract:
#   - Does NOT auto-install bun. If no bun is found, the caller is expected to
#     surface a clear, actionable error to the user.
#   - Prefers `command -v bun` (PATH) and falls back to common install paths.

# shellcheck shell=bash

find_bun() {
  # Try direct bun command first (PATH lookup)
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi

  # Common installation paths
  local paths=(
    "$HOME/.bun/bin/bun"
    "/usr/local/bin/bun"
    "/usr/bin/bun"
    "/opt/bun/bin/bun"
  )

  local p
  for p in "${paths[@]}"; do
    if [[ -x "$p" ]]; then
      echo "$p"
      return 0
    fi
  done

  return 1
}
