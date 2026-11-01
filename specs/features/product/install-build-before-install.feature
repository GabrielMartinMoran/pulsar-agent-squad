@product @distribution @install
Feature: Install builds target artifacts before copying
  Install should prepare the artifacts it copies, so a separate build command
  is unnecessary for the normal install workflow.

  @integration
  Scenario: Targeted install builds missing artifacts before copying
    Given the OpenCode dist target is absent
    And a temporary install destination
    When I install the OpenCode target
    Then its dist artifacts are generated
    And the installed artifacts match the generated artifacts

  @integration
  Scenario: Install without a target builds every target before copying
    Given all target dist directories are absent
    And a temporary install destination
    When I install without selecting a target
    Then each distinct manifest target is built
    And every configured install artifact is copied

  @integration
  Scenario: Dry run does not build missing artifacts
    Given the OpenCode dist target is absent
    And a temporary install destination
    When I run install for OpenCode with dry run
    Then install reports the missing artifact and fails
    And no dist artifact or install destination file is created
