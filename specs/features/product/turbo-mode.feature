Feature: Optional autonomous Pulsar Agent Turbo execution
  PAS users can select a faster self-driving primary without altering the
  original Lead, its workers, or the existing artifact and approval contracts.

  @integration
  Scenario: Turbo is a separately selectable installed OpenCode primary
    Given the OpenCode target is built and installed
    Then Pulsar Agent Turbo is available alongside Pulsar Agent Squad
    And the three PAS workers remain available
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
  Scenario: Direct execution parallelizes safe independent work
    Given the Turbo agent contract is inspected
    When several reads searches or non-conflicting checks are independent
    Then the prompt requires batching or concurrency for those operations
    And it requires serial writes TDD transitions and shared-resource checks
    And it forbids verification against a changing tree

  @contract
  Scenario: Focused TDD precedes full project validation
    Given the Turbo agent contract is inspected for direct implementation
    When a scoped behavior change is approved
    Then the prompt requires a failing targeted regression test before its fix
    And it requires focused retests after implementation and refactoring
    And it avoids repeating the whole suite after each small edit
    And it requires the full project suite before verification handoff

  @contract
  Scenario: Solo QA retains the original PAS evidence and test strategy gates
    Given the Turbo agent contract is inspected for solo QA
    When no worker is needed
    Then the prompt requires tag fidelity test-level strategy and pyramid review
    And it requires function scenario success error and edge case coverage
    And it requires actual full-suite lint and read-only format evidence
    And it forbids PASS without successful required checks
    And it classifies unavailable required tools or evidence as BLOCKED

  @contract
  Scenario: Risk triggers independent verification despite self implementation
    Given Turbo implemented an approved security-sensitive change itself
    When direct verification finishes
    Then Turbo delegates the stable diff to the copiloted pair
    And the copilot is read-only, so no second writer touches the tree
    And it waits for the pair's ack and both reports before adjudication
    And it never adjudicates on a single unreconciled version of the facts

  @manual
  Scenario: Runtime behavior reflects selective rather than obligatory delegation
    Given the operator selects Pulsar Agent Turbo in OpenCode
    When the operator tries a trivial read-only question
    And the operator tries a bounded bug fix
    And the operator tries a risky cross-module feature in a disposable repository
    Then the operator observes no workers for the trivial question
    And the operator observes a plan and approval gate before the bug fix
    And the operator observes verified QA and optional independent workers on the risky feature
    And the operator records actual worker launches and QA command output
    And the operator confirms targeted RED GREEN REFACTOR evidence before the full suite
    And the operator confirms independent intragent tool calls ran concurrently when safe
    And the operator confirms the full suite and QA review were not skipped in solo mode
    # Manual verification: run these three tasks with an OpenCode build
    # installed from the branch. Inspect task spawn events and generated
    # .pas/state artifacts; approve only in the disposable repository.
    # Preserve execution traces, targeted and full-suite command exit codes,
    # and the final SELF/INDEPENDENT QA evidence; static prompt tests alone
    # do not prove actual runtime concurrency or test execution.
    # A human operator records the evidence and any model-dependent deviation.
