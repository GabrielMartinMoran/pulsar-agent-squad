@product @agents-setup
Feature: Target-aware agents setup

  Background:
    Given the PAS CLI exposes the agents setup command
    And the platform manifest declares the available distribution targets
    And the setup adapter registry declares which targets support model setup

  @unit
  Scenario: Only targets with a setup adapter are offered
    Given the adapter registry declares OpenCode and Pi
    And the platform manifest declares further file-copy-only targets
    When the setup command asks which tool to configure
    Then the offered choices are OpenCode and Pi only
    And no file-copy-only target is offered as a choice

  @unit
  Scenario: An explicit target skips the selection prompt
    Given the user passes an explicit target that has an adapter
    When the setup command starts
    Then no target selection prompt is shown
    And the wizard configures the named target

  @unit
  Scenario: An unsupported target is rejected before any interaction
    Given the user passes a target without a setup adapter
    When the setup command starts
    Then it exits non-zero naming the supported targets
    And no configuration file is read, backed up, or written

  @unit
  Scenario: OpenCode setup keeps its persistence contract
    Given the OpenCode target adapter
    When the wizard applies a model to an agent
    Then the model is written to the OpenCode config as agent.<name>.model
    And an optional variant is written beside it when one was chosen
    And the closing hint asks to restart OpenCode

  @unit
  Scenario: Pi setup writes a per-subagent override
    Given a Pi settings file without a subagents key
    When the wizard applies a model to a Pi subagent
    Then subagents.agentOverrides.<agent>.model holds that model
    And subagents.agentOverrides.<agent>.defaultProvider holds its provider
    And the file is backed up before being overwritten

  @unit
  Scenario: Pi setup preserves unknown settings keys
    Given a Pi settings file with unrelated top-level keys and nested objects
    When the wizard applies a model to a Pi subagent
    Then every unknown key keeps its value and type
    And the resulting file parses as JSON

  @unit
  Scenario: Pi inherit default removes only one override
    Given a Pi settings file with several agent overrides
    When the user chooses to inherit the default for one subagent
    Then only that subagent override is removed
    And the other overrides stay untouched
    And empty override containers are pruned

  @unit
  Scenario: Pi malformed settings fail before interaction
    Given a Pi settings file that is not valid JSON
    When the setup command starts for Pi
    Then it reports the parse error and exits non-zero
    And no backup and no write happen

  @unit
  Scenario: Pi settings file is created only inside an existing agent directory
    Given a Pi agent directory without a settings file
    When the wizard applies a model to a Pi subagent
    Then the settings file is created with the subagents block

  @unit
  Scenario: Pi setup refuses a missing agent directory
    Given no Pi agent directory exists
    When the setup command runs for Pi
    Then it refuses with a clear message
    And no settings file is created

  @unit
  Scenario: Pi roster offers subagents only
    Given the Pi target adapter
    Then its roster is the three Pi worker subagents
    And the Pi lead skills are not offered as model targets

  @unit
  Scenario: Pi model discovery parses the documented table
    Given pi --list-models output with a header and model rows
    When the adapter discovers models
    Then each row yields a provider, a model, and its thinking support
    And the header and blank lines are ignored

  @unit
  Scenario: Pi model discovery falls back when the table cannot be parsed
    Given pi --list-models output that matches no model row
    When the adapter discovers models
    Then discovery reports no models
    And the wizard offers manual model entry instead of failing

  @unit
  Scenario: Missing Pi packages are detected without removing installed ones
    Given configured active packages and a pi list output
    When the adapter compares them
    Then only configured sources absent from pi list are reported missing
    And packages installed outside the configured list are never removed

  @unit
  Scenario: A low Pi version skips pi-subagents only
    Given a Pi version below 1.2.0 and pi-subagents among the missing packages
    When the wizard resolves the packages to install
    Then pi-subagents is skipped with a warning
    And the remaining missing packages are still installed

  @contract
  Scenario: Pi wizard prompt order is fixed
    Given the Pi target adapter and missing packages
    When the wizard runs to completion
    Then it asks target, then packages, then agent, then action, then model, then thinking, then confirmation
    And the final confirmation previews the agent, the model, the provider, and the thinking level

  @integration
  Scenario: Pi setup installs missing plugins and writes settings
    Given a temporary home with a fake pi binary and a Pi settings file
    When setup runs for Pi and the user confirms
    Then each missing configured package is installed once
    And packages already configured are skipped
    And the settings file carries the chosen overrides
    And the reload hint is printed

  @integration
  Scenario: Pi setup leaves unconfigured installed packages alone
    Given a Pi settings file listing a package absent from the configured list
    When setup runs for Pi and the user confirms
    Then that package stays installed and declared
    And no removal command runs

  @integration
  Scenario: Pi setup fails cleanly without the Pi binary
    Given no pi binary on the path
    When setup runs for Pi
    Then it exits non-zero with a clear message
    And no settings file is written

  @integration
  Scenario: OpenCode setup behavior is unchanged end to end
    Given an OpenCode config and discovered models
    When setup runs for OpenCode to completion
    Then the persisted model matches the chosen one
    And the printed hint is unchanged

  @manual
  Scenario: A human confirms Pi subagent models take effect
    Given Pi 1.4.0 with pi-subagents installed and per-subagent overrides written
    When the human runs /reload and launches a subagent
    Then the subagent runs with the configured model and thinking level
