@delta-added
Feature: nas agents setup prompt rendering cleanup

  Background:
    Given the wizard starts at the main agent list

  Scenario: Prompt content clears after selecting an agent from the search prompt
    Given the user is on the main agent list search prompt
    When the user selects the agent "nas_developer"
    Then the "nas_developer" agent is selected
    And the search prompt's rendered content is cleared from the terminal
    And the next prompt renders at a clean position

  Scenario: Prompt content clears after choosing an action from the select prompt
    Given the user has selected the agent "nas_developer"
    And the user is on the action select prompt
    When the user chooses "Change model"
    Then the action is recorded
    And the action select prompt's rendered content is cleared from the terminal
    And the model search prompt renders at a clean position

  Scenario: Prompt content clears after selecting a model from the search prompt
    Given the user has selected the agent "nas_developer"
    And the user has chosen "Change model"
    And the user is on the model search prompt
    When the user selects the model "anthropic/claude-sonnet-4-6"
    Then the model is selected
    And the model search prompt's rendered content is cleared from the terminal
    And the next prompt renders at a clean position

  Scenario: Prompt content clears after selecting a variant from the select prompt
    Given the user has selected the agent "nas_developer"
    And the user has chosen "Change model"
    And the user has picked the model "openrouter/anthropic/claude-sonnet-4-5"
    And the user is on the variant select prompt
    When the user selects variant "max"
    Then the variant is selected
    And the variant select prompt's rendered content is cleared from the terminal
    And the confirm prompt renders at a clean position

  Scenario: Prompt content clears after confirming the change
    Given the user has selected the agent "nas_developer"
    And the user has chosen "Change model"
    And the user has picked a model and variant
    And the user is on the confirm prompt
    When the user confirms the change
    Then the override is written to the config
    And the confirm prompt's rendered content is cleared from the terminal
    And the main agent list renders at a clean position

  Scenario: Prompt does not stack residual text across a full configuration flow
    Given the user is on the main agent list
    When the user completes a full agent configuration flow selecting "nas_developer", choosing "Change model", searching and selecting a model, selecting a variant, and confirming
    Then each intermediate prompt's content is cleared before the next renders
    And no residual text from any prior prompt is visible in the terminal
