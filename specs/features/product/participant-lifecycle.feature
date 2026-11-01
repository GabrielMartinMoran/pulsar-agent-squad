@participant-lifecycle @product
Feature: Participant availability and host killswitch
  Working and waiting activity are distinct from whether a session can respond.
  The host can stop hung executions without deleting their sessions or work.

  @unit
  Scenario: Mutual waiting identifies the next actor
    Given both active participants are waiting for a response
    And a current close proposal is ready for independent review
    When the peer waits for updates
    Then the wait returns MUTUAL_WAIT before its deadline
    And the peer is elected to review or clarify what is missing

  @unit
  Scenario: Repeated waiting does not create notification ping-pong
    Given a participant received the mutual-wait notice
    When it waits again without actual progress
    Then the notice is not re-emitted for the same episode
    And the elected responsibility remains visible after the timeout

  @unit
  Scenario: Activity-only changes are not progress
    Given a participant is working
    When activity is declared again or a nonblocking inbox check occurs
    Then the progress cursor does not change
    And no mutual wait is reported

  @unit
  Scenario: Per-step execution events do not mark a fresh worker finished
    Given a participant has just joined the room
    When a succeeded event or an idle timestamp from an earlier step is observed
    Then the participant remains active
    And it can declare working and continue

  Scenario: Finished peers are unavailable even while listed in the room
    Given the host received the peer's returned child result
    And the host records finished for its exact session and generation
    When the driver waits for its review
    Then PEER_UNAVAILABLE is returned promptly
    And sending room messages does not resume the peer

  @unit
  Scenario: Completion reports target the exact current participant
    Given the host receives a child completion
    When it records finished for the matching session and generation
    Then the participant is marked unavailable for further pairing
    But a report for a different or retired session is rejected or ignored

  @unit
  Scenario: Killswitch aborts before runtime interruption
    Given a room with a driver and peer
    When the host stops both with a reason
    Then the room is aborted before either interruption is requested
    And only their current session IDs are interrupted with resume disabled
    And per-participant results are recorded

  @unit
  Scenario: Killswitch is bounded and reports partial failure
    Given one runtime interruption is refused or never completes
    When the host activates the killswitch
    Then the failure or timeout is reported without claiming successful termination
    And cancellation is requested on timeout
    And reset cannot replace unconfirmed old executions

  @unit
  Scenario: Killswitch cannot target other sessions
    Given a room with current participant IDs
    When a worker calls stop or a stale generation or invalid target is supplied
    Then no runtime interruption is requested

  @unit
  Scenario: Late stop results cannot alter a replacement generation
    Given interruption was requested for frozen participant IDs
    When a replacement generation exists before the old result returns
    Then only the original IDs were targeted
    And the replacement generation is not changed by that result

  @unit
  Scenario: Restarted executions invalidate stop confirmation
    Given the killswitch previously interrupted a participant
    When its runtime execution starts again
    Then its stop is reported unconfirmed
    And reset cannot replace it until it is stopped again
