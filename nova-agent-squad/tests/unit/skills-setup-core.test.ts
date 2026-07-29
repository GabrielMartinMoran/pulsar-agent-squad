/**
 * Pure unit tests for `nas skills setup` core wizard.
 *
 * Mirrors the precedent set by `tests/integration/setup.test.ts` for
 * `agents/setup-core.ts`. Drives the pure `runSkillsSetupWizard`
 * function with stubbed prompts and dependency functions so the
 * loop / escape / back-navigation contract can be exercised without
 * any @inquirer or filesystem side effects.
 *
 * Behavior contract (FEAT-004):
 *   1. After successful add / remove / clear, the wizard loops back to
 *      the main "what do you want to do?" menu so the user can run
 *      another action in the same session.
 *   2. Escape on the main menu exits cleanly with `appliedChanges`
 *      intact.
 *   3. The "Cancel" option on the main menu exits cleanly.
 *   4. Escape on any inner step goes back exactly one step in the
 *      navigation flow (the previous prompt the user saw).
 *   5. The wizard never swallows genuine (non-AbortPromptError)
 *      errors.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { AbortPromptError } from '@inquirer/core';
import {
  runSkillsSetupWizard,
  isAbortPromptError,
  type SkillsPrompts,
  type SkillsWizardDeps,
} from '../../src/cli/commands/skills/setup-core';
import type { OpenCodeConfig } from '../../src/cli/lib/config-safety';
import type {
  PermissionAction,
  SkillPolicyView,
  SkillRule,
} from '../../src/cli/lib/skill-policies';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyConfig(): OpenCodeConfig {
  return {};
}

function emptyView(): SkillPolicyView {
  return { global: [], perAgent: {} };
}

function silentPrompts(): SkillsPrompts {
  const fail = async () => {
    throw new Error('prompt should not be called in this test');
  };
  return {
    chooseAction: fail,
    chooseScope: fail,
    chooseAgent: fail,
    searchAddPattern: fail,
    chooseRuleAction: fail,
    confirmAdd: fail,
    searchRemovePattern: fail,
    confirmRemove: fail,
    confirmClear: fail,
  };
}

function makePrompts(overrides: Partial<SkillsPrompts>): SkillsPrompts {
  return { ...silentPrompts(), ...overrides };
}

function makeRule(pattern: string, action: PermissionAction = 'allow'): SkillRule {
  return { pattern, action };
}

/**
 * Drive `runSkillsSetupWizard` with stubbed prompts. Returns the result
 * so the test can assert on counters, the exit reason, and the
 * applied-changes counter.
 */
async function drive(
  prompts: SkillsPrompts,
  overrides: Partial<SkillsWizardDeps> = {},
): Promise<{
  result: Awaited<ReturnType<typeof runSkillsSetupWizard>>;
  writes: number;
  backups: number;
  onEscapeCalled: boolean;
}> {
  let writes = 0;
  let backups = 0;
  let onEscapeCalled = false;

  const deps: SkillsWizardDeps = {
    initialConfig: emptyConfig(),
    initialView: emptyView(),
    prompts,
    discoverSkills: () => [],
    addSkillPolicy: <T>(c: T) => c,
    removeSkillPolicy: <T>(c: T) => c,
    clearSkillPolicies: <T>(c: T) => c,
    createBackup: () => {
      backups += 1;
      return '/tmp/backup';
    },
    writeConfig: () => {
      writes += 1;
    },
    output: () => {},
    isAbortPromptError: (err) => err instanceof AbortPromptError,
    onEscapeExit: () => {
      onEscapeCalled = true;
    },
    ...overrides,
  };

  const result = await runSkillsSetupWizard(deps);
  return { result, writes, backups, onEscapeCalled };
}

beforeEach(() => {
  // No shared mutable state across tests; the wizard runs in a single
  // pass and does not cache between runs.
});

// ---------------------------------------------------------------------------
// Outer behaviour: main menu
// ---------------------------------------------------------------------------

describe('runSkillsSetupWizard — main menu exits', () => {
  it('should exit cleanly when Escape is pressed on the main menu', async () => {
    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
    });

    const { result, onEscapeCalled } = await drive(prompts);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(0);
    expect(onEscapeCalled).toBe(true);
  });

  it('should exit cleanly when the user picks "Cancel" on the main menu', async () => {
    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => 'cancel') as SkillsPrompts['chooseAction'],
    });

    const { result } = await drive(prompts);

    expect(result.exitReason).toBe('main_menu_cancel');
    expect(result.appliedChanges).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Loop-back after successful action
// ---------------------------------------------------------------------------

describe('runSkillsSetupWizard — loops back to main menu after success', () => {
  it('should loop back to the main menu after a successful add', async () => {
    let chooseActionCalls = 0;
    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'add';
        // Second main-menu visit → Escape (clean exit).
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => 'all-nas') as SkillsPrompts['chooseScope'],
      searchAddPattern: (async () => 'docs-*') as SkillsPrompts['searchAddPattern'],
      chooseRuleAction: (async () => 'allow') as SkillsPrompts['chooseRuleAction'],
      confirmAdd: (async () => true) as SkillsPrompts['confirmAdd'],
    });

    const { result, writes, backups } = await drive(prompts, {
      discoverSkills: () => ['docs-*', 'git?'],
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(1);
    expect(chooseActionCalls).toBe(2);
    expect(writes).toBe(1);
    expect(backups).toBe(1);
  });

  it('should loop back to the main menu after a successful remove', async () => {
    let chooseActionCalls = 0;
    const existingRule = makeRule('docs-*', 'allow');
    const view: SkillPolicyView = {
      global: [],
      perAgent: { nas_developer: [existingRule] },
    };

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'remove';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => 'agent') as SkillsPrompts['chooseScope'],
      chooseAgent: (async () => 'nas_developer') as SkillsPrompts['chooseAgent'],
      searchRemovePattern: (async () => 'docs-*') as SkillsPrompts['searchRemovePattern'],
      confirmRemove: (async () => true) as SkillsPrompts['confirmRemove'],
    });

    const { result, writes } = await drive(prompts, {
      initialView: view,
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(1);
    expect(chooseActionCalls).toBe(2);
    expect(writes).toBe(1);
  });

  it('should loop back to the main menu after a successful clear', async () => {
    let chooseActionCalls = 0;

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'clear';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      confirmClear: (async () => true) as SkillsPrompts['confirmClear'],
    });

    const { result, writes } = await drive(prompts);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(1);
    expect(chooseActionCalls).toBe(2);
    expect(writes).toBe(1);
  });

  it('should run multiple actions in a single wizard session (add, then remove, then exit)', async () => {
    let chooseActionCalls = 0;
    const existingRule = makeRule('docs-*', 'allow');
    const view: SkillPolicyView = {
      global: [],
      perAgent: { nas_developer: [existingRule] },
    };

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'add';
        if (chooseActionCalls === 2) return 'remove';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => 'all-nas') as SkillsPrompts['chooseScope'],
      searchAddPattern: (async () => 'docs-*') as SkillsPrompts['searchAddPattern'],
      chooseRuleAction: (async () => 'allow') as SkillsPrompts['chooseRuleAction'],
      confirmAdd: (async () => true) as SkillsPrompts['confirmAdd'],
      searchRemovePattern: (async () => 'docs-*') as SkillsPrompts['searchRemovePattern'],
      confirmRemove: (async () => true) as SkillsPrompts['confirmRemove'],
    });

    const { result, writes } = await drive(prompts, {
      initialView: view,
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(2);
    expect(writes).toBe(2);
    expect(chooseActionCalls).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Escape → back one step
// ---------------------------------------------------------------------------

describe('runSkillsSetupWizard — inner Escape goes back exactly one step', () => {
  it('should go back to the main menu when Escape is pressed at the scope step (add)', async () => {
    let chooseActionCalls = 0;
    let chooseScopeCalls = 0;

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'add';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => {
        chooseScopeCalls += 1;
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseScope'],
    });

    const { result } = await drive(prompts);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(0);
    expect(chooseActionCalls).toBe(2);
    expect(chooseScopeCalls).toBe(1);
  });

  it('should go back to the scope step when Escape is pressed at the agent pick step', async () => {
    let chooseActionCalls = 0;
    let chooseScopeCalls = 0;
    let chooseAgentCalls = 0;

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'add';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => {
        chooseScopeCalls += 1;
        if (chooseScopeCalls === 1) return 'agent';
        // Second scope visit (after chooseAgent escape) → all-nas,
        // so the wizard can complete the add flow.
        return 'all-nas';
      }) as SkillsPrompts['chooseScope'],
      chooseAgent: (async () => {
        chooseAgentCalls += 1;
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAgent'],
      searchAddPattern: (async () => 'docs-*') as SkillsPrompts['searchAddPattern'],
      chooseRuleAction: (async () => 'allow') as SkillsPrompts['chooseRuleAction'],
      confirmAdd: (async () => true) as SkillsPrompts['confirmAdd'],
    });

    const { result } = await drive(prompts, {
      discoverSkills: () => ['docs-*'],
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(chooseActionCalls).toBe(2);
    expect(chooseScopeCalls).toBe(2);
    expect(chooseAgentCalls).toBe(1);
  });

  it('should go back to the scope step when Escape is pressed at the pattern step (add)', async () => {
    let chooseActionCalls = 0;
    let chooseScopeCalls = 0;
    let searchCalls = 0;

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'add';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => {
        chooseScopeCalls += 1;
        if (chooseScopeCalls === 1) return 'all-nas';
        // Second scope visit (after pattern escape) → all-nas again,
        // then wizard completes the add flow.
        return 'all-nas';
      }) as SkillsPrompts['chooseScope'],
      searchAddPattern: (async () => {
        searchCalls += 1;
        if (searchCalls === 1) throw new AbortPromptError();
        // Second pattern call returns a real value so the wizard can
        // complete the flow and exit cleanly via the main-menu escape.
        return 'docs-*';
      }) as SkillsPrompts['searchAddPattern'],
      searchRemovePattern: (async () => 'docs-*') as SkillsPrompts['searchRemovePattern'],
      chooseRuleAction: (async () => 'allow') as SkillsPrompts['chooseRuleAction'],
      confirmAdd: (async () => true) as SkillsPrompts['confirmAdd'],
    });

    const { result } = await drive(prompts, {
      discoverSkills: () => ['docs-*'],
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(chooseActionCalls).toBe(2);
    expect(chooseScopeCalls).toBe(2);
    expect(searchCalls).toBe(2);
  });

  it('should go back to the pattern step when Escape is pressed at the action step (add)', async () => {
    let chooseActionCalls = 0;
    let chooseRuleActionCalls = 0;
    let searchCalls = 0;

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'add';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => 'all-nas') as SkillsPrompts['chooseScope'],
      searchAddPattern: (async () => {
        searchCalls += 1;
        return 'docs-*';
      }) as SkillsPrompts['searchAddPattern'],
      chooseRuleAction: (async () => {
        chooseRuleActionCalls += 1;
        if (chooseRuleActionCalls === 1) throw new AbortPromptError();
        // Second call returns a value so the wizard can complete.
        return 'allow';
      }) as SkillsPrompts['chooseRuleAction'],
      confirmAdd: (async () => true) as SkillsPrompts['confirmAdd'],
    });

    const { result } = await drive(prompts, {
      discoverSkills: () => ['docs-*'],
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(chooseActionCalls).toBe(2);
    expect(searchCalls).toBeGreaterThanOrEqual(2);
    expect(chooseRuleActionCalls).toBeGreaterThanOrEqual(2);
  });

  it('should go back to the action step (add) when Escape is pressed at the confirm step', async () => {
    let chooseActionCalls = 0;
    let confirmAddCalls = 0;
    let chooseRuleActionCalls = 0;

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'add';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => 'all-nas') as SkillsPrompts['chooseScope'],
      searchAddPattern: (async () => 'docs-*') as SkillsPrompts['searchAddPattern'],
      chooseRuleAction: (async () => {
        chooseRuleActionCalls += 1;
        return 'allow';
      }) as SkillsPrompts['chooseRuleAction'],
      confirmAdd: (async () => {
        confirmAddCalls += 1;
        if (confirmAddCalls === 1) throw new AbortPromptError();
        // Second call confirms so the wizard can complete.
        return true;
      }) as SkillsPrompts['confirmAdd'],
    });

    const { result } = await drive(prompts, {
      discoverSkills: () => ['docs-*'],
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(chooseActionCalls).toBe(2);
    expect(confirmAddCalls).toBe(2);
    expect(chooseRuleActionCalls).toBeGreaterThanOrEqual(2);
  });

  it('should go back to the main menu when Escape is pressed at the pattern step (remove)', async () => {
    let chooseActionCalls = 0;
    let searchRemoveCalls = 0;
    const view: SkillPolicyView = {
      global: [],
      perAgent: { nas_developer: [makeRule('docs-*', 'allow')] },
    };

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'remove';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => 'agent') as SkillsPrompts['chooseScope'],
      chooseAgent: (async () => 'nas_developer') as SkillsPrompts['chooseAgent'],
      searchRemovePattern: (async () => {
        searchRemoveCalls += 1;
        throw new AbortPromptError();
      }) as SkillsPrompts['searchRemovePattern'],
    });

    const { result } = await drive(prompts, {
      initialView: view,
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(searchRemoveCalls).toBe(1);
    expect(chooseActionCalls).toBe(2);
  });

  it('should go back to the pattern step when Escape is pressed at the confirm step (remove)', async () => {
    let confirmRemoveCalls = 0;
    let searchRemoveCalls = 0;
    let chooseActionCalls = 0;
    const view: SkillPolicyView = {
      global: [],
      perAgent: { nas_developer: [makeRule('docs-*', 'allow')] },
    };

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'remove';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => 'agent') as SkillsPrompts['chooseScope'],
      chooseAgent: (async () => 'nas_developer') as SkillsPrompts['chooseAgent'],
      searchRemovePattern: (async () => {
        searchRemoveCalls += 1;
        return 'docs-*';
      }) as SkillsPrompts['searchRemovePattern'],
      confirmRemove: (async () => {
        confirmRemoveCalls += 1;
        if (confirmRemoveCalls === 1) throw new AbortPromptError();
        // Second call confirms so the wizard can complete.
        return true;
      }) as SkillsPrompts['confirmRemove'],
    });

    const { result } = await drive(prompts, {
      initialView: view,
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(confirmRemoveCalls).toBe(2);
    expect(searchRemoveCalls).toBeGreaterThanOrEqual(2);
    expect(chooseActionCalls).toBe(2);
  });

  it('should go back to the main menu when Escape is pressed at the confirm step (clear)', async () => {
    let chooseActionCalls = 0;
    let confirmClearCalls = 0;

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'clear';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      confirmClear: (async () => {
        confirmClearCalls += 1;
        throw new AbortPromptError();
      }) as SkillsPrompts['confirmClear'],
    });

    const { result } = await drive(prompts);

    expect(result.exitReason).toBe('outer_escape');
    expect(confirmClearCalls).toBe(1);
    expect(chooseActionCalls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Decline at confirm (vs Escape)
// ---------------------------------------------------------------------------

describe('runSkillsSetupWizard — decline at confirm returns to main menu', () => {
  it('should return to the main menu when the user declines the add confirm', async () => {
    let chooseActionCalls = 0;
    let confirmAddCalls = 0;

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'add';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      chooseScope: (async () => 'all-nas') as SkillsPrompts['chooseScope'],
      searchAddPattern: (async () => 'docs-*') as SkillsPrompts['searchAddPattern'],
      chooseRuleAction: (async () => 'allow') as SkillsPrompts['chooseRuleAction'],
      confirmAdd: (async () => {
        confirmAddCalls += 1;
        return false;
      }) as SkillsPrompts['confirmAdd'],
    });

    const { result } = await drive(prompts, {
      discoverSkills: () => ['docs-*'],
    });

    expect(result.exitReason).toBe('outer_escape');
    expect(confirmAddCalls).toBe(1);
    expect(chooseActionCalls).toBe(2);
    expect(result.appliedChanges).toBe(0);
  });

  it('should return to the main menu when the user declines the clear confirm', async () => {
    let chooseActionCalls = 0;
    let confirmClearCalls = 0;

    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'clear';
        throw new AbortPromptError();
      }) as SkillsPrompts['chooseAction'],
      confirmClear: (async () => {
        confirmClearCalls += 1;
        return false;
      }) as SkillsPrompts['confirmClear'],
    });

    const { result } = await drive(prompts);

    expect(result.exitReason).toBe('outer_escape');
    expect(confirmClearCalls).toBe(1);
    expect(chooseActionCalls).toBe(2);
    expect(result.appliedChanges).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Genuine (non-abort) errors propagate
// ---------------------------------------------------------------------------

describe('runSkillsSetupWizard — non-abort errors propagate', () => {
  it('should not swallow genuine (non-AbortPromptError) errors', async () => {
    const prompts: SkillsPrompts = makePrompts({
      chooseAction: (async () => {
        throw new Error('boom: real failure');
      }) as SkillsPrompts['chooseAction'],
    });

    await expect(drive(prompts)).rejects.toThrow(/boom/);
  });
});

// ---------------------------------------------------------------------------
// isAbortPromptError helper
// ---------------------------------------------------------------------------

describe('isAbortPromptError', () => {
  it('should return true for AbortPromptError instances', () => {
    expect(isAbortPromptError(new AbortPromptError())).toBe(true);
  });

  it('should return false for non-abort errors', () => {
    expect(isAbortPromptError(new Error('other'))).toBe(false);
    expect(isAbortPromptError('string error')).toBe(false);
    expect(isAbortPromptError(null)).toBe(false);
    expect(isAbortPromptError(undefined)).toBe(false);
  });
});