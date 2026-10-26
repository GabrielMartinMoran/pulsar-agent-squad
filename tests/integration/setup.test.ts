import { describe, expect, it, afterEach } from 'bun:test';
import {
  setAgentModel,
  removeAgentOverride,
  readConfig,
  writeConfig,
  createBackup,
  type OpenCodeConfig,
} from '../../src/cli/lib/config-safety';
import {
  PAS_AGENTS,
  getModelGuidance,
  formatAgentOutput,
} from '../../src/cli/commands/agents/setup';
import { rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  runSetupWizard,
  isAbortPromptError,
  type SetupPrompts,
  type SetupWizardDeps,
  type Action,
} from '../../src/cli/commands/agents/setup-core';
import { AbortPromptError } from '@inquirer/core';
import type { Model } from '../../src/cli/lib/model-discovery';

const testDir = join(tmpdir(), 'pas-setup-integration-' + Date.now());

function createTestConfig(content: object): string {
  mkdirSync(testDir, { recursive: true });
  const path = join(testDir, 'opencode.json');
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

function cleanup() {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
}

afterEach(cleanup);

describe('Setup wizard — config persistence', () => {
  it('should apply setAgentModel and persist to file', () => {
    const path = createTestConfig({ default_agent: 'pas_developer' });
    const config = readConfig(path);
    const modified = setAgentModel(config, 'pas_developer', 'anthropic/claude-sonnet-4-6');
    writeConfig(modified, path);

    const reread = readConfig(path);
    expect(reread.agent).toBeDefined();
    expect(reread.agent!.pas_developer).toEqual({ model: 'anthropic/claude-sonnet-4-6' });
    expect(reread.default_agent).toBe('pas_developer');
  });

  it('should remove override and persist to file', () => {
    const path = createTestConfig({
      agent: { pas_developer: { model: 'old/model' } },
    });
    const config = readConfig(path);
    const removed = removeAgentOverride(config, 'pas_developer');
    writeConfig(removed, path);

    const reread = readConfig(path);
    expect(reread.agent).toBeUndefined();
  });

  it('should preserve complex existing config through modification', () => {
    const original = {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'Pulsar Agent Squad',
      mcp: {
        server: { type: 'local', command: ['echo'], enabled: true },
      },
      instructions: ['instruction-file.md'],
      plugin: ['plugin-one'],
      provider: { cursor: { name: 'Cursor' } },
    };
    const path = createTestConfig(original);
    const config = readConfig(path);
    const modified = setAgentModel(config, 'pas_developer', 'anthropic/model');
    writeConfig(modified, path);

    const reread = readConfig(path);
    expect(reread.$schema).toBe('https://opencode.ai/config.json');
    expect(reread.default_agent).toBe('Pulsar Agent Squad');
    expect(reread.mcp).toBeDefined();
    expect(reread.instructions).toBeDefined();
    expect(reread.plugin).toBeDefined();
    expect(reread.provider).toBeDefined();
    expect(reread.agent!.pas_developer.model).toBe('anthropic/model');
  });

  it('should create backup before modification', () => {
    const path = createTestConfig({ key: 'original' });
    const backupPath = createBackup(path);
    expect(backupPath).toMatch(/\.bak\.\d{14}$/);

    const backupContent = readFileSync(backupPath, 'utf-8');
    expect(backupContent).toContain('"key": "original"');
    try {
      rmSync(backupPath);
    } catch {}
  });

  it('should handle running setup twice — second run reads previous override', () => {
    const path = createTestConfig({ default_agent: 'test' });

    // First run: set model
    const config1 = readConfig(path);
    const modified1 = setAgentModel(config1, 'pas_developer', 'first/model');
    writeConfig(modified1, path);

    // Second run: read and find previous override
    const config2 = readConfig(path);
    expect(config2.agent).toBeDefined();
    expect(config2.agent!.pas_developer.model).toBe('first/model');

    // Second run: change model
    const modified2 = setAgentModel(config2, 'pas_developer', 'second/model');
    writeConfig(modified2, path);

    const final = readConfig(path);
    expect(final.agent!.pas_developer.model).toBe('second/model');
  });

  it('should clean up empty agent section after last override removal', () => {
    const path = createTestConfig({
      agent: { pas_developer: { model: 'test/model' } },
      default_agent: 'test',
    });
    const config = readConfig(path);
    expect(config.agent).toBeDefined();

    const removed = removeAgentOverride(config, 'pas_developer');
    expect(removed.agent).toBeUndefined();
    writeConfig(removed, path);

    const reread = readConfig(path);
    expect(reread.agent).toBeUndefined();
    expect(reread.default_agent).toBe('test');
  });

  it('should throw on malformed JSON before any modification', () => {
    const path = join(testDir, 'broken.json');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(path, '{ invalid json');
    expect(() => readConfig(path)).toThrow(/malformed|parse|JSON/i);
  });
});

describe('Setup wizard — model lookup helpers', () => {
  it('should find current model for an agent from config', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
        pas_qa: { model: 'opencode/deepseek-v4-pro' },
      },
    };
    expect(config.agent?.pas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
    expect(config.agent?.pas_qa?.model).toBe('opencode/deepseek-v4-pro');
    expect(config.agent?.pas_researcher?.model).toBeUndefined();
  });

  it('should return undefined when agent has no config section', () => {
    const config: OpenCodeConfig = { default_agent: 'test' };
    expect(config.agent?.pas_developer?.model).toBeUndefined();
  });
});

describe('Setup wizard — variant flow', () => {
  it('should persist model with variant and re-read correctly', () => {
    const path = createTestConfig({ default_agent: 'pas_developer' });
    const config = readConfig(path);
    const modified = setAgentModel(
      config,
      'pas_developer',
      'openrouter/anthropic/claude-sonnet',
      'high',
    );
    writeConfig(modified, path);

    const reread = readConfig(path);
    expect(reread.agent!.pas_developer).toEqual({
      model: 'openrouter/anthropic/claude-sonnet',
      variant: 'high',
    });
  });

  it('should change variant on re-run and persist', () => {
    const path = createTestConfig({
      agent: { pas_developer: { model: 'openrouter/anthropic/claude-sonnet', variant: 'high' } },
    });

    // Re-run: change variant from high to max
    const config = readConfig(path);
    const modified = setAgentModel(
      config,
      'pas_developer',
      'openrouter/anthropic/claude-sonnet',
      'max',
    );
    writeConfig(modified, path);

    const final = readConfig(path);
    expect(final.agent!.pas_developer.variant).toBe('max');
    expect(final.agent!.pas_developer.model).toBe('openrouter/anthropic/claude-sonnet');
  });

  it('should switch to default (no variant) and remove variant field', () => {
    const path = createTestConfig({
      agent: { pas_developer: { model: 'openrouter/anthropic/claude-sonnet', variant: 'high' } },
    });

    const config = readConfig(path);
    const modified = setAgentModel(
      config,
      'pas_developer',
      'openrouter/anthropic/claude-sonnet',
      'default',
    );
    writeConfig(modified, path);

    const final = readConfig(path);
    expect(final.agent!.pas_developer.model).toBe('openrouter/anthropic/claude-sonnet');
    expect(final.agent!.pas_developer.variant).toBeUndefined();
  });

  it('should preserve variant when setting model without variant', () => {
    const path = createTestConfig({
      agent: { pas_developer: { model: 'old/model', variant: 'high' } },
    });

    const config = readConfig(path);
    // setAgentModel without variant should preserve existing variant
    const modified = setAgentModel(config, 'pas_developer', 'new/model');
    writeConfig(modified, path);

    const final = readConfig(path);
    expect(final.agent!.pas_developer.model).toBe('new/model');
    expect(final.agent!.pas_developer.variant).toBe('high');
  });
});

describe('Setup wizard — PAS agents list', () => {
  it('should include both primary modes and the three PAS workers', () => {
    expect(PAS_AGENTS).toEqual([
      'Pulsar Agent Squad',
      'Pulsar Agent Turbo',
      'pas_researcher',
      'pas_developer',
      'pas_qa',
    ]);
  });
});

describe('Setup wizard — agent model capability guidance', () => {
  it('should classify all PAS workers as light-model agents', () => {
    expect(getModelGuidance('pas_researcher')).toBe('light');
    expect(getModelGuidance('pas_developer')).toBe('light');
    expect(getModelGuidance('pas_qa')).toBe('light');
  });

  it('should classify the PAS Lead as the heavy-model agent', () => {
    expect(getModelGuidance('Pulsar Agent Squad')).toBe('heavy');
    expect(getModelGuidance('Pulsar Agent Turbo')).toBe('heavy');
  });

  it('should return undefined for unknown agents', () => {
    expect(getModelGuidance('unknown-agent')).toBeUndefined();
  });
});

describe('Setup wizard — human-friendly output formatting', () => {
  it('should format agent config output with model and variant', () => {
    expect(formatAgentOutput('pas_developer', 'anthropic/claude-sonnet-4-6', 'high')).toContain(
      'pas_developer',
    );
    expect(formatAgentOutput('pas_developer', 'anthropic/claude-sonnet-4-6', 'high')).toContain(
      'Model: anthropic/claude-sonnet-4-6',
    );
    expect(formatAgentOutput('pas_developer', 'anthropic/claude-sonnet-4-6', 'high')).toContain(
      'Variant: high',
    );
  });

  it('should show default when agent has no explicit model override', () => {
    expect(formatAgentOutput('pas_researcher', undefined)).toContain('Model: default');
  });

  it('should show one Variant line and no reasoning-effort line', () => {
    const output = formatAgentOutput('pas_qa', 'opencode/deepseek-v4-pro');
    expect(output).toContain('Model: opencode/deepseek-v4-pro');
    expect(output).toContain('Variant: default');
    expect(output).not.toContain('Reasoning effort:');
  });
});

// -----------------------------------------------------------------------------
// Wizard loop tests — verify the approved behavior:
//   1. After configuring an agent, return to the main agent list.
//   2. Escape on the main agent list exits cleanly without error.
//   3. Escape on inner steps goes back exactly one step.
//   4. Models are loaded at most once per wizard run (cached).
// -----------------------------------------------------------------------------

const ANTHROPIC_MODEL: Model = {
  id: 'anthropic/claude-sonnet-4-6',
  provider: 'anthropic',
  name: 'claude-sonnet-4-6',
};

const OPENAI_MODEL: Model = {
  id: 'openai/gpt-5',
  provider: 'openai',
  name: 'gpt-5',
};

function silentPrompts(): SetupPrompts {
  // Default: every prompt rejects (should never be called in a passing test).
  const fail = async () => {
    throw new Error('prompt should not be called in this test');
  };
  return {
    selectAgent: fail,
    chooseAction: fail,
    searchModel: fail,
    chooseVariant: fail,
    confirmApply: fail,
  };
}

function emptyConfig(): OpenCodeConfig {
  return {};
}

describe('runSetupWizard — agent loop', () => {
  it('populates registry variants after model discovery and before model search', async () => {
    const events: string[] = [];
    let selectCalls = 0;
    let actionCalls = 0;
    const prompts: SetupPrompts = {
      ...silentPrompts(),
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_qa';
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => {
        actionCalls += 1;
        return actionCalls === 1 ? 'change_model' : 'cancel';
      }) as SetupPrompts['chooseAction'],
      searchModel: (async () => {
        events.push('search');
        throw new AbortPromptError();
      }) as SetupPrompts['searchModel'],
    };
    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => {
        events.push('models');
        return [ANTHROPIC_MODEL];
      },
      populateVariantsFromModelList: async () => {
        events.push('variants');
      },
      discoverVariants: () => [],
      setAgentModel,
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    await runSetupWizard(emptyConfig(), deps);

    expect(events).toEqual(['models', 'variants', 'search']);
  });

  it('FEAT-001 — selecting xhigh variant for Luna persists correctly', async () => {
    const luna: Model = {
      id: 'openai/gpt-5.6-luna',
      provider: 'openai',
      name: 'gpt-5.6-luna',
    };
    let selectCalls = 0;
    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_qa';
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => 'change_model') as SetupPrompts['chooseAction'],
      searchModel: (async () => luna) as SetupPrompts['searchModel'],
      chooseVariant: (async (_modelId, variants) => {
        expect(variants).toContain('xhigh');
        return 'xhigh';
      }) as SetupPrompts['chooseVariant'],
      confirmApply: (async () => true) as SetupPrompts['confirmApply'],
    };
    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [luna],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      setAgentModel,
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    expect(result.finalConfig.agent?.pas_qa).toEqual({
      model: 'openai/gpt-5.6-luna',
      variant: 'xhigh',
    });
  });

  it('should loop back to the agent list after a successful change_model apply', async () => {
    const selectAgent = (async () => {
      // First call returns pas_developer, second call signals outer escape.
      if (!selectAgentCall.consumed) {
        selectAgentCall.consumed = true;
        return 'pas_developer';
      }
      throw new AbortPromptError();
    }) as SetupPrompts['selectAgent'];
    const selectAgentCall = { consumed: false };

    const prompts: SetupPrompts = {
      selectAgent,
      chooseAction: (async () => 'change_model') as SetupPrompts['chooseAction'],
      searchModel: (async () => ANTHROPIC_MODEL) as SetupPrompts['searchModel'],
      chooseVariant: (async () => 'default') as SetupPrompts['chooseVariant'],
      confirmApply: (async () => true) as SetupPrompts['confirmApply'],
    };

    let writes = 0;
    let backups = 0;
    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [ANTHROPIC_MODEL],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => [],
      setAgentModel: (config, agent, model) => {
        return setAgentModel(config, agent, model);
      },
      removeAgentOverride,
      createBackup: () => {
        backups += 1;
        return '/tmp/fake-backup.json';
      },
      writeConfig: () => {
        writes += 1;
      },
      formatOutput: (agent, model, variant) => formatAgentOutput(agent, model, variant),
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(1);
    expect(backups).toBe(1);
    expect(writes).toBe(1);
    expect(result.finalConfig.agent?.pas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('should loop back to the agent list after a successful inherit_default apply', async () => {
    let selectCalls = 0;
    const initialConfig: OpenCodeConfig = {
      agent: { pas_developer: { model: 'old/model' } },
    };

    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_developer';
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => 'inherit_default') as SetupPrompts['chooseAction'],
      searchModel: (async () => ANTHROPIC_MODEL) as SetupPrompts['searchModel'],
      chooseVariant: (async () => 'default') as SetupPrompts['chooseVariant'],
      confirmApply: (async () => true) as SetupPrompts['confirmApply'],
    };

    let writes = 0;
    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => [],
      setAgentModel: (config, agent, model) => setAgentModel(config, agent, model),
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {
        writes += 1;
      },
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(initialConfig, deps);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(1);
    expect(writes).toBe(1);
    expect(result.finalConfig.agent?.pas_developer).toBeUndefined();
  });

  it('should exit cleanly on outer escape without logging an error', async () => {
    const errorLines: string[] = [];
    const outputLines: string[] = [];

    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => 'cancel') as SetupPrompts['chooseAction'],
      searchModel: (async () => ANTHROPIC_MODEL) as SetupPrompts['searchModel'],
      chooseVariant: (async () => 'default') as SetupPrompts['chooseVariant'],
      confirmApply: (async () => true) as SetupPrompts['confirmApply'],
    };

    let onEscapeCalled = false;
    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => [],
      setAgentModel: (config, agent, model) => setAgentModel(config, agent, model),
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: (line) => outputLines.push(line),
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {
        onEscapeCalled = true;
      },
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(0);
    expect(onEscapeCalled).toBe(true);
    // Outer escape must NOT log anything to error/output that looks like a failure.
    expect(errorLines).toHaveLength(0);
    expect(outputLines.filter((l) => /error/i.test(l))).toHaveLength(0);
  });

  it('should go back to the agent list when inner action step escapes', async () => {
    let selectCalls = 0;
    let chooseActionCalls = 0;

    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_developer';
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => {
        chooseActionCalls += 1;
        // First call: inner escape. Second call: would never run — escape
        // is supposed to put us back at the agent list.
        throw new AbortPromptError();
      }) as SetupPrompts['chooseAction'],
      searchModel: (async () => ANTHROPIC_MODEL) as SetupPrompts['searchModel'],
      chooseVariant: (async () => 'default') as SetupPrompts['chooseVariant'],
      confirmApply: (async () => true) as SetupPrompts['confirmApply'],
    };

    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => [],
      setAgentModel: (config, agent, model) => setAgentModel(config, agent, model),
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    // Inner escape at action step → back to agent list. Outer escape at
    // second selectAgent → exit cleanly.
    expect(result.exitReason).toBe('outer_escape');
    expect(selectCalls).toBe(2);
    expect(chooseActionCalls).toBe(1);
    expect(result.appliedChanges).toBe(0);
  });

  it('should go back exactly one step when inner model-search step escapes', async () => {
    let selectCalls = 0;
    let chooseActionCalls = 0;
    let searchCalls = 0;

    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_developer';
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => {
        chooseActionCalls += 1;
        return 'change_model';
      }) as SetupPrompts['chooseAction'],
      searchModel: (async () => {
        searchCalls += 1;
        // First call: inner escape at model-search → back to chooseAction.
        // Second call: would be called after loop back.
        if (searchCalls === 1) throw new AbortPromptError();
        return OPENAI_MODEL;
      }) as SetupPrompts['searchModel'],
      chooseVariant: (async () => 'default') as SetupPrompts['chooseVariant'],
      confirmApply: (async () => true) as SetupPrompts['confirmApply'],
    };

    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [ANTHROPIC_MODEL, OPENAI_MODEL],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => [],
      setAgentModel: (config, agent, model) => setAgentModel(config, agent, model),
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    // Escape at model-search → back to chooseAction (one step back).
    // Second time through, we pick change_model again → search again → confirm=false.
    // Then second outer escape at selectAgent → exit.
    expect(result.exitReason).toBe('outer_escape');
    expect(selectCalls).toBe(2);
    expect(chooseActionCalls).toBeGreaterThanOrEqual(2);
    expect(searchCalls).toBeGreaterThanOrEqual(1);
  });

  it('should not swallow genuine (non-abort) errors', async () => {
    const prompts: SetupPrompts = {
      ...silentPrompts(),
      selectAgent: (async () => 'pas_developer') as SetupPrompts['selectAgent'],
      chooseAction: (async () => {
        throw new Error('boom: real failure');
      }) as SetupPrompts['chooseAction'],
    };

    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => [],
      setAgentModel: (config, agent, model) => setAgentModel(config, agent, model),
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    await expect(runSetupWizard(emptyConfig(), deps)).rejects.toThrow(/boom/);
  });

  it('should reuse cached models across multiple agent configurations in the same run', async () => {
    let selectCalls = 0;
    let discoverCalls = 0;
    let lastChosenModel: Model | null = null;

    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_developer';
        if (selectCalls === 2) return 'pas_qa';
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => 'change_model') as SetupPrompts['chooseAction'],
      searchModel: (async (models: Model[]) => {
        return models[0] ?? ANTHROPIC_MODEL;
      }) as SetupPrompts['searchModel'],
      chooseVariant: (async () => 'default') as SetupPrompts['chooseVariant'],
      confirmApply: (async () => true) as SetupPrompts['confirmApply'],
    };

    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => {
        discoverCalls += 1;
        return [ANTHROPIC_MODEL, OPENAI_MODEL];
      },
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => [],
      setAgentModel: (config, agent, model) => {
        lastChosenModel = model as Model;
        return setAgentModel(config, agent, model);
      },
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(2);
    expect(result.finalConfig.agent?.pas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
    expect(result.finalConfig.agent?.pas_qa?.model).toBe('anthropic/claude-sonnet-4-6');
  });
});

describe('runSetupWizard — escape paths (approved drift-fix contract)', () => {
  it('should return to the main agent list when the action step Cancel option is chosen', async () => {
    // New approved contract: choosing "Cancel" on the action step loops
    // back to the agent list — it does NOT exit the wizard. The wizard
    // should only exit when Escape is pressed on the main agent list.
    let selectCalls = 0;
    let chooseActionCalls = 0;

    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_developer';
        if (selectCalls === 2) return 'pas_qa';
        // Third select call → outer escape, exit cleanly.
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => {
        chooseActionCalls += 1;
        if (chooseActionCalls === 1) return 'cancel';
        return 'change_model';
      }) as SetupPrompts['chooseAction'],
      searchModel: (async () => ANTHROPIC_MODEL) as SetupPrompts['searchModel'],
      chooseVariant: (async () => 'default') as SetupPrompts['chooseVariant'],
      confirmApply: (async () => true) as SetupPrompts['confirmApply'],
    };

    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [ANTHROPIC_MODEL],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => [],
      setAgentModel: (config, agent, model) => setAgentModel(config, agent, model),
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(1);
    // Cancel at action step loops back to selectAgent, so selectAgent was
    // called twice before the outer escape.
    expect(selectCalls).toBe(3);
    expect(chooseActionCalls).toBe(2);
    // pas_qa got configured on the second iteration; pas_developer was never
    // touched because Cancel did not apply anything for it.
    expect(result.finalConfig.agent?.pas_developer).toBeUndefined();
    expect(result.finalConfig.agent?.pas_qa?.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('should go back exactly one step when inner variant step escapes', async () => {
    // Escape at variant step must return to the model search step (not
    // action step). The second time through, pick a different model and
    // confirm — wizard should loop back to agent list.
    let selectCalls = 0;
    let chooseActionCalls = 0;
    let searchCalls = 0;
    let variantCalls = 0;

    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_developer';
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => {
        chooseActionCalls += 1;
        return 'change_model';
      }) as SetupPrompts['chooseAction'],
      searchModel: (async () => {
        searchCalls += 1;
        // Return whichever model the test runner is asking for via state.
        return searchCalls === 1 ? ANTHROPIC_MODEL : OPENAI_MODEL;
      }) as SetupPrompts['searchModel'],
      chooseVariant: (async () => {
        variantCalls += 1;
        // First time: escape at variant step (back to search).
        if (variantCalls === 1) throw new AbortPromptError();
        return 'default';
      }) as SetupPrompts['chooseVariant'],
      confirmApply: (async () => true) as SetupPrompts['confirmApply'],
    };

    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [ANTHROPIC_MODEL, OPENAI_MODEL],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => ['high', 'max'],
      setAgentModel: (config, agent, model) => setAgentModel(config, agent, model),
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    // First iteration: change_model → search(anthropic) → variant(escape)
    //   → back to search → search(openai) → variant(default) → confirm →
    //   apply → loop back to agent list → outer escape exits.
    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(1);
    expect(selectCalls).toBe(2);
    expect(chooseActionCalls).toBe(1);
    expect(searchCalls).toBe(2);
    expect(variantCalls).toBe(2);
    expect(result.finalConfig.agent?.pas_developer?.model).toBe('openai/gpt-5');
  });

  it('should go back exactly one step when confirm step with variant escapes', async () => {
    // Escape at confirm step (with a picked variant) must return to the
    // variant step (not action step).
    let selectCalls = 0;
    let chooseActionCalls = 0;
    let searchCalls = 0;
    let variantCalls = 0;
    let confirmCalls = 0;

    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_developer';
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => {
        chooseActionCalls += 1;
        return 'change_model';
      }) as SetupPrompts['chooseAction'],
      searchModel: (async () => {
        searchCalls += 1;
        return ANTHROPIC_MODEL;
      }) as SetupPrompts['searchModel'],
      chooseVariant: (async () => {
        variantCalls += 1;
        if (variantCalls === 1) return 'high';
        return 'max';
      }) as SetupPrompts['chooseVariant'],
      confirmApply: (async () => {
        confirmCalls += 1;
        // First confirm: escape → back to variant step.
        if (confirmCalls === 1) throw new AbortPromptError();
        return true;
      }) as SetupPrompts['confirmApply'],
    };

    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [ANTHROPIC_MODEL],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => ['high', 'max'],
      setAgentModel: (config, agent, model, variant) =>
        setAgentModel(config, agent, model, variant),
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(1);
    expect(selectCalls).toBe(2);
    expect(chooseActionCalls).toBe(1);
    expect(searchCalls).toBe(1);
    // First confirm escaped → back to variant. Second variant pick 'max' →
    // confirm again → apply.
    expect(variantCalls).toBe(2);
    expect(confirmCalls).toBe(2);
    expect(result.finalConfig.agent?.pas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
    expect(result.finalConfig.agent?.pas_developer?.variant).toBe('max');
  });

  it('should go back exactly one step when confirm step without variant escapes', async () => {
    // Escape at confirm step (no variants available) must return to the
    // model search step (not action step).
    let selectCalls = 0;
    let chooseActionCalls = 0;
    let searchCalls = 0;
    let confirmCalls = 0;

    const prompts: SetupPrompts = {
      selectAgent: (async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_developer';
        throw new AbortPromptError();
      }) as SetupPrompts['selectAgent'],
      chooseAction: (async () => {
        chooseActionCalls += 1;
        return 'change_model';
      }) as SetupPrompts['chooseAction'],
      searchModel: (async () => {
        searchCalls += 1;
        return searchCalls === 1 ? ANTHROPIC_MODEL : OPENAI_MODEL;
      }) as SetupPrompts['searchModel'],
      chooseVariant: (async () => 'default') as SetupPrompts['chooseVariant'],
      confirmApply: (async () => {
        confirmCalls += 1;
        // First confirm: escape → back to search step.
        if (confirmCalls === 1) throw new AbortPromptError();
        return true;
      }) as SetupPrompts['confirmApply'],
    };

    const deps: SetupWizardDeps = {
      prompts,
      discoverModels: async () => [ANTHROPIC_MODEL, OPENAI_MODEL],
      populateVariantsFromModelList: async () => {},
      discoverVariants: () => [], // no variants → no variant step
      setAgentModel: (config, agent, model) => setAgentModel(config, agent, model),
      removeAgentOverride,
      createBackup: () => '',
      writeConfig: () => {},
      formatOutput: formatAgentOutput,
      output: () => {},
      isAbortPromptError: (err) => err instanceof AbortPromptError,
      onEscapeExit: () => {},
    };

    const result = await runSetupWizard(emptyConfig(), deps);

    expect(result.exitReason).toBe('outer_escape');
    expect(result.appliedChanges).toBe(1);
    expect(selectCalls).toBe(2);
    expect(chooseActionCalls).toBe(1);
    // First confirm escaped → back to search. Second search pick openai →
    // confirm true → apply.
    expect(searchCalls).toBe(2);
    expect(confirmCalls).toBe(2);
    expect(result.finalConfig.agent?.pas_developer?.model).toBe('openai/gpt-5');
  });
});

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
