> Owner: PAS maintainers · Updated: 2026-10-29
>
> Superseded in part by ADR-0007.
> Superseded in part by ADR-0008.

# ADR 0006: Pi is a first-class runtime target

- Status: accepted
- Date: 2026-10-29
- Contract: `specs/features/product/pi-runtime-target.feature`

## Context

PAS was built for OpenCode: the roster, permissions, distribution pipeline, and
state plugin all assumed OpenCode's agent and plugin model. Pi offers native
subagents and extensions with different semantics — tool allowlists instead of
`permission` blocks, skills instead of a global `AGENTS.md`, and an extension API
instead of an OpenCode plugin. Users want the same PAS workflow on Pi without a
second, drifting prompt set or a manual port per change. The question was
whether to transform the OpenCode prompts or keep separate Pi sources.

## Decision

Add `pi` as a first-class target in `config/platforms.manifest`, with four rows:
agents (`src/agents/pi` → `.pi/agent/agents`), skills (`src/skills/pi` →
`.pi/agent/skills`), settings (`src/templates/platforms/pi/settings.snippet.json`
→ `.pi/agent/pas-settings.snippet.json`), and the toolkit extension
(`src/tools/pi/pas-toolkit` → `.pi/agent/extensions/pas-toolkit`).

1. **Separate Pi sources instead of transforming OpenCode prompts.** Pi prompts
   keep native `pi-subagents` frontmatter (`name`, `description`, `tools`,
   `acceptanceRole`, `timeoutMs`) and are written as faithful, shorter variants
   of the OpenCode contracts. The OpenCode sources are not rewritten or generated
   from. Parity tests guard the shared invariants.
2. **Primary modes ship as skills, not a global `AGENTS.md`.** `/skill:pas-lead`
   and `/skill:pas-turbo` carry `disable-model-invocation: true`, so Pi sessions
   opt in explicitly. A global `AGENTS.md` would hijack every session in every
   project; skills are explicit and reversible.
3. **Thin adapter over a shared core for the toolkit.** The Pi extension is
   `index.ts` plus a byte copy of the canonical core as `core.ts`, assembled at
   build time. State logic lives once in `src/tools/pas-toolkit.ts`; the adapter
   only validates at the Pi boundary and delegates.
4. **Plugin installation is always on for this target.** There is no
   `--with-plugins` flag: `./pas install --target=pi` always installs the sources
   in `config/pi-packages.txt`, skips packages already configured per `pi list`,
   and aborts non-zero on the first failure. `--dry-run` previews destinations and
   commands without mutating. The user removed the flag so operators need not
   remember it; the editable list is the control.
5. **Settings are a copy-safe snippet without automatic merge.** The snippet has
   only the `subagents` top-level key. Installing copies it beside the artifacts;
   merging into a user's Pi settings stays a manual, documented step so PAS never
   rewrites user configuration without confirmation.
6. **The permission boundary is soft and accepted.** Pi exposes tool allowlists
   but no path-scoped denies. The Lead's read-only control-plane boundary and the
   developer's prohibition on editing `.pas/**` and `specs/**/*.feature` are
   contractual in Pi: enforced by prompt and audited by QA, not denied by the
   runtime. `pas_qa` holds `bash` for read-only verification commands, matching
   the OpenCode PAS QA design, so its read-only posture is also contractual.

## Consequences

- **Global install affects all projects.** Artifacts land under `~/.pi/agent`,
  so a PAS install is visible to every Pi project on the machine. Skills are
  opt-in and no global `AGENTS.md` is written; uninstall removes only files whose
  basenames exist in the source trees.
- **Prompt divergence risk.** Separate Pi sources can drift from the OpenCode
  prompts. Parity tests cover the shared invariants; they cannot prove prose
  equivalence.
- **Third-party packages execute by default.** `pi install` runs third-party
  code, always for this target. An editable package list, `--dry-run`, skip of
  already-configured sources, and fail-fast abort contain the blast radius but do
  not remove the risk. The active list is `pi-subagents` and `pi-web-access`;
  optional entries are commented.
- **No path-scoped denies in Pi.** The runtime cannot deny the Lead's read-only
  boundary or the developer's forbidden paths. Compliance rests on prompt
  contract and QA audit, so a misbehaving model can edit outside the approved
  scope.
- **No automatic model tiering.** Workers inherit the parent model. The settings
  snippet documents tiering; automatic merge is out of scope.
- **Deterministic build and idempotent uninstall** are verified for the target;
  the extension assembly is target-specific rather than manifest-pure.

## Sources

- `.pas/state/active/00001-pulsar-agent-squad/plan-pi-runtime-target.md`
- `specs/features/product/pi-runtime-target.feature`
- `config/platforms.manifest`, `config/pi-packages.txt`
- `src/agents/pi/pas_researcher.md`, `src/agents/pi/pas_developer.md`,
  `src/agents/pi/pas_qa.md`
- `src/skills/pi/pas-lead/SKILL.md`, `src/skills/pi/pas-turbo/SKILL.md`
- `src/tools/pi/pas-toolkit/index.ts`, `src/tools/pi/pas-toolkit/core.ts`
- `src/templates/platforms/pi/settings.snippet.json`
- `tests/unit/pi-target.test.ts`, `tests/integration/install.test.ts`,
  `tests/integration/uninstall.test.ts`
- `tests/unit/manifest.test.ts`, `tests/integration/build.test.ts`
