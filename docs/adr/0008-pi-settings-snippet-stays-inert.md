> Owner: PAS maintainers · Updated: 2026-10-29
>
> Superseded in part by ADR-0009.

# ADR 0008: The Pi settings snippet stays inert

- Status: accepted
- Date: 2026-10-29
- Supersedes in part: [ADR 0006](0006-pi-runtime-target.md)
- Contract: `specs/features/product/pi-runtime-target.feature`

## Context

ADR 0006 claimed "The settings snippet documents tiering." The installed snippet
is actually `{"subagents": {}}` — valid JSON with one top-level key and no
example models. That sentence overstates what the file provides. Meanwhile users
may edit the installed copy, and `./pas install --target=pi` overwrote it
byte-for-byte without warning, silently discarding those edits. One artifact also
carries three basenames: `settings.snippet.json` in source and dist, and
`pas-settings.snippet.json` when installed.

## Decision

Keep the shipped snippet inert: `{"subagents": {}}`, with no model IDs or example
keys. Copying placeholder models that a user's Pi does not have would break child
launches. Tiering is documented in `README.md` as a copy-paste block with clearly
marked placeholders and a warning that model IDs must exist in the user's Pi.

For `kind=file` manifest entries whose target is `pi`, installation now writes a
differing installed destination to `<destination>.bak` before overwriting it. An
identical destination is skipped entirely, so reinstalls are idempotent and do
not churn backups. `kind=dir` entries and all other targets keep their existing
behavior.

The three names stay distinct and are documented: the source and dist file is
`settings.snippet.json`; the installed copy is `pas-settings.snippet.json`.

## Consequences

- Model tiering stays a manual step; PAS never merges the snippet into a user's
  settings.
- One `.bak` may accumulate per edited install. It preserves only the most recent
  pre-overwrite copy.
- There is no automatic merge into `~/.pi/agent/settings.json`; users must read
  the README to configure tiering.
- The backup does not protect `settings.json`, only the installed snippet.

## Sources

- `.pas/state/active/00001-pulsar-agent-squad/plan-pi-settings-tiering-fix.md`
- `specs/features/product/pi-runtime-target.feature`
- `config/platforms.manifest` (Pi settings row)
- `src/cli/commands/install.ts`
- `README.md` (Pi target section)
- `tests/unit/pi-target.test.ts`, `tests/integration/install.test.ts`
