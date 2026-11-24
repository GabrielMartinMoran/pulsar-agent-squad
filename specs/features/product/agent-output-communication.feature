Feature: Readable agent updates and session closings

  @contract
  Scenario: C1 Squad reports a verified milestone once
    Given a developer result followed by successful independent QA
    When Squad communicates progress for the task
    Then Squad reports one outcome-first milestone or includes it only in the immediate closing
    And the notice does not start with a raw worker verdict prefix
    And the parallel research cadence and Research Quality Gate stay unchanged

  @contract
  Scenario: C2 A material issue is surfaced when it arises
    Given Squad or Turbo encounters a material failure, deviation, blocker, or decision for the user
    When the agent reports the issue
    Then the message identifies what is affected and whether other work can proceed
    And it distinguishes a pending check from a blocked delivery

  @contract
  Scenario: C3 A substantive closing is recognizable and scannable
    Given Squad or Turbo is closing a substantive delivery or investigation
    When the agent summarizes the outcome
    Then a descriptive Markdown heading names the result and its actual status
    And outcome, verification evidence, and next steps or remaining gaps are easy to find
    And the closing retains scope, changed paths, worker counts, QA verdict, and material limitations
    And Turbo distinguishes self QA, independent QA, and no QA
    And Squad includes the reason when work was interrupted
    And the closing does not repeat an identical progress notice

  @contract
  Scenario: C4 A quick answer does not require a delivery template
    Given a brief question that does not close a substantive workflow
    When Squad or Turbo replies
    Then the agent answers directly without mandatory delivery sections
    And the planning approval gate, internal worker reports, and QA semantics remain unchanged
