> Owner: PAS maintainers · Updated: 2026-11-01

# ADR 0015: PAS-owned capability policy store

**Status:** Accepted

## Context

Skill rules and tool restrictions must survive PAS rebuilds and reinstalls
without rewriting the user's OpenCode configuration. Tool permissions also
must not reopen capabilities restricted by a role's authored prompt.

## Decision

Store skill rules and blocked tool identifiers in the versioned PAS-owned file
`~/.config/opencode/pas/policies.json`. Migrate legacy skill rules
non-destructively. Keep tools deny-only, normalize legacy aliases, and inject
tool denies after the authored OpenCode permission rules. Pi artifacts remain
untouched. `pas tools` manages block, unblock, clear, list, and interactive
setup; critical workflow tool warnings do not block a user's choice.

## Consequences

Rebuilds and reinstalls reproduce the selected policy from the durable store.
Changing a role's base permissions remains a source-prompt edit, not a tool
allow/ask policy. Runtime verification requires the manual procedure in
`specs/features/product/tool-policies.feature`.

Sources: `src/cli/lib/policy-store.ts`, `src/cli/lib/tool-policies.ts`,
`src/cli/commands/tools/command.ts`.
