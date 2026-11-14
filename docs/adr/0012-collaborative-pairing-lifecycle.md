> Owner: PAS maintainers · Updated: 2026-10-31

# ADR 0012: Collaborative pairing through final verification

**Status:** Accepted

## Context

A peer returned a partial BLOCKED audit with two scenarios pending and no
external blocker. It repeatedly checked empty inbox/state while the driver
continued. The driver later exhausted its budget with unverified edits. Unit
closure did not actually require an independent peer audit, despite the prompt
contract. Early full-suite checks also observed an intermediate changing tree.

## Decision

Keep the pair active until end/ack, concrete escalation, cancellation/retirement,
or exhausted budget. Pending partner work and wait timeout are not blockers.
Increase the driver budget from 120 to 180 steps and the peer from 100 to 160.
Increase the discussion cap from 16 to 32 messages per unit while preserving
evidence/audit exemptions and bounded unsuccessful correction revisions.

The inbox tool waits 30 seconds by default, capped at 60, using internal polling.
It wakes on messages and meaningful room changes, returns an opaque cursor,
and permits another wait after timeout. The cursor excludes read receipts and
identical rewrites. Explicit `wait_s: 0` preserves immediate checking; the core
message-only `readInbox` remains available for existing consumers. Polling is
read-only except when delivering unread messages. Lifecycle resets wake retired
participants without giving them membership in the new generation.

Closure requires a current executable peer audit with command, integer exit
code, and actual output after latest driver evidence. Dissent cannot replace a
missing independent audit. Audits may resolve existing finding IDs after a
successful recheck. Correction rounds count distinct reviewable driver-evidence
revisions with blocking findings, not repeated observations or normal dialogue.

After all units close, the driver sends `ready_for_final_audit` and stops editing.
The peer verifies that stable tree, records fresh suite evidence, and reconciles
files with the driver. Only then can end/ack complete. A final correction uses
driver-only `reopen`, which invalidates final readiness and reconciliation.
The pair records fresh checks, reviews and closes the unit, and announces a new
stable tree. It does not invent failed RED evidence for preserved behavior.

## Consequences

The toolkit enforces missing/stale-review and final-suite ordering; prompts
enforce cooperation and truthful handoffs. A cursor or evidence sequence is not
a filesystem revision hash: unreported source edits remain a limitation, and
independent review must examine the actual final diff. Existing room files are
not migrated or reset by this change; no installed runtime is updated silently.
The Pi adapter distributes the same core, but Pi worker prompts remain unchanged.

Deterministic room tests verify waiting and lifecycle rules without real
30-second sleeps. Live repeated model evaluations are still required to measure
premature-return rates and step savings. This ADR extends ADRs 0010 and 0011;
their accepted records are preserved.

## Sources

- `src/tools/pas-toolkit.ts` (`waitForUpdates`, `auditUnit`, `closeUnit`, `endRoom`)
- `src/agents/pas_engineer.md` (Pairing collaboration and waiting)
- `src/agents/pas_copilot.md` (Verification order and Pairing collaboration)
- `tests/unit/pairing-coordination.test.ts`
- `specs/features/product/pairing-coordination.feature`
- `docs/delegation-evaluation.md`
