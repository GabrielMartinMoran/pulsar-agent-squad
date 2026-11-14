/**
 * Unit tests for the setup target adapter seam.
 *
 * Contract:
 *   - Only tools with a setup adapter are offered. File-copy-only manifest
 *     targets do not appear.
 *   - An unsupported target is rejected before any config read.
 *   - The OpenCode adapter keeps today's persistence contract: it delegates
 *     to config-safety and preserves `agent.<name>.model`, the optional
 *     `variant`, and the restart hint.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getSetupTarget,
  supportedTargetIds,
  resolveSetupTarget,
  unsupportedTargetMessage,
} from '../../src/cli/commands/agents/targets/adapter';
import { resolveSetupAdapter } from '../../src/cli/commands/agents/setup';
import { opencodeAdapter, formatAgentOutput } from '../../src/cli/commands/agents/targets/opencode';
import {
  piAdapter,
  PI_AGENTS,
  PI_THINKING_LEVELS,
  formatPiOutput,
} from '../../src/cli/commands/agents/targets/pi';
import { PAS_AGENTS, getModelGuidanceLabel } from '../../src/cli/commands/agents/presenter';

let home: string;
let previousHome: string | undefined;
let previousUserProfile: string | undefined;

beforeEach(() => {
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  home = mkdtempSync(join(tmpdir(), 'pas-setup-targets-'));
  process.env.HOME = home;
  delete process.env.USERPROFILE;
});

afterEach(() => {
  process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  rmSync(home, { recursive: true, force: true });
});

function opencodeConfigPath(): string {
  const dir = join(home, '.config', 'opencode');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'opencode.json');
}

describe('setup target registry', () => {
  it('@unit Only targets with a setup adapter are offered', () => {
    // Exactly two adapters today: OpenCode and Pi.
    expect(supportedTargetIds()).toEqual(['opencode', 'pi']);
    expect(getSetupTarget('opencode')).toBe(opencodeAdapter);
    expect(getSetupTarget('pi')).toBe(piAdapter);

    // File-copy-only manifest targets must not be offered.
    for (const fileCopyOnly of ['cursor', 'codex', 'claude', 'gemini']) {
      expect(getSetupTarget(fileCopyOnly)).toBeUndefined();
    }
  });

  it('@unit An unsupported target is rejected before any interaction', () => {
    // A malformed config on disk must not be reached: resolution fails first.
    writeFileSync(opencodeConfigPath(), '{ this is not json');

    expect(() => resolveSetupTarget('cursor')).toThrow(/Unsupported target/);
    expect(() => resolveSetupTarget('cursor')).toThrow(/cursor/);
    expect(() => resolveSetupTarget('cursor')).toThrow(/opencode/);
    expect(() => resolveSetupTarget('cursor')).toThrow(/pi/);
    expect(unsupportedTargetMessage('cursor')).toContain('opencode');
    expect(unsupportedTargetMessage('cursor')).toContain('pi');
  });

  it('resolves opencode when the id is supported', () => {
    expect(resolveSetupTarget('opencode')).toBe(opencodeAdapter);
  });

  it('resolves pi when the id is supported', () => {
    expect(resolveSetupTarget('pi')).toBe(piAdapter);
  });
});

describe('setup target resolution', () => {
  function recordingRegistry(resolved: string[]) {
    return {
      resolve(id: string) {
        resolved.push(id);
        return resolveSetupTarget(id);
      },
    };
  }

  it('@unit An explicit target skips the selection prompt', async () => {
    let selectCalls = 0;
    const resolved: string[] = [];

    const adapter = await resolveSetupAdapter({
      target: 'pi',
      prompts: {
        selectTarget: async () => {
          selectCalls += 1;
          return 'opencode';
        },
      },
      registry: recordingRegistry(resolved),
    });

    expect(selectCalls).toBe(0);
    expect(adapter).toBe(piAdapter);
    expect(resolved).toEqual(['pi']);
  });

  it('@unit Omitting the target prompts exactly once and configures the named target', async () => {
    let selectCalls = 0;
    const resolved: string[] = [];

    const adapter = await resolveSetupAdapter({
      prompts: {
        selectTarget: async () => {
          selectCalls += 1;
          return 'pi';
        },
      },
      registry: recordingRegistry(resolved),
    });

    expect(selectCalls).toBe(1);
    expect(adapter).toBe(piAdapter);
    expect(resolved).toEqual(['pi']);
  });
});

describe('opencode target adapter', () => {
  it('@unit OpenCode setup keeps its persistence contract', () => {
    const path = opencodeConfigPath();
    writeFileSync(path, JSON.stringify({ default_agent: 'pas_developer' }, null, 2));

    // readConfig fails fast on malformed JSON before any prompt.
    const config = opencodeAdapter.readConfig();

    const withModel = opencodeAdapter.setAgentModel(
      config,
      'pas_developer',
      'openrouter/anthropic/claude-sonnet',
      'high',
    );
    const backup = opencodeAdapter.createBackup();
    opencodeAdapter.writeConfig(withModel);

    const reread = opencodeAdapter.readConfig();
    expect(reread.agent?.pas_developer).toEqual({
      model: 'openrouter/anthropic/claude-sonnet',
      variant: 'high',
    });
    expect(backup).toMatch(/\.bak\.\d{14}$/);

    // Inheriting the default removes only that override.
    const removed = opencodeAdapter.removeAgentOverride(reread, 'pas_developer');
    expect(removed.agent).toBeUndefined();

    // Restart hint and capability metadata stay exactly as today.
    expect(opencodeAdapter.reloadHint).toBe('Restart OpenCode for changes to take effect.');
    expect(opencodeAdapter.supportsVariants).toBe(true);

    // Roster is the existing five OpenCode agents, with identical guidance.
    expect(opencodeAdapter.agents.map((a) => a.name)).toEqual([...PAS_AGENTS]);
    for (const agent of opencodeAdapter.agents) {
      expect(agent.guidance).toBe(getModelGuidanceLabel(agent.name));
    }
  });

  it('formats the same preview as the legacy helper', () => {
    expect(opencodeAdapter.formatOutput('pas_developer', 'model/x', 'high')).toBe(
      formatAgentOutput('pas_developer', 'model/x', 'high'),
    );
    expect(formatAgentOutput('pas_qa', undefined)).toContain('Model: default');
  });
});

describe('pi target adapter', () => {
  it('@unit Pi roster offers the three worker subagents only', () => {
    expect(piAdapter.id).toBe('pi');
    expect(piAdapter.label).toBe('Pi');
    expect(piAdapter.agents.map((a) => a.name)).toEqual([
      'pas_researcher',
      'pas_developer',
      'pas_qa',
    ]);
    expect(PI_AGENTS.map((a) => a.name)).toEqual(['pas_researcher', 'pas_developer', 'pas_qa']);
    for (const agent of piAdapter.agents) {
      expect(agent.guidance).toBe('lighter model sufficient');
    }

    // Pi lead skills are not model targets.
    const names = piAdapter.agents.map((a) => a.name);
    expect(names).not.toContain('Pulsar Agent Squad');
    expect(names).not.toContain('Pulsar Agent Turbo');
  });

  it('@unit exposes Pi thinking metadata and no variants', () => {
    expect(piAdapter.supportsVariants).toBe(false);
    expect(piAdapter.supportsThinking).toBe(true);
    expect(piAdapter.thinkingLevels).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(PI_THINKING_LEVELS).toEqual(piAdapter.thinkingLevels as string[]);
    expect(piAdapter.reloadHint).toBe('Run /reload in Pi for changes to take effect.');
    expect(piAdapter.noModelsHint).toMatch(/pi --list-models/);
    expect(piAdapter.noModelsHint).toMatch(/manually/);
  });

  it('@unit Pi setup writes a per-subagent override with provider and thinking', () => {
    const agentDir = join(home, '.pi', 'agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ deviceId: 'dev-1' }, null, 2));

    const config = piAdapter.readConfig();
    const withModel = piAdapter.setAgentModel(
      config,
      'pas_researcher',
      '~deepseek/deepseek-flash-latest',
      'openrouter',
      'high',
    );
    piAdapter.createBackup();
    piAdapter.writeConfig(withModel);

    const reread = piAdapter.readConfig();
    expect((reread.subagents as any).agentOverrides.pas_researcher).toEqual({
      model: '~deepseek/deepseek-flash-latest',
      defaultProvider: 'openrouter',
      thinking: 'high',
    });
    expect(reread.deviceId).toBe('dev-1');
    expect(
      readdirSync(agentDir).some((name) => name.startsWith('settings.json.bak.')),
    ).toBe(true);
  });

  it('@unit Pi setup refuses a missing agent directory', () => {
    expect(() => piAdapter.readConfig()).toThrow(/Pi agent directory/);
  });

  it('formats the Pi preview with agent, model, provider and thinking', () => {
    const preview = formatPiOutput('pas_qa', 'gemini-2.5-pro', undefined, 'high', 'google');
    expect(preview).toContain('Agent: pas_qa');
    expect(preview).toContain('Model: gemini-2.5-pro');
    expect(preview).toContain('Provider: google');
    expect(preview).toContain('Thinking: high');
    expect(piAdapter.formatOutput('pas_qa', 'm', undefined, 'low', 'p')).toBe(
      formatPiOutput('pas_qa', 'm', undefined, 'low', 'p'),
    );
  });
});
