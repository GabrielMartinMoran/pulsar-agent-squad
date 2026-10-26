Feature: Optional autonomous Pulsar Turbo execution
  PAS users can select a faster self-driving primary without altering the
  original Lead, its workers, or the existing artifact and approval contracts.

  @integration
  Scenario: Turbo is a separately selectable installed OpenCode primary
    Given the OpenCode target is built and installed
    Then Pulsar Turbo is available alongside Pulsar Agent Squad
    And the three original PAS workers remain available
    And both primary agents can receive independent model and skill settings

  @contract
  Scenario: A small change stays with Turbo
    Given the requested change is bounded and has local supporting evidence
    When Turbo classifies the work
    Then Turbo chooses direct research implementation and self verification
    And no delegated worker is required solely because a phase exists
    And source edits still require a scoped single-use approval

  @contract
  Scenario: Deep independent research is delegated in the background
    Given a task has multiple independent unfamiliar questions
    When Turbo needs supporting research
    Then it may dispatch disjoint pas_researcher briefs in the background
    And it waits for and reconciles each report before deciding
    And overlapping research questions are not dispatched as one parallel batch

  @contract
  Scenario: Context pressure changes the execution strategy
    Given remaining context is insufficient for reliable direct completion
    When Turbo reviews its next implementation or validation steps
    Then it persists a resumable handoff
    And delegates only an isolated bounded approved task when useful
    And it never invents token counts or grants additional scope

  @contract
  Scenario: Every change passes the PAS quality gates
    Given a plan has been explicitly approved for one scope
    When Turbo implements directly or delegates an atomic task
    Then behavior changes follow Red Green Refactor
    And tagged Gherkin and PAS state artifacts remain up to date
    And the configured tests lint format and actual diff are reviewed
    And a final evidence-backed PASS FAIL or BLOCKED verdict is recorded

  @contract
  Scenario: Risk triggers independent QA despite self implementation
    Given Turbo implemented an approved security-sensitive change itself
    When direct verification finishes
    Then Turbo delegates the stable diff to pas_qa in the background
    And it waits for the independent verdict before adjudication
    And it never runs QA concurrently with edits to the same tree

  @manual
  Scenario: Runtime behavior reflects selective rather than obligatory delegation
    Given the operator selects Pulsar Turbo in OpenCode
    When the operator tries a trivial read-only question
    And the operator tries a bounded bug fix
    And the operator tries a risky cross-module feature in a disposable repository
    Then the operator observes no workers for the trivial question
    And the operator observes a plan and approval gate before the bug fix
    And the operator observes verified QA and optional independent workers on the risky feature
    And the operator records actual worker launches and QA command output
    # Manual verification: run these three tasks with an OpenCode build
    # installed from the branch. Inspect task spawn events and generated
    # .pas/state artifacts; approve only in the disposable repository.
    # A human operator records the evidence and any model-dependent deviation.
