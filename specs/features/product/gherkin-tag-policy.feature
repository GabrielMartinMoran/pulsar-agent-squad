@product @gherkin-tags
Feature: Scenario class tags for test automation levels
  Every scenario carries exactly one class tag recording its lightest reliable
  automation level; workers implement and verify at that level and never
  upgrade it on their own.

  Background:
    Given the PAS prompts and a feature written in Gherkin

  @gherkin-tags @integration
  Scenario: Every scenario declares one class tag
    Given a feature with scenarios
    Then each scenario carries exactly one of @unit, @integration, @contract, @e2e, or @manual
    And @e2e scenarios carry an explicit justification in the plan

  @gherkin-tags @integration
  Scenario: Manual scenarios keep a manual procedure
    Given a scenario tagged @manual
    Then the plan documents who runs the manual verification and how
    And no automated test is written for it

  @gherkin-tags @integration
  Scenario: Workers follow the tagged level
    Given a scenario tagged with its class
    Then the developer implements its tests at that level
    And the developer escalates instead of upgrading when the level is insufficient
    And QA flags tests that are heavier or lighter than the tag
