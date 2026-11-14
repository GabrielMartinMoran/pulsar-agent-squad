> Owner: PAS maintainers · Updated: 2026-10-28

# ADR 0009: Agents setup writes Pi settings

- Status: accepted
- Date: 2026-10-28
- Supersedes in part: [ADR 0008](0008-pi-settings-snippet-stays-inert.md)
- Contract: `specs/features/product/target-aware-agents-setup.feature`

## Context

ADR 0008 kept the installed Pi settings snippet inert (`{"subagents": {}}`) and
declared that PAS never merges it into a user's settings. The user explicitly
requested real configuration instead: `pas agents setup` should configure the
subagent models that Pi actually uses. The wizard was also OpenCode-only, so
there was no way to choose the tool it configures. Pi stores model overrides in
`~/.pi/agent/settings.json`, a file PAS did not read or write.

## Decision

Make `pas agents setup` target-aware and let it persist Pi model overrides into
the real user settings:

1. **Target-aware setup.** The wizard asks which tool to configure: OpenCode
   (default) or Pi. `--target=<id>` skips the prompt. Only targets with a setup
   adapter are offered, even though `config/platforms.manifest` declares nine
   targets; the rest are file-copy-only. An unsupported id fails before any
   config is read or written. OpenCode keeps its existing persistence contract
   and restart hint.
2. **Pi persistence shape.** Pi writes
   `subagents.agentOverrides.<agent>.model` and `.defaultProvider`, plus an
   optional `.thinking`. Pi keeps provider and model as separate fields, unlike
   OpenCode's `provider/model` string. The roster is the three worker subagents
   `pas_researcher`, `pas_developer`, and `pas_qa`; the Pi leads are skills and
   are not configurable as subagents.
3. **Merge, preserve, and back up.** Setup merges into the existing
   `~/.pi/agent/settings.json`, preserving unknown keys and their types. It
   backs up the previous file as `<path>.bak.<YYYYMMDDHHMMSS>` only when the
   content changes. Choosing to inherit the default removes only that agent's
   override and prunes empty containers.
4. **Install packages before merging settings.** Missing configured packages are
   installed first because `pi install` rewrites `settings.json` and its
   preservation of `subagents` is undocumented. Setup re-reads the file after
   installing and only then merges model overrides.
5. **Plugins only add.** Setup compares `config/pi-packages.txt` with `pi list`
   and offers to install missing packages once. It never removes packages, so a
   package installed outside the configured list stays untouched.
6. **Version gate for `pi-subagents`.** `pi-subagents` requires Pi 1.2.0 or
   newer. When it is missing and Pi is older, setup skips it with a warning and
   installs the remaining missing packages.
7. **User scope only.** Setup writes `~/.pi/agent/settings.json` and never a
   project `.pi/settings.json`, which Pi ignores without project trust.
8. **Thinking replaces variants.** Pi exposes thinking levels
   `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Setup offers
   them only when the discovered model reports thinking support; there is no
   variant step for Pi.

## Consequences

- **Explicit user action mutates global Pi config.** Running `pas agents setup`
  for Pi and confirming changes writes the user's global Pi settings, not a
  project file. The original behavior was read-only with respect to Pi.
- **No dry run.** Setup has no `--dry-run` in this version. It shows a preview
  and asks for confirmation before writing, but there is no non-mutating
  preview-only mode.
- **Model discovery depends on a human table.** Pi exposes no JSON model list;
  setup parses the fixed-width `pi --list-models` output. When parsing yields
  no models, setup falls back to manual model-id entry. A malformed or changed
  table degrades discovery rather than failing setup.
- **Pi leads are not subagent targets.** `/skill:pas-lead` and
  `/skill:pas-turbo` are skills. Users cannot set a model override for them
  through this wizard.
- **ADR 0008 is superseded only in part.** Its "PAS never merges the snippet"
  clause no longer holds for `pas agents setup`. Its backup-on-overwrite
  behavior for the installed snippet still stands: reinstalling still backs up
  the installed `pas-settings.snippet.json`, and that backup still protects the
  snippet, not `settings.json`.

## Sources

- `.pas/state/active/00001-pulsar-agent-squad/plan-target-aware-agents-setup.md`
- `specs/features/product/target-aware-agents-setup.feature`
- `docs/adr/0008-pi-settings-snippet-stays-inert.md`
- `src/cli/commands/agents/setup.ts`
- `src/cli/commands/agents/targets/pi.ts`
- `src/cli/commands/agents/targets/pi-settings.ts`
- `src/cli/lib/pi-model-list.ts`, `src/cli/lib/pi-plugins.ts`
- `tests/unit/setup-targets.test.ts`, `tests/unit/pi-settings.test.ts`,
  `tests/unit/pi-model-list.test.ts`, `tests/integration/setup-pi.test.ts`
