# Changelog

All notable changes to Nova Agent Squad will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`nas agents profile` CRUD subcommand (FEAT-008)**: snapshot the
  current canonical NAS agent model+variant overrides into a named
  sidecar profile, list / rename / delete profiles, and reapply them
  to `opencode.json` via a single command. Profiles are stored at
  `~/.config/opencode/nas/profiles/<name>.json`.
  - Subcommands: `save`, `list`, `load`, `rename`, `delete`.
  - Save: writes only canonical NAS agents, only `model`+`variant`
    fields (extra fields are dropped); rejects duplicate names
    without overwriting the existing file.
  - Load: intersects the profile with `NAS_AGENTS`, silently ignores
    non-canonical / orphaned profile entries (and reports them so the
    user can clean up), removes canonical overrides absent from the
    profile, preserves unrelated top-level config fields and
    non-canonical agent overrides, and creates a timestamped backup
    before the write (matching the `nas skills` / `nas agents setup`
    policy).
  - Rename / delete operate on the profile file only; reject missing
    sources (and an existing target, for rename).
  - Library: `src/cli/lib/profile-store.ts` (pure helpers —
    `canonicalizeProfile`, `applyProfileToConfig`, `saveProfile`,
    `readProfile`, `listProfiles`, `renameProfile`, `deleteProfile`,
    `getProfilePath`, `getProfilesDir`).
  - CLI commands: `src/cli/commands/agents/profile/{save,list,load,rename,delete}.ts`,
    wired as a `profile` subcommand of `nas agents`.
  - Full unit + integration test coverage:
    `tests/unit/profile-store.test.ts`,
    `tests/integration/agents-profile.test.ts`, plus an extended help
    contract (`tests/help_targets_contract_test.sh`).
  - README usage section updated under
    "Saving and applying agent model profiles". `nas agents --help`
    now lists `profile`.

### Changed

- **Per-model variant discovery and unified variant UX (FEAT-001)**:
  `nas agents setup` now populates an in-memory variant registry from
  `opencode models --verbose`. A safe `IDLE`/`IN_JSON` parser associates
  pretty-printed multiline JSON blocks with their preceding model IDs,
  handles nested JSON, and exposes only effective per-model variants.
  The former static family-prefix map is removed. Failed, unavailable,
  empty, or malformed verbose output safely skips variant selection with
  no guessed fallback. Both variant and model caches reset through
  `resetModelsCache()`, and variant reads return defensive copies.
  `nas agents list` and wizard previews now always render exactly one
  `Variant: <configured-or-default>` line and no `Reasoning effort:` line;
  the persisted `agent.<name>.variant` format is unchanged.

- **`nas agents setup` wizard loop and Escape handling (UX)**: the
  interactive wizard now loops back to the main agent list after a
  successful configure (change_model or inherit_default), so a user
  can set several agents in a single run. Escape on the main agent
  list exits cleanly (exit code 0, no error log); Escape on an inner
  step goes back exactly one step (action → agent list, model search
  → action, variant → model search, confirm → variant or model
  search). The `opencode models` list is cached in memory for the
  lifetime of the wizard run so the spawn happens at most once per
  session. The pure loop logic lives in the new
  `src/cli/commands/agents/setup-core.ts`; the Escape-key wiring
  lives in the new `src/cli/lib/prompt-escape.ts`. Backup-before-write
  semantics, the presenter, config-safety, the CLI registry, and
  `nas skills` are unchanged. Genuine (non-prompt) errors still
  surface to the caller; only AbortPromptError is swallowed by the
  loop.

### Fixed

- **`permission.skill` precedence (bugfix)**: the agent's source
  frontmatter contains a top-level `*`: allow which, when merged with
  the user's `opencode.json` at runtime, shadows per-agent
  `permission.skill.<pattern>` rules. The build step now compiles each
  NAS agent's per-agent `permission.skill` block INTO the dist agent's
  frontmatter `permission:` block, placed AFTER the `*`: allow line so
  OpenCode's "last matching rule wins" semantics make the specific
  skill rules override the catch-all. The CLI (`nas skills add` /
  `setup`) is preserved as the source of truth — it still writes only
  to `opencode.json`, the build step is read-only on the config. The
  source agent files (`src/agents/*.md`) are NOT changed; only the
  BUILT dist output gains the `skill:` block. When the user has no
  per-agent rules, the dist file is byte-identical to the source (no
  `skill:` line added). The new env var `NAS_OPENCODE_CONFIG_PATH`
  lets the build step be pointed at a fixture config for testing and
  CI. `nas skills add/setup` messaging updated to tell users to run
  `nas build && nas install` for changes to take effect. Full unit +
  integration + contract test coverage for the new behavior, including
  the orchestrator's nested `task:` block case.

- **`nas skills` scope semantics and UX (bugfix)**: the broad scope now
  means "all NAS agents only" (fan-out over `NAS_AGENTS` as per-agent
  blocks), never top-level `permission.skill`. The CLI no longer writes
  to OpenCode's top-level `permission.skill` block, which would leak
  past NAS to every non-NAS agent via OpenCode's inheritance. The
  wizard now offers a two-way choice (`All NAS agents` / `One specific
  agent`) instead of a confusing three-way. The duplicate scope
  question in the Add flow is removed — scope is asked once, then the
  agent is selected only if needed. Scope values renamed: `global` →
  `all-nas` (the old value is now rejected). The `nas skills list`
  presenter no longer surfaces a "Global" card; the read-only view is
  now strictly per-NAS-agent. `clear --scope all` (the default for
  `nas skills clear`) only clears NAS agent per-agent blocks; legacy
  top-level rules are left untouched. Full unit + integration test
  coverage for the new behavior, including explicit "rejects old
  `global` value" tests and "top-level is preserved" tests.

### Added

- **Build-time `permission.skill` injection**: the build step
  (`src/cli/commands/build.ts`) now reads the user's
  `~/.config/opencode/opencode.json` (or `NAS_OPENCODE_CONFIG_PATH`
  override) and compiles each NAS agent's per-agent
  `permission.skill` block INTO the dist agent's frontmatter
  `permission:` block, placed AFTER the existing `*`: allow line. The
  new helper module `src/cli/lib/skill-injection.ts` is the
  pure-function core (`readAgentSkillBlock`, `findPermissionBlock`,
  `findStarAllowLine`, `injectSkillBlock`,
  `injectSkillPoliciesFromConfig`). Full unit + integration + contract
  test coverage.
- Root `install.sh` bootstrap: a single-command installer at the repo root
  for fresh checkouts. Defaults to the `opencode` target and delegates to
  `nas install --target=opencode` (no parallel install path). Bun detection
  is shared with the `nas` launcher via `scripts/lib/find-bun.sh`.
- **`scripts/lib/find-bun.sh`**: shared bun-detection helper sourced by
  `nas` and `install.sh`. Single source of truth for the `find_bun` shell
  function. Does NOT auto-install bun.
- **`nas update` command**: new top-level subcommand that pulls the current
  upstream branch (`git pull --ff-only`) and optionally rebuilds/reinstalls
  the canonical `opencode` target. Flags: `--check` (dry-run, no changes),
  `--rebuild`, `--reinstall`. Working tree must be clean. Refuses to operate
  outside a git checkout.
- **README usage-first restructure**: install + quick start + updating are
  now the first thing a human reads. Maintenance (architecture, features,
  project structure, project config) is moved to a clearly demarcated
  "Maintenance" section.
- **Contract + unit tests** for the new surface:
  `tests/install_sh_contract_test.sh`, `tests/nas_update_contract_test.sh`,
  `tests/readme_usage_first_contract_test.sh`, `tests/unit/update.test.ts`.
  `tests/help_targets_contract_test.sh` now asserts `update` is exposed in
  `nas --help`.

### Changed

- `nas` (root launcher) now sources `scripts/lib/find-bun.sh` instead of
  redefining `find_bun` inline. Same lookup behavior, no duplicated code.

- Top-level `nas skills` CLI surface for managing `permission.skill` rules in `~/.config/opencode/opencode.json`:
  - Subcommands: `list`, `setup` (interactive wizard), `add`, `remove`, `clear`.
  - Bare `nas skills` defaults to `nas skills list` (byte-identical output).
  - The broad scope (`all-nas`) fans out to every canonical NAS agent as a per-agent block; per-agent scope targets a single NAS agent. The CLI does NOT write to top-level `permission.skill`. Uses native OpenCode wildcards (`*`, `?`) verbatim — no custom matcher.
  - Backups are created before every write, mirroring the `nas agents setup` policy.
  - `nas skills list` renders one card per NAS agent (no "Global" card); the live `opencode debug skill` registry is appended as a reference list (opt out with `--skip-discovery`).
  - `--plain` and `NO_COLOR` follow the same strict color guards as `nas agents`.
  - Full unit + integration test coverage for the library, presenter, and CLI surface.

- Read-only model summary for NAS agents: bare `nas agents` and explicit `nas agents list` both print the configured model, variant, and reasoning effort for every NAS agent (using the existing `formatAgentOutput` formatter, with `default` for unset fields).
- Unit + integration tests for the new summary surfaces (no modifications to the OpenCode config file, byte-identical output between bare and subcommand paths).
- `nas agents --help` now lists both `setup` and `list` subcommands.
- Colorful card-per-agent UX for `nas agents` / `nas agents list`:
  - One card per NAS agent with a visible name, model, variant, reasoning effort, and human-friendly model-capability guidance.
  - Override/default state indicators (`●` for override, `○` for default) — no success/failure semantics.
  - Optional ANSI color, strictly disabled on non-TTY, when `NO_COLOR` is set to any non-empty value, and when the explicit `--plain` flag is passed.
  - `--plain` is accepted on both `nas agents list --plain` and bare `nas agents --plain`, and produces byte-identical plain output between the two surfaces.
  - No new dependencies: a minimal in-house ANSI helper is used.

- **Experimental**: `nas_developer_mini` agent prompt — conservative TDD implementation calibrated for smaller models. Routes through the top-left L cells of the 2D magnitude×complexity matrix (trivial+low, trivial+medium, simple+low).
- **Experimental**: 2D magnitude×complexity routing matrix in the orchestrator, with magnitude levels (low/medium/high) and top-left L cell mini developer routing.
- **Risk flags and precedence rules**: six conditions that force full developer regardless of matrix cell (authorization gate change, security, inter-agent communication, architectural change, user request, ambiguous classification).
- **Planner mode mapping** in the routing table: trivial→lightweight, simple→lightweight, complex→full.
- `nas_developer_mini` added to orchestrator task allowlist and team table.
- Documented change request at `docs/change-request-mini-developer-rollout.md`.

### Changed

- **Orchestrator routing**: upgraded from complexity-only (Phase 1) to 2D magnitude×complexity matrix (experimental). Magnitude is now an active routing axis.
- **Developer delegation**: orchestrator workflow steps updated to select between `nas_developer` (full) and `nas_developer_mini` (mini) based on the routing matrix.
- Updated contract tests in `tests/unit/complexity-routing.test.ts` for the experimental routing matrix and mini developer calibration.

### Added

- Added caveman INJECTION architecture: build-time `sed` injection of caveman rules into agent markdown files at `<!-- INJECT:caveman_developer -->` and `<!-- INJECT:caveman_qa -->` markers, making caveman rules part of the agent system prompt body (no `external_directory`, no `caveman_reference_read`).

## [1.0.0] - 2025-03-07

### Added

- Initial release of Nova Agent Squad
- Four-agent architecture: Orchestrator, Researcher, Developer, QA
- Planning-first workflow with explicit authorization gates
- Tagged Gherkin specification support
- Skill discovery and assignment system
- Memory integration (Mind MCP or stateless fallback)
- Anti-hallucination contract with three-layer validation
- XML-structured output contracts for each agent
- Makefile for easy installation
- Complete documentation (README, CONTRIBUTING, AGENTS, architecture)

### Agents

| Agent | Description |
|-------|-------------|
| `Nova Agent Squad` | Primary orchestrator (manager + tech lead) |
| `nas_researcher` | Technical researcher with Gherkin output |
| `nas_developer` | TDD-focused implementation agent |
| `nas_qa` | Strict QA validator with English status reports |

### Features

- Authorization gates requiring explicit user approval before implementation
- Pre-flight validation for authorization metadata in Developer
- QA verification of authorization for each change scope
- Skill Assignment Contract built by orchestrator
- Memory policy with auto-detection of available backends

---

For older changes, see the commit history.
