Feature: Deny tools for Pulsar agents in OpenCode

  @unit
  Scenario: P1 Tool policy actions make idempotent scoped changes
    Given global PAS and per-agent tool denies
    When I block, unblock, or clear tool denies in one scope
    Then the change affects only the selected scope
    And repeating the action does not add duplicate rules or grant permissions

  @integration
  Scenario: P2 Only confirmed CLI mutations write tool policies
    Given isolated PAS configuration with an empty or existing policy store
    When I list, preview, cancel setup, or confirm a policy mutation
    Then only a confirmed mutation writes the policy store
    And an invalid store is reported without overwriting it

  @contract
  Scenario: P3 Build applies scoped denies without changing unrelated rules
    Given an OpenCode agent with existing permission rules
    When I build the agent with applicable PAS denies
    Then the generated rules preserve unrelated permissions
    And the applicable denies follow existing rules in a deterministic order without duplicates

  @integration
  Scenario: P4 Tool policies survive reinstall and uninstall
    Given a recorded tool deny in isolated PAS configuration
    When I build, install, uninstall, and reinstall OpenCode artifacts
    Then the reinstalled agent includes the recorded deny
    And neither the stored deny nor unrelated OpenCode settings are discarded

  @manual
  Scenario: P5 A fresh OpenCode session enforces a tool deny
    Given QA has verified a disposable OpenCode V2 profile and private server are isolated from personal settings
    And QA has confirmed that the control agent can call a harmless tool
    When the same agent starts a fresh session with the installed deny
    Then QA observes that the tool is denied or unavailable and records runtime evidence

  @manual
  Scenario: S1 Skill migration is gated on effective permission parity
    Given QA has a disposable OpenCode V2 profile with overlapping supported skill rules
    When QA compares allow, deny, ask, and later add, remove, and clear behavior before and after migration
    Then the migration is eligible only if the effective behavior matches
    And otherwise the legacy skill behavior stays unchanged
