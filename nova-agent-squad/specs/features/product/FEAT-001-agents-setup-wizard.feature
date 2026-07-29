Feature: nas agents setup wizard — navigation, variant discovery, and display

  Background:
    Given the wizard starts with no agent overrides in the OpenCode config

  # ---------------------------------------------------------------------------
  # Navigation and cancellation (existing, unchanged)
  # ---------------------------------------------------------------------------

  Scenario: After successful configuration, returns to the main agent list
    Given the user is on the main agent list
    When the user configures "nas_developer" with model "anthropic/claude-sonnet-4-6" and confirms
    Then the override for "nas_developer" is written to the config
    And the wizard shows the main agent list again

  Scenario: Configure two agents in a single wizard run
    Given the user is on the main agent list
    When the user configures "nas_developer" with model "anthropic/claude-sonnet-4-6"
    And then configures "nas_qa" with model "opencode/deepseek-v4-pro"
    Then both overrides are written to the config in one run
    And the wizard shows the main agent list again

  Scenario: Escape on the main agent list exits cleanly
    Given the user is on the main agent list
    When the user presses Escape
    Then the wizard exits with status code 0
    And no error message is written to stderr
    And the config is not modified

  Scenario: Escape on the action step returns to the main agent list
    Given the user has selected the agent "nas_developer"
    And the user is on the action step
    When the user presses Escape
    Then the wizard shows the main agent list
    And no config changes are persisted

  Scenario: Escape on the model search returns to the action step
    Given the user has selected the agent "nas_developer"
    And the user has chosen "Change model"
    And the user is on the model search step
    When the user presses Escape
    Then the wizard shows the action step for "nas_developer"
    And no config changes are persisted

  Scenario: Escape on the variant selection returns to the model search
    Given the user has selected the agent "nas_developer"
    And the user has chosen "Change model"
    And the user has picked the model "openrouter/anthropic/claude-sonnet-4-5"
    And the user is on the variant selection step
    When the user presses Escape
    Then the wizard shows the model search step
    And no config changes are persisted

  @delta-removed
  Scenario: Escape on the confirm step returns to the previous inner step
    # DEPRECATED: Replaced by the two explicit-branch scenarios below so each
    # test pins down one observable outcome instead of a compound Then.
    Given the user has selected the agent "nas_developer"
    And the user has chosen "Change model"
    And the user has picked a model and variant
    And the user is on the confirm step with the pending override
    When the user presses Escape
    Then the wizard shows the previous inner step (variant selection or model search)
    And no config changes are persisted

  Scenario: Escape on the confirm step after a variant selection returns to the variant selection
    Given the user has selected the agent "nas_developer"
    And the user has chosen "Change model"
    And the user has picked the model "openrouter/anthropic/claude-sonnet-4-5"
    And the user has chosen variant "max"
    And the user is on the confirm step with the pending override
    When the user presses Escape
    Then the wizard shows the variant selection step
    And no config changes are persisted

  Scenario: Escape on the confirm step with no variant selection returns to the model search
    Given the user has selected the agent "nas_developer"
    And the user has chosen "Change model"
    And the user has picked a model that has no variants
    And the user is on the confirm step with the pending override
    When the user presses Escape
    Then the wizard shows the model search step
    And no config changes are persisted

  @delta-modified
  Scenario: Chosen Cancel option on the action step returns to the main agent list
    # CHANGED: previously asserted the wizard exits with status code 0 and prints
    # "Cancelled. No changes made." to stdout. The action step is no longer
    # terminal — Cancel returns the user to the main agent list so they may
    # configure a different agent in the same wizard run.
    Given the user has selected the agent "nas_developer"
    And the user is on the action step
    When the user selects the menu option "Cancel"
    Then the wizard shows the main agent list
    And no config changes are persisted

  # ---------------------------------------------------------------------------
  # Per-model variant discovery from OpenCode verbose output (new)
  # ---------------------------------------------------------------------------

  @delta-added
  Scenario: Luna model shows all six reasoning-effort variants
    Given `opencode models --verbose` is available and returns known output
    And the user has selected the agent "nas_qa"
    And the user has chosen "Change model"
    When the user searches for and picks "openai/gpt-5.6-luna"
    Then the wizard shows the variant selection step
    And the variant choices include "none", "low", "medium", "high", "xhigh", and "max"
    And each variant is offered alongside a "default (no variant)" option

  @delta-added
  Scenario: Model with fewer variants does not show unavailable options
    Given `opencode models --verbose` is available and returns known output
    And the user has selected the agent "nas_qa"
    And the user has chosen "Change model"
    When the user searches for and picks "openai/gpt-5-mini"
    Then the wizard shows the variant selection step
    And the variant choices do NOT include "xhigh" or "max"

  @delta-added
  Scenario: Model with no variants skips the variant step
    Given `opencode models --verbose` is available and returns known output
    And the user has selected the agent "nas_qa"
    And the user has chosen "Change model"
    When the user searches for and picks "opencode/deepseek-v4-pro"
    Then the wizard skips the variant selection step
    And proceeds directly to the confirm step

  @delta-added
  Scenario: Selecting xhigh variant for Luna persists correctly
    Given `opencode models --verbose` is available and returns known output
    And the user has selected the agent "nas_qa"
    And the user has chosen "Change model"
    And the user has picked "openai/gpt-5.6-luna"
    When the user chooses variant "xhigh" and confirms
    Then the config is written with model "openai/gpt-5.6-luna" and variant "xhigh"

  # ---------------------------------------------------------------------------
  # Safe degradation when opencode models --verbose is unavailable (new)
  # ---------------------------------------------------------------------------

  @delta-added
  Scenario: opencode models --verbose fails or is not supported
    Given `opencode models --verbose` exits non-zero or produces no parseable variants
    When the user picks any model that would normally have variants
    Then the variant step is skipped for that model
    And the wizard proceeds directly to the confirm step
    And no invalid variant options are shown

  @delta-added
  Scenario: Known-static-variant model is also skipped when verbose fails
    Given `opencode models --verbose` is unavailable
    When the user picks "openrouter/anthropic/claude-sonnet-4-5"
    Then the variant step is skipped
    And the confirm step shows the preview with "Variant: default"

  # ---------------------------------------------------------------------------
  # Unified variant display — nas agents list output (modified)
  # ---------------------------------------------------------------------------

  @delta-modified
  Scenario: Agent with no override shows Variant default and no Reasoning effort line
    # CHANGED: "Reasoning effort:" line removed; "Variant:" always shown
    Given the config has no override for "nas_qa"
    When the user runs "nas agents list"
    Then the output for "nas_qa" shows "Variant: default"
    And the output does NOT contain "Reasoning effort:" anywhere

  @delta-modified
  Scenario: Agent with override shows the configured variant and no Reasoning effort line
    # CHANGED: "Reasoning effort:" line removed; "Variant:" replaces it
    Given the config has "nas_developer" with model "anthropic/claude-sonnet-4-6" and variant "high"
    When the user runs "nas agents list"
    Then the output for "nas_developer" shows "Variant: high"
    And the output does NOT contain "Reasoning effort:" for that agent

  # ---------------------------------------------------------------------------
  # Unified variant display — setup wizard preview (modified)
  # ---------------------------------------------------------------------------

  @delta-modified
  Scenario: Preview shows Variant line instead of separate Reasoning effort
    # CHANGED: "Reasoning effort:" line removed; "Variant:" always shown
    Given the user has selected the agent "nas_developer"
    And the user has chosen "Change model"
    And the user has picked "openai/gpt-5.6-luna" with variant "xhigh"
    When the confirm step shows the preview
    Then the preview contains "Variant: xhigh"
    And the preview does NOT contain "Reasoning effort:"

  # ---------------------------------------------------------------------------
  # Outer agent selector — persisted variant in choice description (new)
  # ---------------------------------------------------------------------------

  @delta-added
  Scenario: Agent with explicit persisted variant shows variant in the selector description
    Given the config has "nas_developer" with model "openai/gpt-5.6-luna" and variant "xhigh"
    When the user opens the setup wizard and views the main agent list
    Then the choice for "nas_developer" shows the description containing "(openai/gpt-5.6-luna [xhigh])"

  @delta-added
  Scenario: Agent with model but no explicit variant shows [default] in the selector
    Given the config has "nas_qa" with model "openai/gpt-5.6-luna" and no variant field
    When the user opens the setup wizard and views the main agent list
    Then the choice for "nas_qa" shows the description containing "(openai/gpt-5.6-luna [default])"

  @delta-added
  Scenario: Agent with variant literal "default" normalizes to [default] in the selector
    Given the config has "nas_qa" with model "openai/gpt-5.6-luna" and variant "default"
    When the user opens the setup wizard and views the main agent list
    Then the choice for "nas_qa" shows the description containing "(openai/gpt-5.6-luna [default])"

  @delta-added
  Scenario: Agent with variant "none" shows the literal value in the selector
    Given the config has "nas_developer" with model "openai/gpt-5.6-luna" and variant "none"
    When the user opens the setup wizard and views the main agent list
    Then the choice for "nas_developer" shows the description containing "(openai/gpt-5.6-luna [none])"

  @delta-added
  Scenario: Agent without agent-level model omits the model/variant group
    Given the config has no override for "nas_researcher"
    When the user opens the setup wizard and views the main agent list
    Then the choice for "nas_researcher" shows model-capability guidance
    And the description does NOT contain any parenthesized model reference
    And the description does NOT contain any bracketed variant reference

  @delta-added
  Scenario: Agent selector preserves canonical value and name regardless of description
    Given the config has "nas_developer" with model "openai/gpt-5.6-luna" and variant "xhigh"
    When the user opens the setup wizard and views the main agent list
    Then the choice for "nas_developer" has value "nas_developer"
    And the choice for "nas_developer" has name "nas_developer"
