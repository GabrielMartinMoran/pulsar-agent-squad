> Owner: PAS maintainers · Updated: 2026-11-01

# ADR 0014: Participant lifecycle and a real host killswitch

**Status:** Accepted

## Context

Activity-unaware waits allowed both pair members to wait on each other. In a
separate observed case, a copilot had already returned BLOCKED, but the driver
and Lead continued sending room messages and waiting for it. Room membership
did not represent execution availability. Existing abort/reset operations only
changed room state; they did not interrupt hung runtime sessions.

## Decision

Change the default inbox wait to ten seconds, retaining the sixty-second cap
and explicit nonblocking checks. Record participant working/waiting activity
with its response dependency. Exclude activity and deduplication bookkeeping
from the progress cursor. A mutual-wait episode elects the next protocol actor;
each participant receives the notice once, with responsibility still visible
on subsequent timeouts. Actual progress creates a new episode. Stale waiting
state, cancelled waits and completed rooms do not generate false alerts.

Track availability independently from activity. `session.execution.started`
reactivates a current member, but per-step `execution.succeeded/failed` events
and idle timestamps are **not** proof that the subagent finished: OpenCode emits
them for individual steps, and delayed events can arrive after a fresh member
joined. Events older than the member's join are ignored. A failed lookup is
unknown, not proof of termination.

Only the host records `finished`/`unavailable`, after receiving the child's
actual result, through `pas_room_activity` for an exact participant session and
generation, with a reason. The tool verifies runtime completion and rejects a
stale report for a resumed execution. Source of availability is recorded so a
self-declaration is not runtime-confirmed termination. A live worker's own
`working`/`waiting_for_response` declaration always reactivates it while the
room is open: a session making a tool call is alive by definition. Admitting a
self-declaration is not a work gate.

This corrects the first version of this ADR: deriving availability from
per-step execution events and `idle >= busy` marked fresh workers finished
immediately after joining, causing generations 7 and 8 to stop before any unit.
Runtime events are therefore advisory except for `started`; completion is a
host action backed by the returned child.
Finished participants cause `PEER_UNAVAILABLE`; room messages and escalation
resolution do not resume execution. The Lead manages recovery through the
harness, not by becoming the missing peer. Event subscriptions are cancelled
when the plugin unloads.

Add host-only `pas_room_stop`: select driver, peer or both (default), supply a
reason, and use expected generation to reject stale requests. Abort the room
first, capture current session IDs, then request
`session.interrupt({ sessionID, resume: false })` concurrently. Runtime requests
have a five-second deadline and cancellation signal; bounded room-lock waits
still apply. Record interrupted, already finished, failed, timeout or not joined
per participant. No arbitrary session ID, session deletion, source rollback,
or automatic kill is allowed. A selective stop aborts pairing while leaving the
unselected execution alive. Replacement after a stop requires confirmed
termination of all old participants; restarted executions invalidate that
confirmation. Late results do not mutate a new generation.

## Consequences

More reliable coordination requires explicit working declarations when a
participant resumes substantive work outside room tools. Waiting and room
writes update activity automatically; reads do not pretend to make progress.
No new approval artifact, dependency, or strong-worker fallback is introduced.
The pair's acceptance, independent final verification, and end/ack remain.

Interruption confirms OpenCode-owned execution cancellation, not termination
of every external subprocess. Missing capability, failure and timeout remain
unconfirmed. Tests use mock runtime sessions and a controlled wait clock; no
live session is stopped by verification. Installed runtime and existing room
files are not updated or migrated silently by this source change.

This ADR replaces ADR 0012's thirty-second default and extends its lifecycle
controls. ADR 0013's acceptance/TDD separation remains unchanged.

## Sources

- `src/tools/pas-toolkit.ts` (participant activity, lifecycle tracking, stop)
- `tests/unit/participant-lifecycle.test.ts`
- `specs/features/product/participant-lifecycle.feature`
- [OpenCode V2 server plugin API](https://opencode.ai/v2/docs/build/plugins/server)
- [OpenCode V2 HTTP API](https://opencode.ai/v2/docs/api)
