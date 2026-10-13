@product @lead-orchestration @pilot-a
Feature: Lead parallel research via background subagents
  The Lead may run independent research questions concurrently as background
  subagents while keeping every other delegation strictly sequential.

  Background:
    Given OpenCode V2 with background subagent support is available

  @research-parallel
  Scenario: Independent research questions are delegated as one background batch
    Given a research phase with two or three independent questions and disjoint scopes
    When the Lead delegates research
    Then it launches one pas_researcher per question in background mode
    And each delegation brief declares its exact disjoint scope
    And the Lead consumes all completions before opening the Research Quality Gate

  @research-parallel @fallback
  Scenario: Background delegation fails
    Given a background spawn fails or is unavailable
    When the Lead delegates research
    Then it falls back to sequential foreground research
    And it does not claim parallel execution in its progress output

  @sequencing @guard
  Scenario: Overlapping or dependent research questions remain sequential
    Given research questions that share files or topics, or depend on each other
    Then the Lead delegates a single researcher at a time

  @sequencing @guard
  Scenario: Implementation phases stay strictly sequential
    Given an approved plan enters implementation
    Then developer and QA delegations remain one atomic task at a time
    And no developer or QA delegation runs concurrently with another

  @completion-handling
  Scenario: Batch completions are processed before planning
    Given a background research batch has completed
    When completion notifications arrive individually or grouped
    Then the Lead emits one progress line per completed researcher
    And the Research Quality Gate evaluates the merged evidence before planning
