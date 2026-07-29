/**
 * Structural redraw test for `pas skills setup`.
 *
 * Mirrors the precedent set by `tests/unit/setup-esc-redraw.test.ts`
 * (FEAT-003 for `agents/setup`). The fix for the ESC redraw bug is
 * to add `clearPromptOnDone: true` to every prompt context object so
 * @inquirer/core's `screen.done({ clearContent: Boolean(context.clearPromptOnDone) })`
 * actually erases the prompt instead of leaving residual text below the
 * next prompt.
 *
 * The skills setup has 9 distinct @inquirer prompt call-sites:
 *   1. chooseAction      — main menu (Add/Remove/Clear/Cancel)
 *   2. chooseScope       — Add/Remove scope pick
 *   3. chooseAgent       — agent pick (when scope = agent)
 *   4. searchAddPattern  — pattern pick for Add
 *   5. chooseRuleAction  — action pick (allow/deny/ask)
 *   6. confirmAdd        — Add confirm
 *   7. searchRemovePattern — pattern pick for Remove
 *   8. confirmRemove     — Remove confirm
 *   9. confirmClear      — Clear confirm
 *
 * This test drives the wizard through add (agent-scope) → remove
 * (all-pas) → clear → outer-escape to exercise every call-site, then
 * asserts every captured context object has `clearPromptOnDone: true`
 * and a non-null `signal`.
 */

import { describe, expect, it, mock, beforeAll, beforeEach, afterAll } from 'bun:test';
import { AbortPromptError } from '@inquirer/core';

// ---------------------------------------------------------------------------
// Capture the REAL implementations of the modules we mock below so we can
// re-register them in afterAll. Bun's `mock.module()` registrations are
// process-global and `mock.restore()` does NOT clear them, so without this
// re-registration subsequent dynamic-importing test files would see the
// mocked factories and lose access to the real named exports.
//
// CRITICAL: capturing the namespace imports is not enough — bun's
// `mock.module()` retroactively updates already-imported modules' exports,
// so `realConfigSafety.readConfig` itself would be replaced by the mock
// function the moment `beforeAll` calls `mock.module()`. We therefore
// capture the actual function references at module-load time, BEFORE any
// mock.module has run, while they still point at the real implementations.
// These captured references are closed-over by the `afterAll` re-registration
// factory and survive the mock.module calls.
// ---------------------------------------------------------------------------
import * as realConfigSafety from '../../src/cli/lib/config-safety';
import * as realSkillPolicies from '../../src/cli/lib/skill-policies';
import * as realSkillDiscovery from '../../src/cli/lib/skill-discovery';

const REAL_readConfig = realConfigSafety.readConfig;
const REAL_createBackup = realConfigSafety.createBackup;
const REAL_writeConfig = realConfigSafety.writeConfig;
const REAL_readSkillPolicies = realSkillPolicies.readSkillPolicies;
const REAL_addSkillPolicy = realSkillPolicies.addSkillPolicy;
const REAL_removeSkillPolicy = realSkillPolicies.removeSkillPolicy;
const REAL_clearSkillPolicies = realSkillPolicies.clearSkillPolicies;
const REAL_isValidAction = realSkillPolicies.isValidAction;
const REAL_listAvailableSkills = realSkillDiscovery.listAvailableSkills;

// ---------------------------------------------------------------------------
// Captured context objects from the @inquirer call-sites
// ---------------------------------------------------------------------------
const contexts: Array<Record<string, unknown>> = [];
let searchCallCount = 0;
let selectCallCount = 0;
let confirmCallCount = 0;

beforeEach(() => {
  contexts.length = 0;
  searchCallCount = 0;
  selectCallCount = 0;
  confirmCallCount = 0;
});

// ---------------------------------------------------------------------------
// Mock @inquirer packages. The wizard expects to drive through:
//   searchAddPattern('docs-*') → searchRemovePattern('docs-*') →
//   then the test ends (search should not be called again).
//
// These mocks are registered at module scope on purpose: no other test
// file in the suite statically imports `@inquirer/*` (only this file,
// `tests/unit/setup-esc-redraw.test.ts`, and the production
// `src/cli/commands/{skills,agents}/setup.ts` do), and the other
// mocking file (`setup-esc-redraw.test.ts`) re-registers its own
// factories which REPLACE ours on load, so neither direction of test
// ordering matters. The `setup-esc-redraw.test.ts` mock factories
// only target @inquirer/* and config-safety/model-discovery, never
// these three internal modules, so there is no leakage into the
// failing tests (config-safety, skill-policies, skill-discovery).
// ---------------------------------------------------------------------------
mock.module('@inquirer/search', () => ({
  default: (_config: unknown, context: unknown) => {
    contexts.push({ ...(context as Record<string, unknown>), _caller: 'search' });
    searchCallCount += 1;
    if (searchCallCount === 1) return 'docs-*';
    if (searchCallCount === 2) return 'docs-*';
    throw new Error(`unexpected search call #${searchCallCount}`);
  },
}));

// ---------------------------------------------------------------------------
// Mock @inquirer/select. The wizard loops back to the main menu after
// each action. Dispatch order:
//
//   chooseAction   → 'add'         (call 1)
//   chooseScope    → 'agent'       (call 2)
//   chooseAgent    -> 'pas_developer' (call 3)
//   chooseRuleAction → 'allow'     (call 4)
//   chooseAction   → 'remove'      (call 5, after add loops back)
//   chooseScope    → 'all-pas'     (call 6)
//   chooseAction   → 'clear'       (call 7, after remove loops back)
//   chooseAction   → AbortPromptError (call 8, outer escape)
//
// (searchRemovePattern is called inside the Remove flow but at scope=
// 'all-pas' the agent pick is skipped, so no chooseAgent call.)
// ---------------------------------------------------------------------------
mock.module('@inquirer/select', () => ({
  default: (_config: unknown, context: unknown) => {
    contexts.push({ ...(context as Record<string, unknown>), _caller: 'select' });
    selectCallCount += 1;
    switch (selectCallCount) {
      case 1:
        return 'add';
      case 2:
        return 'agent';
      case 3:
        return 'pas_developer';
      case 4:
        return 'allow';
      case 5:
        return 'remove';
      case 6:
        return 'all-pas';
      case 7:
        return 'clear';
      default:
        // Final main-menu visit → Escape.
        throw new AbortPromptError();
    }
  },
}));

// ---------------------------------------------------------------------------
// Mock @inquirer/confirm. The wizard expects:
//   confirmAdd    → true
//   confirmRemove → true
//   confirmClear  → true
// ---------------------------------------------------------------------------
mock.module('@inquirer/confirm', () => ({
  default: (_config: unknown, context: unknown) => {
    contexts.push({ ...(context as Record<string, unknown>), _caller: 'confirm' });
    confirmCallCount += 1;
    return true;
  },
}));

// ---------------------------------------------------------------------------
// Mock internal modules to avoid real I/O / subprocess spawn.
//
// CRITICAL: these `mock.module()` calls must run INSIDE `beforeAll`, not
// at module scope. Bun's mock.module() registrations are process-global
// and are NOT cleared by `mock.restore()`. When registered at module
// scope, they execute during test-file discovery — BEFORE the static
// imports of every other test file are resolved. That means later-loaded
// files (config-safety, skill-policies, skill-discovery) statically bind
// to the mocked factory instead of the real module, producing 37
// downstream failures.
//
// By moving the registration into `beforeAll`, the registration runs at
// test-execution time, AFTER every file's static imports have already
// resolved to the real modules. The mocked factories only intercept the
// dynamic `import('../../src/cli/commands/skills/setup')` performed
// inside the test body. The companion `afterAll` block then re-registers
// the REAL factories so any future dynamic import in this process sees
// the real implementations again.
//
// Use resolved string paths so bun:test intercepts these mocks. The
// regex form (e.g. /config-safety/) is NOT intercepted by bun:test for
// relative-from-importer specifiers — the real module runs instead, and
// in this skills flow that real module short-circuits the Remove flow,
// dropping captured contexts from 13 to 11. The agents wizard
// (tests/unit/setup-esc-redraw.test.ts) tolerates the no-op regex mock
// because its flow doesn't read pre-existing rules; the skills wizard
// does, so we need the explicit resolved path here.
// ---------------------------------------------------------------------------
beforeAll(() => {
  mock.module('../../src/cli/lib/config-safety', () => ({
    readConfig: () => ({
      agent: {
        pas_developer: {
          permission: { skill: { 'docs-*': 'allow' } },
        },
      },
    }),
    createBackup: () => '/tmp/backup',
    writeConfig: () => {},
  }));

  mock.module('../../src/cli/lib/skill-policies', () => ({
    readSkillPolicies: () => ({
      global: [],
      perAgent: {
        pas_developer: [{ pattern: 'docs-*', action: 'allow' }],
      },
    }),
    addSkillPolicy: <T>(c: T) => c,
    removeSkillPolicy: <T>(c: T) => c,
    clearSkillPolicies: <T>(c: T) => c,
    isValidAction: (v: unknown) => v === 'allow' || v === 'deny' || v === 'ask',
  }));

  mock.module('../../src/cli/lib/skill-discovery', () => ({
    listAvailableSkills: () => ['docs-*', 'git?', 'bash-runner'],
  }));
});

// Restore all mocks after this suite runs so subsequent test files
// (e.g. tests/unit/skill-policies.test.ts and tests/unit/config-safety.test.ts)
// see the real module implementations for any future dynamic import.
//
// `mock.restore()` clears `mock()`-style function spies but does NOT
// clear `mock.module()` factory registrations, so we additionally
// re-register the REAL module factories for the three internal modules
// we mocked in `beforeAll`. The other test files' static imports are
// already bound to the real modules (resolved at discovery time,
// before any `beforeAll` ran), but future dynamic imports in the same
// process would otherwise see our test-local factories.
afterAll(() => {
  mock.restore();
  // Re-register the REAL function references captured at module-load time.
  // We do NOT re-register the namespace imports — those were retroactively
  // mutated by the beforeAll mock.module() calls (bun's mock.module updates
  // already-imported modules' exports), so using them here would restore
  // the MOCK factory, not the real one. The captured function references
  // above are stable and still point at the real implementations.
  mock.module('../../src/cli/lib/config-safety', () => ({
    readConfig: REAL_readConfig,
    createBackup: REAL_createBackup,
    writeConfig: REAL_writeConfig,
  }));
  mock.module('../../src/cli/lib/skill-policies', () => ({
    readSkillPolicies: REAL_readSkillPolicies,
    addSkillPolicy: REAL_addSkillPolicy,
    removeSkillPolicy: REAL_removeSkillPolicy,
    clearSkillPolicies: REAL_clearSkillPolicies,
    isValidAction: REAL_isValidAction,
  }));
  mock.module('../../src/cli/lib/skill-discovery', () => ({
    listAvailableSkills: REAL_listAvailableSkills,
  }));
});

// ---------------------------------------------------------------------------
// The actual test
// ---------------------------------------------------------------------------
describe('skills setup — ESC redraw — clearPromptOnDone', () => {
  it('should pass clearPromptOnDone:true and a signal in all 9 prompt contexts', async () => {
    // Dynamic import AFTER mocks are registered
    const setupModule = await import('../../src/cli/commands/skills/setup');
    const cmd = setupModule.default;

    // Run the wizard with mocked @inquirer packages. Flow:
    //   chooseAction(add) -> chooseScope(agent) -> chooseAgent(pas_developer) ->
    //   searchAddPattern(docs-*) → chooseRuleAction(allow) → confirmAdd(true) →
    //   LOOP → chooseAction(remove) → chooseScope(all-pas) →
    //   searchRemovePattern(docs-*) → confirmRemove(true) →
    //   LOOP → chooseAction(clear) → confirmClear(true) →
    //   LOOP → chooseAction(AbortPromptError) → outer escape
    await cmd.run();

    // 2 search calls (searchAddPattern + searchRemovePattern)
    // 8 select calls (chooseAction ×4 + chooseScope ×2 + chooseAgent ×1 + chooseRuleAction ×1)
    // 3 confirm calls (confirmAdd + confirmRemove + confirmClear)
    // Total = 13 prompt contexts.
    expect(contexts.length).toBe(13);

    // Every captured context must have the redraw fix and a live signal.
    for (const ctx of contexts) {
      expect(ctx.clearPromptOnDone).toBe(true);
      expect(ctx.signal).toBeDefined();
      expect(ctx.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
