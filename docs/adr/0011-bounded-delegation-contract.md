> Owner: PAS maintainers · Updated: 2026-10-31

# ADR 0011: Bounded autonomy through a delegation input contract

**Status:** Accepted

## Context

The engineer and copilot required undefined authorization metadata. An engineer
reported a blocker after requesting an undocumented `authorization.yaml`.
Blanket instructions to escalate uncertainty amplified that ambiguity. Exact
forecast file lists also made legitimate implementation discoveries look like
scope expansion.

## Decision

The OpenCode Lead and Turbo send each pair member a complete, versioned
`<delegation_contract>` brief. The template is embedded in both primary prompts
and checked for parity, so delegation works without PAS source files in the
target workspace. Research-only briefs retain their read-only evidence contract.

The brief contains approval and plan/state references, objective, acceptance,
included/excluded responsibilities and editable areas, hard constraints,
advisory implementation hints, execution policy, verification, role-specific
skill assignments, existing response format, and optional task notes. Worker
roles remain defined by their prompts; no redundant role assignment is added.

Approval comes from existing records. The XML does not replace the approved
plan, persistent `.pas/` state, or Gherkin; no authorization file is introduced.
Workers load relevant references and their own assigned skills. Missing critical
skills block; non-critical missing skills produce warnings.

Forecast files are advisory. Directly necessary changes within authorized areas
and proportionate local refactoring are allowed. Explicit exclusions, existing
closed allowlists, runtime permissions, and user decisions remain binding.
Room `authorized_paths` records files or directory roots; it is not filesystem
enforcement and does not override exclusions in the brief.

Workers investigate facts and fix defects within scope. They escalate necessary
work beyond authority, changed behavior, material expansion, significant
architectural boundary changes, or unavailable required evidence/tooling. A
blocker identifies the necessary step, observed constraint, pertinent checks,
and minimum Lead decision. The Lead distinguishes adjudication from questions
that require a user decision. Unrelated cleanup is not authorized adaptation.

## Consequences

The input contract is more explicit but creates no additional mandatory file
or approval ceremony. Local adaptations are reported through existing response
fields. TDD, one writer, independent peer verification, and room gates remain.
The room API is unchanged. Existing active plans and rooms are not rewritten,
and the Pi worker contracts are not migrated by this change.

Prompt structure tests cannot establish improved model behavior. A repeated
live evaluation is required before claiming fewer unjustified escalations or
comparing models; `docs/delegation-evaluation.md` defines the cases.

This ADR extends ADR 0010; it does not replace its pairing-room decision.

## Sources

- `src/agents/Pulsar Agent Squad.md` (Delegation input contract)
- `src/agents/Pulsar Agent Turbo.md` (Delegation input contract)
- `src/agents/pas_engineer.md` (Pre-flight and Escalation)
- `src/agents/pas_copilot.md` (Delegation input contract and Escalation)
- `src/tools/pas-toolkit.ts` (`openRoom`)
- `tests/unit/delegation-contract.test.ts`
