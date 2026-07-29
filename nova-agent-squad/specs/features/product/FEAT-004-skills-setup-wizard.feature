@delta-added
Feature: nas skills setup wizard navigation, cancellation, and loop-back

  Background:
    Given the wizard starts at the `nas skills setup` main menu
    And the OpenCode config has no pre-existing skill policy overrides

  Scenario: Main menu presents four action options
    When the user views the main menu
    Then the menu offers "Add a rule"
    And the menu offers "Remove a rule"
    And the menu offers "Clear"
    And the menu offers "Cancel"

  Scenario: Cancel option on the main menu exits the wizard cleanly
    Given the user is on the main menu
    When the user selects "Cancel"
    Then the wizard exits with status code 0
    And no error message is written to stderr
    And the config is not modified

  Scenario: Escape on the main menu exits cleanly
    Given the user is on the main menu
    When the user presses Escape
    Then the wizard exits with status code 0
    And no error message is written to stderr
    And the config is not modified

  Scenario: Complete add flow with broad scope, returns to main menu
    Given the user is on the main menu
    When the user selects "Add a rule"
    And the user selects scope "All NAS agents"
    And the user types the pattern "docs-*"
    And the user selects action "deny"
    And the user confirms the change
    Then the rule "docs-* → deny" is written to every canonical NAS agent's per-agent block
    And top-level `permission.skill` is not modified
    And the wizard shows the main menu again

  Scenario: Add flow with specific agent scope, returns to main menu
    Given the user is on the main menu
    When the user selects "Add a rule"
    And the user selects scope "One specific agent"
    And the user picks agent "nas_developer"
    And the user types the pattern "git-*"
    And the user selects action "ask"
    And the user confirms the change
    Then the rule "git-* → ask" is written to agent "nas_developer"
    And no other agent receives the rule
    And the wizard shows the main menu again

  Scenario: Escape on scope selection during add returns to main menu
    Given the user is on the main menu
    And the user has selected "Add a rule"
    And the user is on the scope selection prompt
    When the user presses Escape
    Then the wizard shows the main menu
    And no config changes are persisted

  Scenario: Escape on pattern search during add returns to scope selection
    Given the user is on the main menu
    And the user has selected "Add a rule"
    And the user has selected scope "All NAS agents"
    And the user is on the pattern search prompt
    When the user presses Escape
    Then the wizard shows the scope selection prompt
    And no config changes are persisted

  Scenario: Escape on action select during add returns to pattern search
    Given the user is on the main menu
    And the user has selected "Add a rule"
    And the user has selected scope "All NAS agents"
    And the user has typed a pattern
    And the user is on the action select prompt
    When the user presses Escape
    Then the wizard shows the pattern search prompt
    And no config changes are persisted

  Scenario: Escape on confirm step during add returns to action selection
    Given the user is on the main menu
    And the user has selected "Add a rule"
    And the user has selected scope "All NAS agents"
    And the user has typed the pattern "docs-*"
    And the user has selected action "deny"
    And the user is on the confirm prompt
    When the user presses Escape
    Then the wizard shows the action select prompt for pattern "docs-*"
    And no config changes are persisted

  Scenario: Declined confirm during add returns to main menu without changes
    Given the user is on the main menu
    And the user has completed all add steps
    And the user is on the confirm prompt
    When the user declines the change
    Then the wizard shows the main menu
    And no config changes are persisted

  Scenario: Complete remove flow, returns to main menu
    Given the config has a pre-existing rule "temp-rule: deny" on all NAS agents
    And the user is on the main menu
    When the user selects "Remove a rule"
    And the user selects scope "All NAS agents"
    And the user selects the pattern "temp-rule"
    And the user confirms the removal
    Then the rule "temp-rule" is removed from every canonical NAS agent
    And the wizard shows the main menu again

  Scenario: No rules to remove shows message and returns to main menu
    Given the config has no skill policy rules
    And the user is on the main menu
    When the user selects "Remove a rule"
    And the user selects scope "All NAS agents"
    Then the wizard displays a message indicating no rules to remove
    And the wizard returns to the main menu
    And no config changes are persisted

  Scenario: Escape on remove pattern selection returns to scope
    Given the config has a pre-existing rule "safe-rule: allow" on all NAS agents
    And the user is on the main menu
    And the user has selected "Remove a rule"
    And the user has selected scope "All NAS agents"
    And the user is on the pattern selection prompt
    When the user presses Escape
    Then the wizard shows the scope selection prompt
    And no config changes are persisted

  Scenario: Escape on remove confirm returns to pattern selection
    Given the config has a pre-existing rule "safe-rule: allow" on all NAS agents
    And the user is on the main menu
    And the user has selected "Remove a rule"
    And the user has selected scope "All NAS agents"
    And the user has selected the pattern "safe-rule"
    And the user is on the confirm prompt
    When the user presses Escape
    Then the wizard shows the pattern selection prompt
    And no config changes are persisted

  Scenario: Confirm clear and return to main menu
    Given the config has pre-existing skill policy rules on at least one NAS agent
    And the user is on the main menu
    When the user selects "Clear"
    And the user confirms the clear
    Then all NAS agent skill policies are removed
    And top-level `permission.skill` is not modified
    And the wizard shows the main menu again

  Scenario: Escape on clear confirm returns to main menu
    Given the user is on the main menu
    And the user has selected "Clear"
    And the user is on the clear confirm prompt
    When the user presses Escape
    Then the wizard shows the main menu
    And no config changes are persisted

  Scenario: Declined clear confirm returns to main menu
    Given the user is on the main menu
    And the user has selected "Clear"
    And the user is on the clear confirm prompt
    When the user declines the clear
    Then the wizard shows the main menu
    And no config changes are persisted

  Scenario: Multiple operations in a single wizard run
    Given the user is on the main menu
    When the user adds the rule "rule-a: deny" with broad scope
    And then removes the rule "rule-a" with broad scope
    And the user presses Escape on the main menu
    Then the wizard exits with status code 0
    And the config has no skill policy overrides remaining
    And both operations were applied within a single wizard run
