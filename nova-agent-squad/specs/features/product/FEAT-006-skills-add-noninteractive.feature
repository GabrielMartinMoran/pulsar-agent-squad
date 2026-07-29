@delta-added
Feature: nas skills add non-interactive command

  As a developer or CI pipeline,
  I want to add `permission.skill` rules via the `nas skills add` CLI
  without entering an interactive wizard,
  so that skill policies can be automated, scripted, and repeatable.

  Background:
    Given a clean OpenCode config at `~/.config/opencode/opencode.json`

  Scenario: Default scope fans out the rule to every canonical NAS agent
    When the user runs `nas skills add docs-writer deny`
    Then the command exits with status code 0
    And the rule `"docs-writer": "deny"` is written to the per-agent block of every canonical NAS agent
    And top-level `permission.skill` is not modified
    And stdout reports "Added all NAS agents rule: docs-writer → deny"

  Scenario: Explicit `--scope all-nas` fans out the rule to every canonical NAS agent
    When the user runs `nas skills add git-* deny --scope all-nas`
    Then the command exits with status code 0
    And the rule `"git-*": "deny"` is written to the per-agent block of every canonical NAS agent
    And top-level `permission.skill` is not modified

  Scenario: `--scope agent --agent <name>` writes to a single agent only
    When the user runs `nas skills add git-* deny --scope agent --agent nas_developer`
    Then the command exits with status code 0
    And the rule `"git-*": "deny"` is written to agent `nas_developer` only
    And no other canonical NAS agent receives the rule
    And stdout reports 'Added agent "nas_developer" rule: git-* → deny'

  Scenario: Legacy top-level `permission.skill` is preserved when adding to NAS agents
    Given the config has a pre-existing top-level `permission.skill` rule `"*": "allow"`
    When the user runs `nas skills add docs-writer deny`
    Then the command exits with status code 0
    And the top-level `permission.skill` rule `"*": "allow"` is preserved as-is
    And the new rule `"docs-writer": "deny"` is written to every canonical NAS agent's per-agent block

  Scenario: Other top-level config keys are preserved
    Given the config has `default_agent: "Nova Agent Squad"` and a `provider` entry
    When the user runs `nas skills add git-* deny`
    Then the command exits with status code 0
    And `default_agent` is preserved as `"Nova Agent Squad"`
    And the `provider` entry is preserved
    And top-level `permission.skill` is not created

  Scenario: Appends to an existing per-agent skill block
    Given agent `nas_developer` already has a per-agent rule `"*": "allow"`
    When the user runs `nas skills add docs-writer deny`
    Then the command exits with status code 0
    And agent `nas_developer` keeps its existing rule `"*": "allow"`
    And agent `nas_developer` gains the new rule `"docs-writer": "deny"`
    And all other canonical NAS agents receive only `"docs-writer": "deny"`

  Scenario: Preserves native OpenCode wildcards verbatim
    When the user runs `nas skills add "a*?b" allow`
    Then the command exits with status code 0
    And the rule is stored with the pattern `"a*?b"` exactly as typed
    And the pattern `*` and `?` characters are not escaped or transformed

  Scenario: Creates a timestamped backup before writing
    Given the config file exists at `~/.config/opencode/opencode.json`
    When the user runs `nas skills add git-* deny`
    Then the command exits with status code 0
    And a backup file matching `opencode.json.bak.YYYYMMDDHHmmss` is created in the same directory
    And the backup contains the original config content before the change

  Scenario: `--dry-run` prints the resulting config without writing
    Given the config file has known content
    When the user runs `nas skills add docs-writer deny --dry-run`
    Then the command exits with status code 0
    And stdout prints the resulting JSON config containing `"docs-writer": "deny"` on NAS agent blocks
    And the config file on disk is unchanged
    And no backup file is created

  Scenario: Rejects an invalid action and does not modify the config
    Given the config file has known content
    When the user runs `nas skills add docs-writer bogus`
    Then the command exits with a non-zero exit code
    And stderr contains a message indicating the action must be one of allow, deny, ask
    And the config file on disk is unchanged

  Scenario: Rejects `--scope agent` when `--agent` is not provided
    Given the config file has known content
    When the user runs `nas skills add docs-writer deny --scope agent`
    Then the command exits with a non-zero exit code
    And stderr contains a message indicating `--agent <name>` is required for agent scope
    And the config file on disk is unchanged

  Scenario: Rejects the old `global` scope value
    Given the config file has known content
    When the user runs `nas skills add docs-writer deny --scope global`
    Then the command exits with a non-zero exit code
    And stderr contains a message indicating `"global"` is not a valid scope
    And the config file on disk is unchanged

  Scenario: Rejects an invalid scope value
    Given the config file has known content
    When the user runs `nas skills add docs-writer deny --scope unknown`
    Then the command exits with a non-zero exit code
    And the config file on disk is unchanged

  Scenario: Rejects an empty pattern
    Given the config file has known content
    When the user runs `nas skills add "" deny`
    Then the command exits with a non-zero exit code
    And stderr contains a message indicating the pattern must be non-empty
    And the config file on disk is unchanged

  Scenario: Reports the build-and-install follow-up instruction on success
    When the user runs `nas skills add docs-writer deny`
    Then the command exits with status code 0
    And stdout includes "Run `nas build --target=opencode && nas install --target=opencode` to propagate the rule"

  Scenario: Failure keeps the original config intact
    Given the config file has known content
    When the user runs `nas skills add docs-writer bogus`
    Then the command exits with a non-zero exit code
    And the config file on disk is byte-identical to its pre-command state
