@delta-added
Feature: nas agents profile CRUD commands

  Background:
    Given the NAS CLI is installed
    And the profile storage directory is `~/.config/opencode/nas/profiles/`

  Scenario: Save the current agent model overrides as a named profile
    Given `opencode.json` has model overrides for "nas_developer" and "nas_qa"
    When the user runs `nas agents profile save my-setup`
    Then a file `~/.config/opencode/nas/profiles/my-setup.json` is created
    And that file contains `{"nas_developer":{"model":"...","variant":"..."},"nas_qa":{"model":"..."}}`
    And the CLI reports success with the profile name

  Scenario: Save creates a profile with only model and variant fields per agent
    Given `opencode.json` has a `nas_developer` entry with extra fields beyond model and variant
    When the user runs `nas agents profile save minimal`
    Then the saved profile for "nas_developer" contains only `model` and `variant` fields
    And extra fields from the live config are not persisted in the profile

  Scenario: Save rejects a profile name that already exists
    Given a profile named "my-setup" already exists
    When the user runs `nas agents profile save my-setup`
    Then the command exits with a non-zero status code
    And the existing profile file is not overwritten
    And the CLI reports an error indicating the profile already exists

  Scenario: Save ignores agents not in the canonical NAS set
    Given `opencode.json` has model overrides for "nas_developer" and "some-other-agent"
    When the user runs `nas agents profile save only-nas`
    Then the saved profile contains "nas_developer"
    And the saved profile does NOT contain "some-other-agent"

  Scenario: List all saved profiles
    Given two profiles named "setup-a" and "setup-b" exist
    When the user runs `nas agents profile list`
    Then the CLI prints "setup-a" and "setup-b" in sorted order
    And the command exits with status code 0

  Scenario: List when no profiles exist
    Given no profiles have been saved
    When the user runs `nas agents profile list`
    Then the CLI prints a message indicating no profiles are available
    And the command exits with status code 0

  Scenario: Load a profile applies model overrides for matching canonical agents
    Given `opencode.json` has no agent overrides
    And a profile "my-setup" contains model overrides for "nas_developer" and "nas_qa"
    When the user runs `nas agents profile load my-setup`
    Then `opencode.json` gains a model override for "nas_developer" matching the profile
    And `opencode.json` gains a model override for "nas_qa" matching the profile
    And the CLI reports which agents were updated

  Scenario: Load ignores profile entries for agents removed from the canonical set
    Given a profile "legacy" contains an override for "nas_old_agent" which is no longer canonical
    When the user runs `nas agents profile load legacy`
    Then the CLI ignores the "nas_old_agent" entry
    And the command does not fail
    And the CLI reports that "nas_old_agent" was skipped

  Scenario: Load does not touch unrelated config fields
    Given `opencode.json` has `default_agent: "Nova Agent Squad"` and `permission` rules
    And a profile "setup" overrides only "nas_developer"
    When the user runs `nas agents profile load setup`
    Then `default_agent` is preserved as "Nova Agent Squad"
    And `permission` rules are preserved unchanged

  Scenario: Load creates a backup before modifying the config
    Given `opencode.json` exists
    And a profile "setup" exists
    When the user runs `nas agents profile load setup`
    Then a timestamped backup file `opencode.json.bak.*` is created

  Scenario: Load removes live overrides for canonical agents absent from the profile
    Given `opencode.json` has overrides for "nas_developer" and "nas_qa"
    And a profile "single" contains an override only for "nas_developer"
    When the user runs `nas agents profile load single`
    Then the override for "nas_qa" is removed from `opencode.json`
    And the override for "nas_developer" matches the profile

  Scenario: Rename a profile
    Given a profile named "old-name" exists
    When the user runs `nas agents profile rename old-name new-name`
    Then the file `old-name.json` no longer exists
    And a file `new-name.json` exists with the original content
    And the CLI reports success

  Scenario: Rename rejects when the target name already exists
    Given profiles "alpha" and "beta" exist
    When the user runs `nas agents profile rename alpha beta`
    Then the command exits with a non-zero status code
    And the CLI reports that "beta" already exists
    And the file "alpha.json" is unchanged

  Scenario: Rename rejects when the source profile does not exist
    Given no profile named "ghost" exists
    When the user runs `nas agents profile rename ghost phantom`
    Then the command exits with a non-zero status code
    And the CLI reports that "ghost" does not exist

  Scenario: Delete a profile
    Given a profile named "to-remove" exists
    When the user runs `nas agents profile delete to-remove`
    Then the file `to-remove.json` no longer exists
    And the CLI reports success

  Scenario: Delete rejects when the profile does not exist
    Given no profile named "nope" exists
    When the user runs `nas agents profile delete nope`
    Then the command exits with a non-zero status code
    And the CLI reports that "nope" does not exist

  Scenario: Help output lists all profile subcommands
    When the user runs `nas agents profile --help`
    Then the help output lists "save", "list", "load", "rename", and "delete" as subcommands

  Scenario: The profile subcommand is registered under `nas agents`
    When the user runs `nas agents --help`
    Then the help output lists "profile" as an available subcommand
