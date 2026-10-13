@product @lead-orchestration @state-hygiene
Feature: State lifecycle hygiene with numbered feature directories
  Feature state lives in numbered directories (NNNNN-slug) under the configured
  active and archive paths; active holds only in-flight features, and every
  lifecycle operation runs through the installed state tool with drift detected
  and offered to the user.

  Background:
    Given PAS state paths and numbering are configured in .pas/pas.config.yaml

  @state-hygiene @naming @unit
  Scenario: Numbered directories in active and archive
    Given a feature enters the lifecycle
    Then it lives in a five-digit numbered directory under the active path
    And archiving moves the complete directory to the archive path keeping its number
    And archiving never renumbers and never deletes

  @state-hygiene @cardinality @integration
  Scenario: Active contains only active features
    Given the active path contains a feature that is no longer in flight
    Then the state check reports it as a violation
    And the Lead surfaces it and offers the user a cleanup
    And nothing non-active remains in active once the lifecycle ends

  @state-hygiene @tooling @integration
  Scenario: State operations run through the installed tool
    Given the PAS toolkit is installed by the PAS installer
    Then the Lead lists, checks, creates, and archives state through `pas_toolkit`
    And the toolkit description marks it as harness-only tooling
    And the tool blocks malformed or conflicting state instead of guessing

  @state-hygiene @detection @integration
  Scenario: Legacy disorder is detected and offered for cleanup
    Given an active directory with unnumbered or stale artifacts from older conventions
    When the Lead runs the state check
    Then it reports the violations with paths
    And it offers the user a cleanup without executing it unprompted
