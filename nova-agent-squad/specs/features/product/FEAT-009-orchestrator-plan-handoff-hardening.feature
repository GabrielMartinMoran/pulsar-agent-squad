@delta-added
Feature: orchestrator plan handoff hardening

  Background:
    Given the NAS orchestrator is running
    And the planner subagent is available for delegation

  @delta-added @plan-completeness @critical
  Scenario: Complete full-mode planner output produces a complete user-facing final response
    Given the orchestrator delegates to the planner in full mode
    And the planner returns a complete planning_output with all required sections
    When the orchestrator presents the result to the user
    Then the response describes scope and out-of-scope items
    And the response describes the approach and key technical decisions
    And the response lists impacted files and contracts
    And the response includes the Gherkin acceptance scenarios and test strategy
    And the response includes TDD phases and ordered implementation tasks
    And the response lists risks and assumptions
    And the response includes the delegation order, exact skill names, and developer agent selection
    And the exact sentence "Implementation plan is ready. Do you want me to apply it now?" appears at the end
    And no question tool, ask tool, or interactive prompt is used in the same turn

  @delta-added @plan-empty-output @critical
  Scenario: Empty or missing planner output retries once then escalates
    Given the orchestrator delegates to the planner
    And the planner returns an empty planning_output or produces no output at all
    When the orchestrator processes the result
    Then the orchestrator retries the delegation exactly once
    And on the second failure the orchestrator escalates to the user without presenting the broken output
    And the escalation does not include an approval prompt for the plan

  @delta-added @plan-incomplete-sections @critical
  Scenario: Missing critical plan sections retries once then escalates with section names
    Given the orchestrator delegates to the planner
    And the planner returns a planning_output missing one or more critical sections
    When the orchestrator processes the result
    Then the orchestrator retries the delegation once with the names of the missing sections
    And on the second failure the orchestrator escalates to the user with the names of the still-missing sections
    And the escalation does not include an approval prompt for the plan

  @delta-added @turn-boundary @critical
  Scenario: Plan presentation is the final response for the turn
    Given the orchestrator has a complete and validated plan to present
    When the orchestrator presents the plan to the user
    Then no question tool, ask tool, or interactive prompt is issued in the same response turn
    And the next turn waits for explicit user input before continuing

  @delta-added @docs-alignment @regression
  Scenario: Documentation and generated artifacts stay aligned with the handoff contract
    Given the orchestrator handoff behavior has changed
    When the changes are applied
    Then the README describes the correct plan presentation and handoff flow
    And the architecture documentation reflects the handoff contract
    And the maintenance guide documents the handoff patterns and recovery procedures
    And the generated dist artifacts match the expectations of the handoff contract test

  @delta-added @plan-ui-safety
  Scenario: Raw planner XML is never exposed to the user
    Given the planner returns a planning_output XML block
    When the orchestrator interprets and presents the output
    Then raw XML tags, code fences, or structured planning_output markup are never shown to the user
    And the output is formatted as user-facing Markdown prose
