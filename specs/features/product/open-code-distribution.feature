Feature: Install current OpenCode artifacts without removing user agents

  @integration
  Scenario: D1 Install builds fresh selected artifacts before copying
    Given an isolated install destination and stale or missing OpenCode artifacts
    When I install OpenCode without a dry run
    Then the installer builds the selected artifacts from source before copying
    And a build failure leaves the install destination unchanged

  @contract
  Scenario: D2 Update selects the same actions it describes
    Given update is running in a clean Git checkout with an upstream
    When I inspect the action plan for each supported flag combination
    Then the default and reinstall actions select the OpenCode installer
    And rebuild alone selects the OpenCode build without install
    And check mode shows the plan without pulling, building, or installing

  @integration
  Scenario: D3 Failed installation after a pull reports partial completion
    Given a local upstream fixture with a fast-forward update
    And installation will fail after pulling
    When I run update
    Then update reports the failed installation with a nonzero status
    And the checkout remains at the fast-forwarded revision

  @unit
  Scenario: D4 Only recorded unmodified retired agents are eligible for pruning
    Given current shipped agents and a prior installation inventory
    And candidates include a retired unmodified file, an edited file, a symlink, and an unowned file with a PAS-like name
    When I classify obsolete agent files using the inventory and metadata
    Then only the recorded unmodified retired regular file is eligible

  @integration
  Scenario: D5 Install manages recorded agent files at the selected destination only
    Given an isolated custom install destination containing user agent files
    When I preview an install, install twice with a changed roster, and uninstall twice
    Then the preview changes neither the build output nor the destination
    And only verified retired agents from the destination inventory are pruned
    And user files, edited files and files without an install record remain intact after both uninstalls

  @integration
  Scenario: D5 Install rejects a symbolic link at a shipped agent destination
    Given an isolated install destination with a symbolic link where an OpenCode agent would be copied
    When I install OpenCode
    Then the installer reports the conflicting path and fails before copying any artifacts
    And the symbolic link and its target remain unchanged
