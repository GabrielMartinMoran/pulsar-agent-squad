@delta-added
Feature: nas skills setup prompt rendering cleanup

  Background:
    Given the wizard starts at the `nas skills setup` main menu

  Scenario: Prompt content clears after selecting an action from the main menu
    Given the user is on the main menu select prompt
    When the user selects "Add a rule"
    Then the action is recorded
    And the main menu select prompt's rendered content is cleared from the terminal
    And the scope select prompt renders at a clean position

  Scenario: Prompt content clears after selecting scope
    Given the user has selected "Add a rule"
    And the user is on the scope select prompt
    When the user selects scope "All NAS agents"
    Then the scope is recorded
    And the scope select prompt's rendered content is cleared from the terminal
    And the pattern search prompt renders at a clean position

  Scenario: Prompt content clears after picking an agent for agent-scoped add
    Given the user has selected "Add a rule"
    And the user has selected scope "One specific agent"
    And the user is on the agent picker prompt
    When the user selects the agent "nas_developer"
    Then the agent is recorded
    And the agent picker prompt's rendered content is cleared from the terminal
    And the pattern search prompt renders at a clean position

  Scenario: Prompt content clears after searching and selecting a pattern
    Given the user has selected "Add a rule"
    And the user has selected scope "All NAS agents"
    And the user is on the pattern search prompt
    When the user types and selects the pattern "docs-*"
    Then the pattern is recorded
    And the pattern search prompt's rendered content is cleared from the terminal
    And the action select prompt renders at a clean position

  Scenario: Prompt content clears after selecting an action for the pattern
    Given the user has selected "Add a rule"
    And the user has selected scope "All NAS agents"
    And the user has typed the pattern "docs-*"
    And the user is on the action select prompt
    When the user selects action "deny"
    Then the action is recorded
    And the action select prompt's rendered content is cleared from the terminal
    And the confirm prompt renders at a clean position

  Scenario: Prompt content clears after confirming the add change
    Given the user has selected "Add a rule"
    And the user has selected scope "All NAS agents"
    And the user has typed the pattern "docs-*"
    And the user has selected action "deny"
    And the user is on the confirm prompt
    When the user confirms the change
    Then the override is written to the config
    And the confirm prompt's rendered content is cleared from the terminal
    And the main menu renders at a clean position

  Scenario: Prompt content clears after selecting a pattern to remove
    Given the config has a pre-existing rule "safe-rule: allow" on all NAS agents
    And the user has selected "Remove a rule"
    And the user has selected scope "All NAS agents"
    And the user is on the remove pattern search prompt
    When the user selects the pattern "safe-rule"
    Then the pattern is selected
    And the remove pattern search prompt's rendered content is cleared from the terminal
    And the confirm prompt renders at a clean position

  Scenario: Prompt content clears after confirming the remove change
    Given the config has a pre-existing rule "safe-rule: allow" on all NAS agents
    And the user has selected "Remove a rule"
    And the user has selected scope "All NAS agents"
    And the user has selected the pattern "safe-rule"
    And the user is on the confirm prompt
    When the user confirms the removal
    Then the rule is removed from the config
    And the confirm prompt's rendered content is cleared from the terminal
    And the main menu renders at a clean position

  Scenario: Prompt content clears after confirming the clear operation
    Given the user has selected "Clear"
    And the user is on the clear confirm prompt
    When the user confirms the clear
    Then all NAS agent skill policies are removed
    And the confirm prompt's rendered content is cleared from the terminal
    And the main menu renders at a clean position

  Scenario: No residual prompt text stacks across a full add-and-remove flow
    Given the user is on the main menu
    When the user completes a full add flow for rule "flow-test: allow" with broad scope
    And then completes a full remove flow for the same rule
    Then each intermediate prompt's content is cleared before the next renders
    And no residual text from any prior prompt is visible in the terminal
