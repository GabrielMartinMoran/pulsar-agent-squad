@product @model-configuration @variant-discovery
Feature: Reasoning variant discovery for model selection
  The `pas agents setup` wizard discovers each model's reasoning variants from
  the OpenCode v2 model registry so users can choose an effort level; the
  registry is fetched once per run and discovery failures degrade to skipping
  the variant step without blocking the wizard.

  Background:
    Given the wizard discovers models with `opencode models`
    And populates variants from the v2 model registry

  @variant-discovery @registry @unit
  Scenario: Variant registry is parsed from the v2 model list
    Given the model list returns data items with provider, model id, and variant ids
    When the variant registry is populated
    Then each model's variant ids are available through discoverVariants
    And entries are keyed by provider plus model id, including multi-segment model ids

  @variant-discovery @registry @unit
  Scenario: Models without variants expose no variant data
    Given a model list item whose variants array is empty
    Then discoverVariants returns no variants for that model

  @variant-discovery @registry @unit
  Scenario: Malformed registry entries are tolerated
    Given model list items missing ids or carrying non-string variant entries
    Then malformed items are skipped and the remaining registry still parses

  @variant-discovery @resilience @unit
  Scenario: Discovery failure degrades silently
    Given the v2 model registry request exits non-zero, throws, or returns unparseable output
    Then discoverVariants returns no variants for the rest of the run
    And the registry is attempted only once per run

  @variant-discovery @cache @unit
  Scenario: Variant registry is attempted once per run
    Given a variant registry attempt has completed
    Then a second populate call does not spawn the command again
    And a cache reset clears the model and variant caches
    And callers receive defensive copies of the variant lists

  @variant-discovery @wizard @integration
  Scenario: Wizard offers discovered variants after model discovery
    Given model discovery succeeded and the registry exposes variants for the chosen model
    When the user selects that model
    Then the variant step offers `default (no variant)` plus every discovered variant id
    And the chosen variant is persisted on the agent configuration

  @variant-discovery @wizard @integration
  Scenario: Models without variants skip the variant step
    Given the chosen model has no registered variants
    Then the wizard continues to confirmation without a variant step
    And any existing variant value is preserved
