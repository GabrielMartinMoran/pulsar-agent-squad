@delta-added
Feature: opencode models cache within a wizard run

  Scenario: First successful load populates the run cache
    Given the wizard's model cache is empty at the start of the run
    When the wizard reads the model list
    And `opencode models` returns a successful non-empty list
    Then the run cache stores that list
    And the next read in the same run reuses the cache without re-invoking `opencode models`

  Scenario: Subsequent reads in the same run return the cached list
    Given the run cache already contains a successful list from a prior load
    When the wizard reads the model list again during the same run
    Then `opencode models` is not invoked again
    And the wizard uses the cached list

  Scenario: Failed load leaves the cache untouched
    Given the run cache is empty
    When the wizard reads the model list
    And `opencode models` exits with a non-zero code
    Then the run cache remains empty
    And the next read in the same run re-invokes `opencode models`

  Scenario: Empty result does not poison the cache
    Given the run cache is empty
    When the wizard reads the model list
    And `opencode models` exits with code 0 but returns no usable models
    Then the run cache remains empty
    And the next read in the same run re-invokes `opencode models`

  Scenario: Cache is empty at the start of each new wizard run
    Given a previous wizard run populated its run cache with models
    When a new wizard run starts
    Then the run cache is empty at the start of the new run
    And the first read in the new run re-invokes `opencode models`
