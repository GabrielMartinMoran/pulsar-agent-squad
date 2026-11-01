@product @distribution @update
Feature: Update builds and installs the target by default
  A successful update should leave the local OpenCode installation current.

  @contract
  Scenario: Update rebuild alone remains build-only
    Given update runs in check mode
    When I request rebuild without reinstall
    Then its plan includes the OpenCode build
    And its plan does not include install

  @contract
  Scenario: Update builds and installs by default after pulling
    Given update runs in check mode
    When I request no action flags
    Then its plan includes the pull followed by OpenCode install
    And no separate build command is listed because install builds internally
    And check mode does not execute the pull or install

  @contract
  Scenario: Reinstall avoids a duplicate build when rebuild is also requested
    Given update runs in check mode
    When I request both rebuild and reinstall
    Then its plan includes one install step that builds and installs
    And its plan does not include a separate build step
