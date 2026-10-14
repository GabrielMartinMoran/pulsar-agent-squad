> Owner: PAS maintainers · Updated: 2026-10-14

# Architecture

Pulsar Agent Squad (PAS) is a cost-efficient, contract-driven engineering
harness: one strong model runs the control plane and delegates bounded work to
lightweight workers. This doc is a map — it points to the sources instead of
restating them.

## What PAS is

PAS keeps engineering discipline while reserving strong-model reasoning for the
decisions that need it. The Lead plans, approves, and adjudicates; light workers
research, implement, and verify under closed contracts. Sources:
`docs/product.md` (product view), `specs/features/product/*.feature`
(behavior).

## Execution model

The runtime is OpenCode. The roster is fixed: the Lead plus three workers, each
with its own prompt and permission profile under `src/agents/`.

| Agent | Model | Role | Prompt |
|---|---|---|---|
| PAS Lead | strong | Control plane: plan, approve, adjudicate, persist | `src/agents/Pulsar Agent Squad.md` |
| `pas_researcher` | light | Read-only evidence worker | `src/agents/pas_researcher.md` |
| `pas_developer` | light | Bounded TDD implementer, one atomic task | `src/agents/pas_developer.md` |
| `pas_qa` | light | Read-only verifier, one PASS/FAIL/BLOCKED verdict | `src/agents/pas_qa.md` |

Permissions are per role and enforced by the runtime, not by prompt text: the
Lead reads `.pas/**`, `specs/**/*.feature`, and `docs/**`, and edits only PAS
artifacts; the developer shells and writes source but never PAS artifacts;
researcher and QA are read-only. The exact profiles are the frontmatter of each
prompt; the Lead contract is `## Runtime permissions and capabilities`. Sources:
`specs/features/product/lead-runtime-permissions.feature`,
`specs/features/product/worker-internal-parallelism.feature`.

## Distribution pipeline

Prompts and the state toolkit ship as built artifacts:

```text
src/agents/*.md + src/tools/pas-toolkit.ts
  -> ./pas build --target=opencode  -> dist/platforms/opencode/{agents,plugins}/
  -> ./pas install --target=opencode -> ~/.config/opencode/{agents,plugins}/
```

Sources: `src/cli/commands/build.ts`, `src/cli/commands/install.ts`,
`config/platforms.manifest`. Builds are deterministic; the installed copy must
match `dist/`. Edit `src/` and rebuild — never edit `dist/` or the installed
copy.

## State

Feature state is the local source of truth. It lives in numbered directories
(`NNNNN-slug`) under `.pas/state/active/` and `.pas/state/archived/`, capped by
`max_active` (default one). A new feature takes the next five-digit ID: the
highest valid number across active and archived, plus one, starting at `00001`.
Every lifecycle operation runs through the installed `pas_toolkit` plugin
(`list`, `check`, `new`, `archive`); the tool blocks malformed or conflicting
state instead of guessing, and the Lead surfaces hygiene violations, offering
cleanups as separately authorized work. Configuration: `.pas/pas.config.yaml`.
Sources: `specs/features/product/state-hygiene.feature`,
`docs/adr/0001-feature-state-numbered-dirs.md`,
`docs/adr/0003-pas-toolkit-as-installed-tool.md`,
`src/agents/Pulsar Agent Squad.md` (State lifecycle and hygiene).

## Memory

Mind is the configured memory backend (`memory:` block in
`.pas/pas.config.yaml`). The Lead persists checkpoints and durable decisions;
workers only request `memory_writes` and never write memory directly. Local
artifacts stay understandable without Mind. Sources: `.pas/pas.config.yaml`
(memory block), `src/agents/Pulsar Agent Squad.md` (Checkpoint cycle).

## ADR index

Architecturally significant decisions, oldest first:

- `docs/adr/0001-feature-state-numbered-dirs.md` — numbered, single-writer
  feature state directories.
- `docs/adr/0002-living-docs-as-maps.md` — living docs as maps, updated in the
  same change.
- `docs/adr/0003-pas-toolkit-as-installed-tool.md` — state tooling distributed
  by the installer.
- `docs/adr/0004-retire-the-prd.md` — the PRD is retired; docs, specs, prompts,
  and ADRs are the living sources.
