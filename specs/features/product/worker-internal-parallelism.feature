@product @worker-parallelism
Feature: Worker internal tool parallelism guards
  The copilot runs independent verification commands concurrently and
  shared-resource checks in sequence; the engineer batches side-effect-free calls
  while keeping ordered work sequential and never gains the copilot's concurrent
  shell licence.

  Background:
    Given the built worker prompts and a project with configured checks

  @internal-parallelism @copilot @integration
  Scenario: The copilot parallelizes only independent checks
    Given several configured verification commands
    Then the copilot runs them concurrently when they are independent
    And it runs in sequence those that share mutable state

  @internal-parallelism @copilot @integration
  Scenario: The copilot batches read-only discovery calls
    Given the copilot needs known files, searches, and discovery sets
    Then it batches independent read, grep, and glob calls

  @internal-parallelism @engineer @integration
  Scenario: The engineer batches reads while ordered work stays sequential
    Given an engineer task in progress
    Then it batches independent, side-effect-free calls
    And TDD phases, file writes, and shared-state checks stay strictly sequential
    And scoped tests after each phase remain unchanged

  @internal-parallelism @engineer @guard @integration
  Scenario: The engineer never gains the copilot's concurrent shell licence
    Given the built pas_engineer prompt
    Then it permits batching read, grep, and glob
    And it does not permit concurrent bash calls
    And it defers the full project suite to the copilot
