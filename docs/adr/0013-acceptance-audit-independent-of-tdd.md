> Owner: PAS maintainers · Updated: 2026-10-31

# ADR 0013: Acceptance auditing is independent of TDD history

**Status:** Accepted

## Context

A verification-only delegation could not finish four scenarios because room
closure required RED–GREEN evidence despite no assigned source change. The
protocol conflated an acceptance scenario, executable tests, and implementation
cycles. The peer's purpose is to independently review implementation,
completeness, coverage including relevant edge cases, and passing checks, not
to reconstruct every engineer TDD step.

## Decision

Acceptance closure requires current executable peer review, not driver RED–GREEN
history. The peer can audit existing behavior directly. The driver opens and
closes acceptance units as before; no new role, delegation mode flag, or
authorization artifact is introduced.

Add `verification` for ordinary driver check evidence on existing behavior.
The engineer still uses Red → Green → Refactor for behavior changes; explicit
TDD `green` records retain their preceding-RED rule. Acceptance closure does
not inspect that history or require a separate cycle per scenario. Reports use
`NOT_APPLICABLE` for TDD in verification-only work rather than inventing a failure.

Review freshness follows open/reopen and driver check evidence, independently
from the existence of TDD stages. New audit records use `reviewed_revision_seq`;
legacy `reviewed_evidence_seq` remains readable. Repeated findings on the same
review point count once. Successful independent rechecks can resolve findings
without requiring driver TDD evidence.

Scenarios remain distinct acceptance results. One executed check can establish
several scenarios on an unchanged tree; the peer maps coverage instead of
rerunning it solely for each scenario. Changed behavior or an affected tree
requires fresh verification. Final stable-tree suite, reconciliation, and
end/ack gates remain unchanged, and a failed full suite still prevents delivery.

## Consequences

Verification-only pairs can complete without dummy RED, historical TDD replay,
or falsely relabeling automated checks as manual. The protocol still rejects
missing, failed, or stale independent review. It does not mechanically enforce
engineer test-first practice through acceptance closure, nor does a sequence
marker prove absence of unreported source edits.

This ADR supersedes only ADR 0012's dependency on driver evidence for unit
closure, preserving its collaboration, waiting, and final verification decisions.
Accepted historical ADR files and active rooms are not rewritten. No runtime
installation is performed by this source change.

## Sources

- `src/tools/pas-toolkit.ts` (`reviewRevisionSeq`, `auditUnit`, `closeUnit`)
- `src/agents/pas_engineer.md` (Unit of change)
- `src/agents/pas_copilot.md` (Units and What you review)
- `tests/unit/verification-only-audit.test.ts`
- `specs/features/product/pairing-coordination.feature`
