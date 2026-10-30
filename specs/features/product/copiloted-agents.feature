@copiloted-agents @product
Feature: Copiloted engineer
  El harness delega implementación y verificación en una unidad copilotada: un
  engineer que escribe y se auto-verifica por unidad, y un copilot read-only que
  audita el proceso re-ejecutando, no leyendo afirmaciones. Una unidad de cambio
  es un escenario de aceptación.

  @unit
  Scenario: The lead hosts, the engineer drives and the copilot audits
    Given no room exists
    When the lead opens a room with the authorized scope
    Then the lead is recorded as host
    When the engineer joins as driver and the copilot joins as peer
    Then only the driver may close a unit
    And the host is excluded from the discussion

  @unit
  Scenario: Units are acceptance scenarios and open in order
    Given a room whose scope lists three tagged scenarios
    When the engineer opens the second scenario before the first closes
    Then the call is rejected and the first unit stays the only open one

  @unit
  Scenario: A unit cannot reach green without red
    Given an open unit with no red evidence
    When the engineer records green evidence
    Then the call is rejected

  @unit
  Scenario: Evidence must be reproducible
    Given an open unit
    When the engineer records evidence without a command, an exit code, or an output excerpt
    Then the call is rejected

  @unit
  Scenario: The peer cannot close a unit
    Given an open unit
    When the copilot attempts to close it
    Then the call is rejected

  @unit
  Scenario: A blocking finding prevents unit closure
    Given an open unit with a blocking finding from the peer
    When the driver attempts to close the unit
    Then the call is rejected
    When the driver closes it with explicit dissent
    Then the unit closes and the dissent is recorded

  @unit
  Scenario: Findings carry a category and a severity
    Given an audit entry
    When the peer records a finding without a valid category or severity
    Then the call is rejected

  @unit
  Scenario: The ack requires a green full-suite audit from the peer
    Given every unit closed
    When the peer acks without a full-suite audit entry
    Then the call is rejected
    When the peer records a full-suite audit that failed
    Then the room stays open and blocking findings are raised
    When the engineer fixes them and the peer records a passing full-suite audit
    Then the ack is accepted

  @unit
  Scenario: The driver cannot close with unread messages
    Given an open unit with a message the driver has not read
    When the driver attempts to close the unit
    Then the call is rejected

  @unit
  Scenario: Overruling a challenge requires explicit dissent
    Given an open unit whose last peer message is a challenge
    When the driver closes the unit without dissent
    Then the call is rejected
    When the driver closes it with non-empty dissent
    Then the unit closes and the dissent is recorded

  @unit
  Scenario: Message cap stops two agents agreeing forever
    Given an open unit at the discussion message cap
    When either participant sends a reply
    Then the call is rejected
    And propose_close, ack and escalate are still accepted
    And evidence and audit entries do not count toward the cap

  @unit
  Scenario: Correction rounds are bounded
    Given a unit whose third correction round ended in blocking findings
    When the peer records another blocking finding on that unit
    Then the room refuses a fourth round
    And the only exit is an escalation

  @unit
  Scenario: An escalation stops the room instead of waiting
    Given an open unit
    When the peer escalates with an action and a reason
    Then the driver cannot close the unit
    And the driver cannot end the room
    And the peer returns control to the host instead of polling

  @unit
  Scenario: Ending requires every unit closed and a peer ack
    Given a room with an open unit
    When the driver ends the room
    Then the call is rejected
    Given every unit closed and nothing unread
    When the driver ends the room
    And the peer acks within the wait window
    Then the room becomes closed
    But when no ack arrives
    Then the room stays awaiting-ack and is reported as an anomaly

  @unit
  Scenario: Both agents reconcile their file list before the ack
    Given every unit closed
    And the driver submitted its file list
    When the peer submits a different file list
    Then a discrepancy is recorded and the ack is rejected
    When one of them corrects its list and both lists match
    Then the room records reconciliation and the ack is allowed

  @unit
  Scenario: Rooms are keyed by the root session
    Given an engineer session and a copilot session whose parent is the lead
    Then both resolve to the same room
    And the lead session resolves to the same room

  @unit
  Scenario: Concurrent writers never lose a message
    Given two participants sending at the same time
    Then every message is present exactly once in the store

  @unit
  Scenario: Unread notices reach the model prompt
    Given unread messages for a session
    When the context hook runs for that session
    Then a notice naming the count and senders is appended to the system prompt
    And the hook does not mark anything read

  @unit
  Scenario: Notices survive compaction
    Given the plugin registered the context and compaction hooks
    When a compaction hook runs
    Then the notice is appended there too

  @contract
  Scenario: The copilot cannot write
    Given the built pas_copilot prompt
    Then its frontmatter denies edit and write
    And it allows bash
    And it denies launching subagents

  @contract
  Scenario: The engineer cannot parallelize bash
    Given the built pas_engineer prompt
    Then it permits parallel read, grep and glob
    And it does not permit concurrent bash
    And it keeps TDD phases, writes and shared-state checks sequential

  @contract
  Scenario: The engineer does not run the full suite
    Given the built pas_engineer prompt
    Then it requires scoped tests after each phase
    And it does not require the engineer to run the full suite
    And it requires deferring the full-suite verdict to the peer

  @contract
  Scenario: The copilot reviews code, not only claims
    Given the built pas_copilot prompt
    Then it requires reviewing the changed code
    And it names unnecessary additions as a review concern
    And it requires observing skill application in the artifact, not the report
    And it requires a UI review when the diff touches an interaction surface

  @contract
  Scenario: UI and UX are judged across surfaces
    Given the built pas_copilot prompt
    Then it requires discovering the project's guidelines instead of a fixed path
    And it requires judging usability for web, TUI and CLI changes
    And it requires reporting missing guidance instead of inventing it

  @contract
  Scenario: Escalation actions are a closed vocabulary
    Given the built pas_copilot prompt
    Then escalation actions are re-delegate, fix_brief or escalate_to_user
    And both final reports carry the escalation field

  @contract
  Scenario: Both reports carry the comparable block
    Given the built pas_engineer and pas_copilot prompts
    Then both declare the eight shared fields with the same names
    And both declare the same vocabulary for each shared field
    And the engineer defers the full-suite status to the peer

  @contract
  Scenario: The lead caps a delegation at six units
    Given the built lead prompt
    Then it requires slicing work so a delegation holds at most six units
    And it names the step budget as the reason

  @contract
  Scenario: The git delta is a hint, not a gate
    Given the built lead prompt
    Then it requires capturing a working-tree baseline before spawning the pair
    And it describes the delta as evidence to ask about, not an automatic failure
    And the plugin itself does not execute git

  @contract
  Scenario: Every legacy rule has a destination
    Given the migration ledger for the 117 inventoried rules
    Then every rule names exactly one destination
    And no destination is retired without a written reason
    And every parity pin is present in its target prompt

  @integration
  Scenario: The roster ships the copiloted pair
    When the opencode target is built
    Then dist contains pas_engineer and pas_copilot
    And dist does not contain pas_developer or pas_qa

  @integration
  Scenario: The plugin stays a single distributable file
    When the opencode target is built twice
    Then the built plugin equals its source byte for byte
    And both builds are identical
    And the installed copy equals the source

  @integration
  Scenario: Uninstall removes every shipped agent
    Given an installed roster
    When uninstall runs
    Then no PAS agent file remains

  @manual
  Scenario: A real pairing session reaches a verdict
    Given the harness installed
    When the lead delegates one small feature to the pair
    Then every unit records red, green and a peer audit with its own command
    And at least one challenge changes the implementation
    And the room closes with a peer ack
    And the lead adjudicates from the transcript
