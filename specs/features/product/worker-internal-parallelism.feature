@product @worker-parallelism
Feature: Worker internal tool parallelism guards
  QA runs independent verification commands concurrently and shared-resource
  checks in sequence; the developer batches side-effect-free calls while
  keeping ordered work sequential.

  Background:
    Given the built worker prompts and a project with configured checks

  @internal-parallelism @qa @integration
  Scenario: QA parallelizes only independent checks
    Given several configured verification commands
    Then QA runs them concurrently when they are independent
    And it runs in sequence those that share mutable state

  @internal-parallelism @qa @integration
  Scenario: QA batches read-only discovery calls
    Given QA needs known files, searches, and discovery sets
    Then it batches independent read, grep, and glob calls

  @internal-parallelism @developer @integration
  Scenario: Developer batches reads while ordered work stays sequential
    Given a developer task in progress
    Then it batches independent, side-effect-free calls
    And TDD phases, file writes, and shared-state checks stay strictly sequential
    And scoped tests after each phase and the full suite before PASS remain unchanged
