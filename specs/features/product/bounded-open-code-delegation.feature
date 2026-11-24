Feature: Bounded OpenCode delegation without paired workers

  @contract
  Scenario: A1 Squad and Turbo share a brief format when delegating
    Given the existing roster, permissions, and routing rules
    When either primary agent delegates a task
    Then its XML brief names the objective, authorized scope, acceptance, and expected evidence
    And implementation hints do not grant authority or change when the agent delegates

  @contract
  Scenario: A2 Researcher returns an answer with evidence and limits
    Given a bounded research brief and the Researcher inspection profile
    When the researcher returns a report
    Then it includes a direct answer, sources, limits, and an explicit closure status
    And it distinguishes source inspection from commands actually run
    And its instructions restrict shell use to inspection and keep edit and write permissions denied

  @contract
  Scenario: A3 Read-only QA verifies existing behavior without requiring a new TDD cycle
    Given a bounded change and a check for behavior that already exists
    When the developer changes behavior and QA inspects current evidence
    Then the developer retains TDD and full-suite requirements for changes
    And QA verifies the existing behavior independently without manufacturing TDD evidence

  @contract
  Scenario: A4 Researcher can inspect through shell without an approval rule
    Given the configured prefix list of common mutating commands
    When the Researcher permission profile and Squad routing guidance are defined
    Then explicit shell denies follow the default shell allow rule
    And the profile adds no ask rule or blanket deny for sed
    And Squad can delegate shell inspection without authorizing mutation

  @integration
  Scenario: A5 A stored Researcher shell deny replaces its hybrid permission map
    Given a baseline build that includes the Researcher hybrid shell map
    And an isolated policy store blocking shell for Researcher only
    When PAS builds the OpenCode agents with the policy
    Then the generated Researcher profile contains exactly one shell permission entry denying all commands
    And the other generated agent profiles remain unchanged
