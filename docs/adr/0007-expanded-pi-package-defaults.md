> Owner: PAS maintainers · Updated: 2026-10-29

# ADR 0007: Expand the default Pi package set

- Status: accepted
- Date: 2026-10-29
- Supersedes in part: [ADR 0006](0006-pi-runtime-target.md)
- Contract: `specs/features/product/pi-runtime-target.feature`

## Context

ADR 0006 made `pi-subagents` and `pi-web-access` the active defaults in
`config/pi-packages.txt`. Pi sessions also benefit from structured questions and
task tracking: `@juicesharp/rpiv-ask-user-question` provides an interactive
ask-user tool, and `@juicesharp/rpiv-todo` adds todo tracking. Both were already
available as commented, opt-in entries.

## Decision

Activate `npm:@juicesharp/rpiv-ask-user-question` and `npm:@juicesharp/rpiv-todo`
as defaults in `config/pi-packages.txt`, alongside `pi-subagents` and
`pi-web-access`. The remaining optional entries stay commented. Installation
behavior is unchanged: `./pas install --target=pi` installs active sources,
skips sources already configured per `pi list`, and aborts on the first failure.

## Consequences

- Pi sessions get structured questions and todo tracking without per-machine
  opt-in.
- More third-party code executes by default in the global `~/.pi/agent`
  environment. The editable list, `--dry-run`, skip logic, and fail-fast abort
  contain the blast radius but do not remove the risk.
- The active default set is now four packages:
  `pi-subagents`, `pi-web-access`, `@juicesharp/rpiv-ask-user-question`, and
  `@juicesharp/rpiv-todo`.

## Sources

- `config/pi-packages.txt`
- `docs/adr/0006-pi-runtime-target.md`
- `src/cli/commands/install.ts`
