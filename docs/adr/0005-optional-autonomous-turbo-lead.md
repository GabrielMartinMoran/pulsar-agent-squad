> Owner: PAS maintainers · Updated: 2026-10-26

# ADR 0005: Optional autonomous Turbo primary

**Status:** Accepted

## Context

The original PAS Lead has a deliberate read/edit/shell control-plane boundary:
it delegates research, implementation, and QA to light workers. That is safe
and cost-aware, but a strong primary model pays orchestration latency and loses
context continuity on small and medium work.

## Decision

Add **Pulsar Turbo** as a second OpenCode primary agent under
`src/agents/Pulsar Turbo.md`. Reuse the existing `pas_researcher`,
`pas_developer`, and `pas_qa` subagents. Leave their prompts and the
original `Pulsar Agent Squad.md` untouched.

Turbo may inspect, edit, execute, and verify directly. It uses observed
complexity, risk, independent review value and remaining context to decide
whether a bounded worker is worthwhile. Every delegated worker can be spawned
in the background when the runtime supports it; implementation and QA never
race on a changing tree. Completion reports must be adjudicated by Turbo.

**Unchanged gates:** scoped single-use approval before source changes,
numbered single-writer PAS state and global Gherkin, skill assignment, TDD,
cheapest sufficient test levels, required full checks, living docs, memory
continuity, bounded retries, and explicit final QA verdict. Self-QA is allowed
for ordinary work; high-risk changes require independent QA. The final report
marks `SELF` versus `INDEPENDENT`.

The agent is included in the existing OpenCode manifest's source directory;
CLI roster, model profiles, permission-skill injection, validation, and
uninstallation must recognize its exact filename.

## Consequences

- Lower delegation overhead and fewer forced context handoffs for local tasks.
- Potentially higher main-model token use. Context-aware routing mitigates but
  does not remove this trade-off.
- The primary agent now has edit and shell permissions, so enforcement of the
  approval gate is contractual rather than runtime-denied, unlike the
  original Lead's hard write boundary. It remains available for stricter
  separation.
- Prompt-level complexity assessment and optional self-QA cannot guarantee
  optimal routing or fully independent review. Run runtime manual evaluations
  alongside structural and integration tests.
- No duplicate workers or global runtime mode switch; users select the agent.

## Sources

- `src/agents/Pulsar Turbo.md`
- `src/agents/Pulsar Agent Squad.md`
- `specs/features/product/turbo-mode.feature`
- `tests/unit/turbo-mode.test.ts`
- `src/cli/commands/build.ts`
- `src/cli/commands/agents/presenter.ts`
