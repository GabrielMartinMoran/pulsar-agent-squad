/**
 * Unit tests for the ESC redraw fix.
 *
 * Root cause: all five @inquirer/prompts call-sites in setup.ts pass
 * only `{ signal }` as context.  @inquirer/core's screen.done() uses
 * `clearContent: Boolean(context.clearPromptOnDone)` which defaults to
 * `false` → newline-only cleanup → next prompt stacks below the previous.
 *
 * Fix: add `clearPromptOnDone: true` to every prompt context object so
 * each prompt is fully erased on done/abort, preventing menu stacking.
 *
 * Only src/cli/commands/agents/setup.ts is changed.
 *
 * Strategy: mock @inquirer/select, @inquirer/search, @inquirer/confirm
 * (to capture context objects and return wizard-driving values), and
 * mock config-safety and model-discovery (to avoid real I/O / subprocess
 * spawn).  let runSetupWizard and prompt-escape run naturally.
 */

import { describe, expect, it, mock, beforeEach, afterAll } from 'bun:test';
import { AbortPromptError } from '@inquirer/core';

// ---------------------------------------------------------------------------
// Captured context objects from the five @inquirer call-sites
// ---------------------------------------------------------------------------
const contexts: Array<Record<string, unknown>> = [];
let searchCallCount = 0;

beforeEach(() => {
  contexts.length = 0;
  searchCallCount = 0;
});

// Restore all mocks after this suite runs so subsequent test files
// (e.g. tests/unit/skills-setup-esc-redraw.test.ts) see the real
// module implementations. Without this, the @inquirer search/select/
// confirm mocks and the config-safety / model-discovery mocks persist
// for the remainder of the run and break unrelated tests.
afterAll(() => {
  mock.restore();
});

// ---------------------------------------------------------------------------
// Mock @inquirer packages to intercept context objects AND drive wizard flow
// ---------------------------------------------------------------------------
// Call-sites 1 & 3: selectAgentPrompt + searchModel → search<...>(..., { ...context })
// Call 1 → agent list, return 'nas_developer'
// Call 2 → model search, return Model-like object
// Call 3 → agent list again, throw AbortPromptError (outer escape)
mock.module('@inquirer/search', () => ({
  default: (_config: unknown, context: unknown) => {
    contexts.push({ ...(context as Record<string, unknown>), _caller: 'search' });
    searchCallCount++;
    if (searchCallCount === 1) return 'nas_developer';
    if (searchCallCount === 2) return { id: 'test/model', provider: 'test', name: 'test-model' };
    throw new AbortPromptError();
  },
}));

// Call-sites 2 & 4: chooseAction + chooseVariant → select<...>(..., { ...context })
// Always return 'change_model' so the wizard flows through all steps.
mock.module('@inquirer/select', () => ({
  default: (_config: unknown, context: unknown) => {
    contexts.push({ ...(context as Record<string, unknown>), _caller: 'select' });
    return 'change_model';
  },
}));

// Call-site 5: confirmApply → confirm(..., { ...context })
mock.module('@inquirer/confirm', () => ({
  default: (_config: unknown, context: unknown) => {
    contexts.push({ ...(context as Record<string, unknown>), _caller: 'confirm' });
    return true;
  },
}));

// ---------------------------------------------------------------------------
// Mock internal modules to avoid real I/O / subprocess spawn
// ---------------------------------------------------------------------------
mock.module(/config-safety/, () => ({
  readConfig: () => ({}),
  createBackup: () => '/tmp/backup',
  setAgentModel: <T>(c: T) => c,
  removeAgentOverride: <T>(c: T) => c,
  writeConfig: () => {},
}));

mock.module(/model-discovery/, () => ({
  discoverModels: async () => [{ id: 'test/model', provider: 'test', name: 'test-model' }],
  populateVariantsFromVerbose: async () => {},
  discoverVariants: () => [],
}));

// ---------------------------------------------------------------------------
// The actual test
// ---------------------------------------------------------------------------
describe('ESC redraw — clearPromptOnDone', () => {
  it('should pass clearPromptOnDone:true in all five prompt context objects', async () => {
    // Dynamic import AFTER mocks are registered
    const setupModule = await import('../../src/cli/commands/agents/setup');
    const cmd = setupModule.default;

    // Run the wizard with mocked @inquirer packages.
    // Flow: selectAgent (search) → chooseAction (select: change_model)
    //       → searchModel (search: model) → (no variants) → confirmApply (confirm: true)
    //       → apply → selectAgent (search: AbortPromptError) → outer escape
    await cmd.run();

    // 3 search calls + 1 select call + 1 confirm call = 5 contexts
    expect(contexts.length).toBe(5);

    const callers = contexts.map((c) => c._caller);
    expect(callers.filter((c) => c === 'search')).toHaveLength(3);
    expect(callers.filter((c) => c === 'select')).toHaveLength(1);
    expect(callers.filter((c) => c === 'confirm')).toHaveLength(1);

    // Every captured context must have the fix
    for (const ctx of contexts) {
      expect(ctx.clearPromptOnDone).toBe(true);
    }
  });
});
