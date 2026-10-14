@product @documentation
Feature: Project documentation maintained by the harness
  Living docs live in the project repo as maps: architecture with indexed ADRs,
  domain essentials, UI guidelines when the project has a UI, and the product
  view that points to the Gherkin specs.

  Background:
    Given a project where the harness operates

  @documentation @integration
  Scenario: Docs are maps that reference their sources
    Then the project keeps docs/architecture.md, docs/domain.md, and docs/product.md
    And docs/ui-guidelines.md exists for projects with a UI
    And each doc references code and specs instead of duplicating them

  @documentation @integration
  Scenario: Architecture decisions are recorded as ADRs
    Given an architecturally significant decision
    Then it is recorded under docs/adr/ with a quick index in docs/architecture.md
    And accepted ADRs are superseded instead of rewritten

  @documentation @integration
  Scenario: Docs are maintained with the change
    Given a change that affects a documented aspect
    Then the matching docs/ file is updated in the same change
    And the Lead surfaces missing or stale docs and offers to create or update them

  @documentation @unit
  Scenario: Docs integrity holds in the PAS repo
    Given the PAS repo's docs
    Then every doc exists with an owner and updated date
    And every pointer to a spec resolves
