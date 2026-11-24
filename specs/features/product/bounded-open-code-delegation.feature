Feature: Bounded OpenCode delegation without paired workers

  @contract
  Scenario: A1 Squad and Turbo share a brief format when delegating
    Given the existing roster, permissions, and routing rules
    When either primary agent delegates a task
    Then its XML brief names the objective, authorized scope, acceptance, and expected evidence
    And implementation hints do not grant authority or change when the agent delegates

  @contract
  Scenario: A2 Researcher returns an answer with evidence and limits
    Given a bounded research brief and the existing researcher permission profile
    When the researcher returns a report
    Then it includes a direct answer, sources, limits, and an explicit closure status
    And it distinguishes source inspection from live verification without gaining shell access

  @contract
  Scenario: A3 Read-only QA verifies existing behavior without requiring a new TDD cycle
    Given a bounded change and a check for behavior that already exists
    When the developer changes behavior and QA inspects current evidence
    Then the developer retains TDD and full-suite requirements for changes
    And QA verifies the existing behavior independently without manufacturing TDD evidence
