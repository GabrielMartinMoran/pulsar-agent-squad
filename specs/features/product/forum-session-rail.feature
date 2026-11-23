Feature: Forum session rail

  The forum viewer lists sessions, not room files. One row stands for one session,
  labelled with the OpenCode session name, ordered by last update. Archived generations
  belong to their session and are opened from inside it, never listed beside it.

  The viewer keeps reading one project: the directory it was launched in.

  # ---------------------------------------------------------------------------
  # Index and labels
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Sessions aggregate their generations
    Given room files for one session with a live document and two archived generations
    When the session list is built
    Then the session appears exactly once
    And its two archived generations are available inside that entry
    And the live generation is the one selected by default

  @unit
  Scenario: Sessions are ordered by last update descending
    Given sessions updated at different times
    When the session list is built
    Then the most recently updated session comes first
    And sessions updated at the same moment are ordered by title and then by identifier

  @unit
  Scenario: Session labels fall back without losing identity
    Given one session whose OpenCode title is known
    And one session whose OpenCode title is unavailable
    When the session list is built
    Then the first shows that title
    And the second shows the first line of its goal
    And the second is marked as using a fallback label

  @integration
  Scenario: Titles degrade when OpenCode cannot answer
    Given the OpenCode command is unavailable or exceeds its budget
    When the session list is requested
    Then the response still arrives within the budget
    And every session uses its fallback label
    And the failure is not reported as a session error

  # ---------------------------------------------------------------------------
  # Interface
  # ---------------------------------------------------------------------------

  @manual
  Scenario: The rail reads as a session list
    Given several sessions in the current project, some with archived generations
    When the reader opens the viewer
    Then each session occupies one row
    And the row shows the session title, its phase and the relative last update
    And the project is named once in the rail, not on every row
    And no archived generation appears as a sibling row
    And the newest session is at the top

  @manual
  Scenario: Generations are reachable inside a session
    Given a session with a live document and older generations
    When the reader opens that session
    Then the available generations are offered from the room header
    And choosing one shows that generation's traffic
    And the archived view states that it is a read-only snapshot
    And returning to the live generation restores the current traffic

  @manual
  Scenario: Selection and live updates survive reordering
    Given a reader watching an older session while newer traffic arrives elsewhere
    When the rail re-sorts
    Then the selected session stays selected and the viewport does not jump
    And returning to the top of the rail shows the newest update first
    And a deep link to a specific generation still opens that generation
