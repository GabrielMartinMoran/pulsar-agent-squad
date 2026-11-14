@product @distribution @install
Feature: Install prunes agents the harness no longer ships
  Copying artifacts is not enough to upgrade an installation: an agent removed from
  the roster would survive in the user's config forever and keep being discovered.
  Install therefore prunes the files it owns, and only those.

  Background:
    Given the OpenCode target is built
    And an installation directory that already holds agents from an earlier version

  @integration
  Scenario: Stale PAS agents are removed
    Given the installed directory holds pas_developer.md and pas_qa.md
    And the current roster ships pas_researcher, pas_engineer and pas_copilot
    When install runs for the OpenCode target
    Then the shipped agents are present
    And pas_developer.md and pas_qa.md are gone
    And each removed file is named in the output

  @integration
  Scenario: Only PAS-owned files are candidates
    Given the installed directory holds IADEV-notes.md, nas_legacy.md and Nova Agent Squad.md
    When install runs for the OpenCode target
    Then those files survive untouched
    And a file that does not start with pas_ and is not an orchestrator is never removed

  @integration
  Scenario: Orchestrator prompts are pruned too when retired
    Given an orchestrator prompt that the current roster no longer ships
    When install runs for the OpenCode target
    Then that orchestrator is removed
    And the orchestrators the roster does ship remain

  @integration
  Scenario: Dry run removes nothing
    Given the installed directory holds stale PAS agents
    When install runs with dry run
    Then it reports the files it would remove
    And every file is still on disk afterwards

  @integration
  Scenario: Pruning is idempotent and safe on an empty state
    Given a directory with no stale PAS agents
    When install runs twice
    Then the second run reports that there is nothing to prune
    And a missing or empty directory does not fail

  @integration
  Scenario: Other runtime targets are never pruned
    Given the Pi target ships its own roster from a different source
    When install runs for the Pi target
    Then no OpenCode agent file is removed
    And the stale OpenCode names are left untouched
