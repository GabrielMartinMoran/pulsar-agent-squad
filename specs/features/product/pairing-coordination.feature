@pairing-coordination @product
Feature: Pairing stays active through independent final verification
  The driver and peer collaborate until verification and acknowledgement finish.
  Waiting for the partner is normal work, not a task blocker.

  @unit
  Scenario: Waits time out after 10 seconds and can be repeated
    Given a joined peer with no unread messages or room updates
    When the peer waits without an explicit timeout
    Then the wait returns no updates after 10 seconds
    And the peer can wait again using the returned cursor

  @unit
  Scenario: Waiting returns early for messages or evidence
    Given a peer waiting for room updates
    When the driver sends a message or records new evidence
    Then the wait returns before 10 seconds with the updated room state
    And only delivered unread messages are marked read

  @unit
  Scenario: State changes between waits are not missed
    Given a peer holding a previous update cursor
    When a unit closes or the room state changes before the next wait
    Then the next wait immediately reports the change

  @unit
  Scenario: Read receipts and identical rewrites do not wake a waiter
    Given a peer waiting with the current cursor
    When the driver reads messages and the room file is rewritten without meaningful changes
    Then the wait continues until an actual update or timeout

  @unit
  Scenario: Abort and reset wake a waiting participant
    Given a peer waiting for updates
    When the host aborts or resets the room
    Then the wait promptly reports the lifecycle change
    And a retired peer does not consume messages from the new generation

  @unit
  Scenario: Independent executable review is required before closing
    Given an open acceptance unit with no current executable peer review
    When the driver attempts to close it even with dissent
    Then the close is rejected
    When the peer records current command, exit code, and output for the reviewed implementation
    Then a successful review permits closure

  @unit
  Scenario: Existing behavior can be audited without new RED evidence
    Given four acceptance scenarios implemented before the delegation
    And no source change is assigned
    When the peer independently verifies implementation, coverage, and passing checks
    Then all four acceptance results can close without driver RED or GREEN evidence
    And stable final verification and acknowledgement can complete

  @unit
  Scenario: Ordinary verification is not a TDD cycle
    Given an open scenario for existing behavior
    When the driver records verification command, exit code, and actual output
    Then no preceding RED is required
    And acceptance still requires current independent peer review

  @unit
  Scenario: Repeated findings do not consume another correction round
    Given a unit with blocking findings against one reviewed implementation revision
    When the peer repeats those findings without new driver revision evidence
    Then the correction round count remains one

  @unit
  Scenario: Verified peer resolutions clear existing findings
    Given a blocking finding on an open unit
    When the peer successfully rechecks the correction and identifies the resolved finding
    Then the finding is resolved without a driver override

  @unit
  Scenario: The final suite must verify the announced stable tree
    Given all units independently reviewed and closed
    And a passing suite recorded before final readiness
    When the driver announces readiness and attempts to end
    Then the stale suite cannot end the room
    When the peer verifies the stable tree and both participants reconcile
    Then the driver can end and the peer can acknowledge completion

  @unit
  Scenario: Final corrections stay in the pair
    Given final readiness was announced after units closed
    When the driver reopens a unit to fix a final review finding
    Then readiness and reconciliation are invalidated
    And fresh evidence and peer review are required before closing again
