@product @pi-target
Feature: Pi runtime target for PAS distribution

  Background:
    Given the PAS multi-platform build and install pipeline
    And the platform manifest drives targets, sources, dist paths, and install paths

  @unit
  Scenario: Manifest declares the Pi target
    Given the platform manifest
    Then it contains Pi entries for agents, skills, and settings
    And every Pi install path resolves under the home Pi agent directory

  @unit
  Scenario: Pi agents keep their native frontmatter
    Given a Pi agent source with name, tools, and acceptance fields
    When the Pi target is built
    Then the artifact keeps those fields unchanged
    And no OpenCode permission skill rules are injected

  @unit
  Scenario: Package list parsing ignores noise
    Given the Pi package list
    Then blank lines and comment lines are ignored
    And the configured set contains pi-subagents and pi-web-access

  @unit
  Scenario: Settings snippet is valid and scoped
    Given the Pi settings snippet
    Then it parses as JSON
    And its only top-level key is subagents

  @contract
  Scenario: Worker tool allowlists match each role
    Given the three Pi worker agents
    Then pas_researcher exposes no write, edit, or bash tools
    And pas_qa exposes no write or edit tools
    And pas_qa may run bash for read-only verification commands
    And pas_developer exposes edit, write, and bash
    And every agent declares acceptanceRole and timeoutMs

  @contract
  Scenario: Primary-mode skills preserve PAS invariants
    Given the pas-lead and pas-turbo skills
    Then both preserve the approval gate, TDD, QA verdict, and state contract
    And both delegate only to the three Pi worker agents
    And the approval sentence matches the OpenCode prompt sources verbatim

  @unit
  Scenario: Toolkit extension registers the five operations
    Given the Pi toolkit adapter and its manifest entry
    When its factory runs against a stub ExtensionAPI
    Then it registers a pas_toolkit tool
    And the tool accepts init, list, check, new, and archive
    And the manifest declares the extension entry

  @integration
  Scenario: Pi build is complete and deterministic
    When I run the build for the Pi target twice
    Then both runs produce identical artifacts
    And agents, skills, settings, and the extension are present

  @integration
  Scenario: Pi install copies artifacts and creates directories
    Given a temporary home without a Pi agent directory
    When I install the Pi target
    Then agents, skills, settings, and the extension land under the home Pi agent directory
    And each destination is reported

  @integration
  Scenario: Pi install requires the Pi binary
    Given no Pi binary on the path
    When I install the Pi target
    Then installation fails with a clear message before copying files

  @integration
  Scenario: Pi install always installs the configured plugins
    Given the Pi target and a configured package list
    When I install the Pi target for real
    Then each configured package is installed with pi install
    And packages already configured are skipped after pi list
    When a package install fails
    Then installation stops with a non-zero exit and reports the failure

  @integration
  Scenario: Dry run previews without mutating
    Given the Pi target
    When I install with dry run
    Then the file destinations and plugin commands are printed
    And no file is copied and no package is installed

  @integration
  Scenario: Pi install preserves an edited settings snippet
    Given a temporary home with an edited installed settings snippet
    When I install the Pi target
    Then the edited version is kept as a backup beside the installed file
    And the installed file matches the built settings snippet
    And a second install leaves the backup untouched

  @integration
  Scenario: Uninstall removes only Pi artifacts
    When I uninstall the Pi target
    Then the installed Pi artifacts are removed
    And unrelated files in the Pi agent directory are untouched

  @manual
  Scenario: A human runs PAS on Pi end to end
    Given Pi 1.4.0 with pi-subagents and pi-web-access installed
    When the human runs the pas-lead skill and requests a small feature
    Then the Lead produces a plan and waits for approval before editing source
