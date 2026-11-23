Feature: Forum viewer

  The `pas forum` command starts a local, read-only web app that shows the
  pairing forums the PAS agents use to coordinate a delegation: rooms, topics,
  posts, reviews, review evidence, escalations and final close-out.

  The viewer is an observer only. It never writes to the room store, never
  changes a phase, and never exposes OpenCode sessions, tool calls or any
  traffic other than the room documents under `.pas/rooms/`.

  # ---------------------------------------------------------------------------
  # Command lifecycle
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Starting the viewer reports a reachable URL
    Given a workspace whose room store holds at least one forum room
    When the user runs "pas forum"
    Then the command prints the URL it is serving on loopback
    And an HTTP request to that URL returns the viewer page

  @integration
  Scenario: A workspace without forum state fails with guidance
    Given a directory with no room store
    When the user runs "pas forum" in that directory
    Then the command exits non-zero
    And the message says that no PAS room store was found and how to fix it

  @integration
  Scenario: An occupied port fails without a half-started viewer
    Given another process already listens on the requested port
    When the user runs "pas forum" on that port
    Then the command exits non-zero
    And the message names the port that could not be bound
    And no viewer route answers on that port

  @integration
  Scenario: Interrupting the command stops the server
    Given the viewer is serving
    When the user interrupts the command
    Then the server stops and the port is released
    And the command exits successfully

  # ---------------------------------------------------------------------------
  # Room discovery
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Listing rooms derives the pair phase and participants
    Given room documents in active, closing, stalled, closed and aborted states
    When the room list is built
    Then each room reports its derived phase, generation, participants and topic counts
    And the phase follows the persisted status, stall, expectation and final fields
    And a room whose participants are all present and working reports "active"

  @unit
  Scenario: Legacy and unreadable rooms degrade instead of failing
    Given a legacy room without a forum object
    And a room file that is not valid JSON
    And a valid forum room
    When the room list is built
    Then the legacy room is labeled as legacy and not as a forum
    And the malformed file is reported as unreadable
    And the valid forum room still lists with its own data

  # ---------------------------------------------------------------------------
  # Transcript
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The timeline merges posts with room events in sequence order
    Given a room whose forum posts are mirrored into the room messages
    When the timeline is projected
    Then each post appears exactly once
    And the entries are ordered by their sequence number
    And room events appear between posts at their own sequence position
    And each post keeps its category, revision and topic from the forum record

  @unit
  Scenario: Archived generations are listed separately from the live room
    Given a room with archived generation files
    When the room list is built
    Then each archived generation appears as its own read-only entry
    And selecting an archived generation shows that generation's traffic
    And the live entry keeps showing only the current generation

  @unit
  Scenario: Oversized evidence is bounded and marked
    Given a post whose review evidence output exceeds the display bound
    When the transcript is projected
    Then the output is cut at the bound
    And the entry states that the output was truncated

  # ---------------------------------------------------------------------------
  # HTTP API
  # ---------------------------------------------------------------------------

  @contract
  Scenario: The API follows the documented contract
    Given a running viewer
    When a client requests the room list and a single room
    Then both responses match the documented room and detail shapes
    And every timeline entry identifies its role, category, sequence and kind
    And an unknown room returns a JSON not-found error

  @integration
  Scenario: Unsafe or malformed room identifiers are rejected
    Given a running viewer
    When a client requests a room whose identifier contains a path separator or traversal
    Then the viewer answers with a client error
    And no request resolves a path outside the room store

  @integration
  Scenario: Static assets are served with correct content types
    Given a running viewer
    When a client requests the page, the script and the stylesheet
    Then each response carries its declared content type
    And the responses are not cached by the browser
    And a request for an unknown asset path returns not-found

  @integration
  Scenario: The event stream announces room changes
    Given a client subscribed to the event stream
    When a room document changes on disk
    Then the stream delivers a change event naming that room
    And the stream keeps sending heartbeats while the room is idle
    And a second client receives the same change event

  # ---------------------------------------------------------------------------
  # Interface
  # ---------------------------------------------------------------------------

  @manual
  Scenario: The room view shows the delegation at a glance
    Given a workspace holding a closed forum room and a live one
    When the reader opens the viewer
    Then the rail lists live and archived entries and marks the selection
    And the room header shows the goal, phase, generation and participants
    And each participant shows its availability and declared state
    And the timeline shows role, category, revision, time and seen-by per entry
    And the topic board shows review state, declared paths and revision per topic
    And the close-out panel shows reconciliation and final-approval state when present

  @manual
  Scenario: Live updates keep the reader in place
    Given the reader has scrolled away from the newest entry
    When new traffic arrives for the selected room
    Then a new-traffic marker appears without moving the viewport
    And the marker clears when the reader returns to the newest entry
    And focus stays where the reader left it
    And a lost connection is reported and recovers without a reload

  @manual
  Scenario: The interface stays usable by keyboard and in both themes
    Given the viewer is open
    When the reader navigates the rail, tabs, disclosures and filters by keyboard
    Then every interactive element is reachable and shows visible focus
    And neither the light nor the dark theme loses readable contrast
    And reduced-motion preferences are honored
    And the layout stays usable at a narrow viewport
