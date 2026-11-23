@product @capability-policies @tools
Feature: Capability policies for PAS agents
  PAS records the capabilities a user chooses to block in a store it owns,
  separate from the user's OpenCode configuration. The OpenCode build injects
  those rules into each installed agent, so the choice survives building,
  installing, updating and reinstalling, and the two primaries and their three
  workers can be restricted independently.

  @capability-policies @store @contract
  Scenario: The policy store keeps per-agent skill rules and blocked tools
    Given a policy that blocks a skill pattern and two tools for one agent
    When the policy is saved and loaded again
    Then the same skill rule and the same tools are reported for that agent
    And the stored document declares its format version
    And agents without entries are not stored

  @capability-policies @migration @unit
  Scenario: Legacy skill rules migrate once into the policy store
    Given no policy store exists
    And the OpenCode configuration declares skill rules for a PAS agent
    When the policy is loaded
    Then the policy store contains those skill rules for that agent
    And loading the policy again changes nothing

  @capability-policies @migration @unit
  Scenario: Native permission rows win over legacy skill rules during migration
    Given the OpenCode configuration declares a legacy skill rule and a native permission row for the same pattern
    When the policy is migrated
    Then the native effect is the one stored

  @capability-policies @migration @integration
  Scenario: Migration and policy commands never rewrite the OpenCode configuration
    Given a byte copy of the OpenCode configuration
    When the policy is loaded, a tool is blocked, unblocked and cleared
    Then the OpenCode configuration is byte-identical to the copy

  @capability-policies @store @contract
  Scenario Outline: A malformed or unsupported policy store fails with an actionable error
    Given a policy store containing <content>
    When a policy command or a build reads it
    Then the command exits non-zero
    And the message names the store path and the problem
    And the build applies no partial policy

    Examples:
      | content                 |
      | invalid JSON            |
      | an unsupported version  |

  @capability-policies @health @integration
  Scenario: Doctor reports policy health and ignored legacy rules
    Given a valid policy store and skill rules still present in the OpenCode configuration
    When the doctor runs
    Then it reports the policy store as healthy
    And it reports the legacy skill rules as ignored

  @capability-policies @injection @contract
  Scenario: Skills are still injected from the policy store
    Given a stored skill rule for an agent
    When the OpenCode target is built
    Then the agent frontmatter carries the rule as a skill permission entry

  @capability-policies @injection @unit
  Scenario: Blocked tools are injected after every allow rule
    Given an agent whose frontmatter allows every action
    And a policy that blocks a tool
    When the agent is built
    Then the deny for that tool is the last rule matching it
    And a deny already present for that tool is not duplicated

  @capability-policies @injection @integration
  Scenario: A built agent carries the blocked tools
    Given a policy that blocks a tool for the roster
    When the OpenCode target is built twice
    Then every canonical agent carries the deny
    And both builds are byte-identical

  @capability-policies @durability @integration
  Scenario: Reinstall and uninstall restore rather than lose the policy
    Given a policy that blocks a tool
    And an installed agent edited by hand
    When PAS is installed, uninstalled and installed again
    Then each install writes the stored deny and discards the hand edit
    And uninstalling leaves the policy store intact

  @capability-policies @durability @integration
  Scenario: Pi artifacts stay byte-identical
    Given a Pi build of the current sources
    When a tool is blocked and both targets are built
    Then the Pi artifacts are byte-identical to the previous build

  @capability-policies @cli @unit
  Scenario: Blocking fans out to every PAS agent by default
    Given an empty policy
    When a tool is blocked without naming an agent
    Then all five PAS agents have that tool blocked

  @capability-policies @cli @unit
  Scenario: Blocking targets one agent on request
    Given an empty policy
    When a tool is blocked for one named agent
    Then only that agent has the tool blocked

  @capability-policies @cli @unit
  Scenario: Tool identifiers normalize and unknown identifiers warn
    Given a block request for "bash"
    When the policy is saved
    Then the policy records "shell"
    And the report names the normalization
    And an unrecognized identifier is stored with a warning

  @capability-policies @cli @unit
  Scenario: Unblocking and clearing remove only the selected entries
    Given a policy with blocked tools for several agents
    When one tool is unblocked for all agents
    Then only that tool disappears
    When the blocked tools of one agent are cleared
    Then that agent has no blocked tools
    And the other agents keep theirs

  @capability-policies @cli @integration
  Scenario: The tools list shows the current policy per agent
    Given a policy with blocked tools
    When the tools list runs
    Then it shows one entry per PAS agent with its blocked tools
    And an agent without blocked tools is shown as having none
    And it writes nothing

  @capability-policies @setup @unit
  Scenario: The interactive setup blocks and unblocks tools and cancels cleanly
    Given the interactive setup
    When the user blocks a tool
    Then the store reflects the change
    When the user unblocks that tool
    Then the store reflects that change too
    When the user cancels
    Then the store keeps the last applied state
    And escaping the main menu exits without an error

  @capability-policies @runtime @manual
  Scenario: A blocked tool is denied at runtime
    Given an installed agent whose policy blocks a tool
    When a live session of that agent tries to use the tool
    Then the tool is refused
    And whether the tool was listed and the exact denial text are recorded

    # Manual procedure (plan section 6): the user blocks webfetch for one agent,
    # runs `pas install --target=opencode`, restarts OpenCode, opens that agent in
    # a new session, asks it to fetch a URL, and reports whether the tool was
    # listed and the exact denial text. No automated test is written for this.
