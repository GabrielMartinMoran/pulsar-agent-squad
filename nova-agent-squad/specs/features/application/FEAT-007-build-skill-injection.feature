@delta-added
Feature: nas build skill policy frontmatter injection

  As a developer who uses `nas skills add` to manage skill policies,
  I want `nas build --target=opencode` to compile my per-agent `permission.skill` rules
  into the dist agent frontmatter,
  so that the rules take effect at OpenCode runtime without runtime merge ambiguity.

  Background:
    Given the project has agent source files under `src/agents/`
    And the source frontmatter of each NAS agent contains a `permission:` block with `"*": allow`
    And a fixture `opencode.json` is exposed via `NAS_OPENCODE_CONFIG_PATH`
    And the fixture has per-agent `permission.skill` rules for every canonical NAS agent

  Scenario: Injects per-agent skill rules into the dist frontmatter
    When the user runs `nas build --target=opencode`
    Then the command exits with status code 0
    And the dist file `dist/platforms/opencode/agents/nas_developer.md` contains the injected rule `"IADEV*": deny`
    And the dist file for `nas_developer` contains the injected rule `"git-*": deny`

  Scenario: Injects skill rules for every NAS agent that has rules in the config
    When the user runs `nas build --target=opencode`
    Then the command exits with status code 0
    And every dist NAS agent file contains `"IADEV*": deny` in its `permission.skill` block

  Scenario: Skill block is placed after `"*": allow` so last-match-wins applies
    When the user runs `nas build --target=opencode`
    Then the command exits with status code 0
    And in `nas_developer.md`, the `skill:` line appears after the `"*": allow` line
    And the `skill:` key is a sibling of `"*": allow` at 2-space indentation
    And the skill rule children are indented at 4 spaces

  Scenario: Caveman INJECT markers are still processed
    When the user runs `nas build --target=opencode`
    Then the command exits with status code 0
    And `nas_developer.md` does not contain `INJECT:caveman`
    And `nas_developer.md` contains the rendered caveman developer content
    And `nas_qa.md` does not contain `INJECT:caveman`
    And `nas_qa.md` contains the rendered caveman QA content

  Scenario: No rules in user config produces byte-identical dist output
    Given the fixture `opencode.json` has no per-agent `permission.skill` rules
    When the user runs `nas build --target=opencode`
    Then the command exits with status code 0
    And the dist file is byte-identical to the source file
    And no `skill:` line is injected into the frontmatter

  Scenario: Malformed or unreadable config does not break the build
    Given `NAS_OPENCODE_CONFIG_PATH` points to a file with invalid JSON
    When the user runs `nas build --target=opencode`
    Then the command exits with status code 0
    And the dist files are produced with source content unchanged
    And no `skill:` block is injected

  Scenario: Source without a `permission:` block is not touched
    Given the source agent file has no `permission:` frontmatter block
    When the user runs `nas build --target=opencode`
    Then the command exits with status code 0
    And the dist file is byte-identical to the source file
    And no `skill:` line is injected

  Scenario: Existing `skill:` block in source is replaced in place
    Given the source frontmatter already contains a `skill:` child within `permission:`
    And the fixture config has per-agent rules for that agent
    When the user runs `nas build --target=opencode`
    Then the command exits with status code 0
    And the existing `skill:` block children are replaced with the merged rules from the config
    And the `skill:` key position within the `permission:` block is preserved

  Scenario: Only OpenCode platform agents get skill injection
    Given the manifest defines targets for both `opencode` and `cursor`
    And the fixture config has per-agent skill rules
    When the user runs `nas build --target=cursor`
    Then the command exits with status code 0
    And the cursor dist file does not contain a `skill:` frontmatter block

  Scenario: Build with `--target=opencode` creates dist directory with all NAS agent files
    When the user runs `nas build --target=opencode`
    Then the command exits with status code 0
    And `dist/platforms/opencode/agents/` contains at least 5 files
    And the directory contains `Nova Agent Squad.md`
    And the directory contains `nas_developer.md`
    And the directory contains `nas_qa.md`
    And the directory contains `nas_researcher.md`
    And the directory contains `nas_planner.md`

  Scenario: Build for an unknown target fails with a clear error
    When the user runs `nas build --target=nonexistent`
    Then the command exits with a non-zero exit code
    And stderr contains `ERROR: unknown TARGET`
