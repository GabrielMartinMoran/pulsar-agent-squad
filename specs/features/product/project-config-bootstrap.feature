@product @config-bootstrap
Feature: Bootstrap PAS configuration in a new project workspace
  The installed PAS toolkit provides a portable, project-specific template
  without coupling users to the harness repository's own configuration.

  @unit
  Scenario: The generic example remains in sync with the plugin
    Given the PAS config template is embedded in the standalone toolkit
    Then rendering for example-project matches the reviewed example file
    And neither name nor memory space identifies the PAS harness itself

  @integration
  Scenario: Init previews the configuration without writing
    Given the target workspace has no PAS configuration
    When the toolkit receives init without confirmation
    Then it displays the proposed destination and project-specific settings
    And it creates no files or directories

  @integration
  Scenario: Explicitly confirmed init creates only the config
    Given the operator has approved the proposed configuration and destination
    When the toolkit receives init with confirm true
    Then it creates .pas/pas.config.yaml in the selected workspace
    And the normal state hygiene check can proceed
    And feature state is created only through the existing new operation

  @integration
  Scenario: Init never replaces an existing configuration
    Given .pas/pas.config.yaml already exists
    When the toolkit receives init with confirm true
    Then the operation is blocked and the file remains unchanged

  @integration
  Scenario: The installed tool supports bootstrap without the harness checkout
    Given the PAS plugin is registered in an unrelated project directory
    When it receives a preview and a confirmed init
    Then both operations target that project directory
    And no external template or repository is needed

  @manual
  Scenario: The primary agents ask before creating project configuration
    Given a new disposable project is opened with PAS installed
    When the operator asks either primary agent to begin work
    Then the agent shows a configuration preview with the target path
    And it requests explicit permission before calling init with confirm true
    And it does not silently write or overwrite project configuration
    # Verify separately for both primary modes by inspecting the actual tool
    # calls, permission exchange, and resulting files in a disposable folder.
