/**
 * Integration tests for the Pi setup path.
 *
 * The wizard is exercised with the real Pi adapter and real `pi-settings`
 * persistence against a temporary HOME. `pi` is a stub binary whose output is
 * controlled by an explicitly injected environment (never by mutating the
 * process PATH), and inquirer prompts are supplied directly to the wizard.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { AbortPromptError } from '@inquirer/core';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { piAdapter } from '../../src/cli/commands/agents/targets/pi';
import {
  runSetupWizard,
  isAbortPromptError,
  type SetupWizardDeps,
} from '../../src/cli/commands/agents/setup-core';
import type { Model } from '../../src/cli/lib/model-discovery';

let tempHome: string;
let tempBin: string;
let previousHome: string | undefined;
let realHome: string | undefined;
let realSettingsBefore: string | undefined;

beforeEach(() => {
  previousHome = process.env.HOME;
  realHome = previousHome;
  realSettingsBefore =
    realHome && existsSync(join(realHome, '.pi', 'agent', 'settings.json'))
      ? readFileSync(join(realHome, '.pi', 'agent', 'settings.json'), 'utf-8')
      : undefined;

  tempHome = mkdtempSync(join(tmpdir(), 'pas-setup-pi-home-'));
  tempBin = mkdtempSync(join(tmpdir(), 'pas-setup-pi-bin-'));
  mkdirSync(join(tempHome, '.pi', 'agent'), { recursive: true });
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  for (const dir of [tempHome, tempBin]) {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }
});

/** Explicit child environment: temp stub first, then the real PATH for sh/cat. */
function injectedEnv(): Record<string, string | undefined> {
  return { ...process.env, PATH: `${tempBin}:${process.env.PATH ?? ''}` };
}

function writePiStub(body: string): void {
  const stub = join(tempBin, 'pi');
  writeFileSync(stub, `#!/bin/sh\n${body}\n`);
  chmodSync(stub, 0o755);
}

function writeFixturePiStub(): void {
  const fixture = join(import.meta.dir, '..', 'fixtures', 'pi-list-models.txt');
  writePiStub(
    [
      'case "$1" in',
      '  --version) echo "1.4.0"; exit 0;;',
      `  --list-models) cat "${fixture}"; exit 0;;`,
      'esac',
      'exit 1',
    ].join('\n'),
  );
}

/**
 * Stub whose `install` subcommand records its argv to a log file (and can
 * simulate `pi install` rewriting settings.json). `list` reports the supplied
 * packages so prepare can compute the missing set.
 */
function writePluginStub(opts: {
  version: string;
  installed: string[];
  rewriteSettings?: boolean;
}): string {
  const log = join(tempBin, 'pi-argv.log');
  const fixture = join(import.meta.dir, '..', 'fixtures', 'pi-list-models.txt');
  const listed = ['User packages:', ...opts.installed.map((pkg) => `  ${pkg}`)]
    .map((line) => `'${line.replace(/'/g, `'\\''`)}'`)
    .join(' ');
  const rewrite = opts.rewriteSettings
    ? `    printf '%s\\n' '{"deviceId":"dev-1","installedByStub":true}' > "$HOME/.pi/agent/settings.json"`
    : undefined;

  writePiStub(
    [
      'case "$1" in',
      `  --version) echo "${opts.version}"; exit 0;;`,
      `  --list-models) cat "${fixture}"; exit 0;;`,
      '  list)',
      `    printf '%s\\n' ${listed}`,
      '    exit 0;;',
      '  install)',
      `    printf '%s\\n' "$*" >> "${log}"`,
      ...(rewrite ? [rewrite] : []),
      '    exit 0;;',
      'esac',
      'exit 1',
    ].join('\n'),
  );

  return log;
}

function settingsPath(): string {
  return join(tempHome, '.pi', 'agent', 'settings.json');
}

function backups(): string[] {
  return readdirSync(join(tempHome, '.pi', 'agent')).filter((name) =>
    name.startsWith('settings.json.bak.'),
  );
}

/** Wizard deps pointing at the real Pi adapter with the injected env. */
function piDeps(env: Record<string, string | undefined>, prompts: Record<string, unknown>) {
  return {
    prompts,
    discoverModels: () => piAdapter.discoverModels(env),
    populateVariantsFromModelList: () => piAdapter.populateVariants(),
    discoverVariants: (modelId: string) => piAdapter.discoverVariants(modelId),
    modelSupportsThinking: (model: Model) => piAdapter.modelSupportsThinking?.(model) === true,
    setAgentModel: (
      config: Parameters<typeof piAdapter.setAgentModel>[0],
      agent: string,
      model: string,
      _variant?: string,
      thinking?: string,
      provider?: string,
    ) => piAdapter.setAgentModel(config, agent, model, provider, thinking),
    removeAgentOverride: (config: Parameters<typeof piAdapter.removeAgentOverride>[0], agent: string) =>
      piAdapter.removeAgentOverride(config, agent),
    createBackup: () => piAdapter.createBackup(),
    writeConfig: (config: Parameters<typeof piAdapter.writeConfig>[0]) =>
      piAdapter.writeConfig(config),
    formatOutput: (agentName: string, modelId?: string, variant?: string, thinking?: string, provider?: string) =>
      piAdapter.formatOutput(agentName, modelId, variant, thinking, provider),
    reloadHint: piAdapter.reloadHint,
    noModelsHint: piAdapter.noModelsHint,
    supportsVariants: piAdapter.supportsVariants,
    supportsThinking: piAdapter.supportsThinking === true,
    thinkingLevels: piAdapter.thinkingLevels ?? [],
    supportsManualModelInput: piAdapter.supportsManualModelInput === true,
    output: (line: string) => outputs.push(line),
    isAbortPromptError,
    onEscapeExit: () => {},
  };
}

let outputs: string[] = [];
beforeEach(() => {
  outputs = [];
});

describe('Pi setup — end to end', () => {
  it('@integration writes model, provider and thinking, backs up, prints the reload hint, and leaves the real home untouched', async () => {
    writeFixturePiStub();
    writeFileSync(settingsPath(), JSON.stringify({ deviceId: 'dev-1' }, null, 2) + '\n');
    const env = injectedEnv();
    piAdapter.preflight(env);

    const config = piAdapter.readConfig();
    let selectCalls = 0;
    const prompts = {
      selectAgent: async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_researcher';
        throw new AbortPromptError();
      },
      chooseAction: async () => 'change_model',
      searchModel: async (models: Model[]) => models.find((m) => m.id === 'chat-latest') ?? models[0],
      chooseVariant: async () => 'default',
      selectThinking: async () => 'high',
      confirmApply: async () => true,
    };

    const result = await runSetupWizard(config as never, piDeps(env, prompts) as never);

    expect(result.appliedChanges).toBe(1);
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf-8'));
    expect(settings.deviceId).toBe('dev-1');
    expect(settings.subagents.agentOverrides.pas_researcher).toEqual({
      model: 'chat-latest',
      defaultProvider: 'openai',
      thinking: 'high',
    });

    expect(backups()).toHaveLength(1);
    expect(readFileSync(join(tempHome, '.pi', 'agent', backups()[0]), 'utf-8')).toContain(
      '"deviceId": "dev-1"',
    );
    expect(outputs).toContain('Run /reload in Pi for changes to take effect.');

    // The real home is untouched.
    if (realHome) {
      expect(settingsPath().startsWith(realHome)).toBe(false);
      const realSettingsAfter = existsSync(join(realHome, '.pi', 'agent', 'settings.json'))
        ? readFileSync(join(realHome, '.pi', 'agent', 'settings.json'), 'utf-8')
        : undefined;
      expect(realSettingsAfter).toBe(realSettingsBefore);
    }
  });

  it('@integration fails before any write when the pi binary is missing', () => {
    const emptyBin = mkdtempSync(join(tmpdir(), 'pas-setup-pi-nobin-'));
    const env = { ...process.env, PATH: emptyBin };

    try {
      // The explicit env hides the real `pi`; preflight runs before read/write.
      expect(() => piAdapter.preflight(env)).toThrow(/Pi binary not found/);
      expect(existsSync(settingsPath())).toBe(false);
    } finally {
      rmSync(emptyBin, { recursive: true, force: true });
    }
  });

  it('@integration fails before any prompt when Pi settings are malformed', () => {
    writeFileSync(settingsPath(), '{ "subagents": ');

    expect(() => piAdapter.readConfig()).toThrow(/Malformed JSON/);
    expect(backups()).toHaveLength(0);
  });

  it('@integration installs each missing configured package once and never removes unconfigured ones', async () => {
    const log = writePluginStub({
      version: '1.4.0',
      installed: ['npm:pi-subagents', 'npm:pi-workspace-history'],
    });
    const env = injectedEnv();

    const summary = await piAdapter.prepare!({
      env,
      confirm: async () => true,
    });

    const lines = readFileSync(log, 'utf-8').trim().split('\n');
    expect(lines).toEqual([
      'install npm:pi-web-access',
      'install npm:@juicesharp/rpiv-ask-user-question',
      'install npm:@juicesharp/rpiv-todo',
    ]);
    expect(summary).toContain('Installing package: pi install npm:pi-web-access');
    expect(summary).toContain(
      'Installing package: pi install npm:@juicesharp/rpiv-ask-user-question',
    );
    expect(summary).toContain('Installing package: pi install npm:@juicesharp/rpiv-todo');

    // Configured and already installed: skipped.
    expect(lines).not.toContain('install npm:pi-subagents');
    // Installed outside config/pi-packages.txt: untouched, never removed.
    expect(lines.join('\n')).not.toContain('npm:pi-workspace-history');
    expect(lines.some((line) => line.startsWith('remove'))).toBe(false);
  });

  it('@integration asks once and continues without installing on decline', async () => {
    const log = writePluginStub({
      version: '1.4.0',
      installed: ['npm:pi-workspace-history'],
    });
    const env = injectedEnv();
    let confirmCalls = 0;

    const summary = await piAdapter.prepare!({
      env,
      confirm: async (message) => {
        confirmCalls += 1;
        expect(message).toContain('Install missing Pi packages now?');
        return false;
      },
    });

    expect(confirmCalls).toBe(1);
    expect(existsSync(log)).toBe(false);
    expect(summary).toContain('Skipped installing missing Pi packages');
  });

  it('@integration gates pi-subagents behind Pi >= 1.2.0 and installs the rest', async () => {
    const log = writePluginStub({
      version: '1.1.0',
      installed: ['npm:pi-workspace-history'],
    });
    const env = injectedEnv();

    const summary = await piAdapter.prepare!({
      env,
      confirm: async () => true,
    });

    expect(summary).toContain('1.2.0');
    expect(summary).toContain('pi-subagents');
    const lines = readFileSync(log, 'utf-8').trim().split('\n');
    expect(lines).not.toContain('install npm:pi-subagents');
    expect(lines).toEqual([
      'install npm:pi-web-access',
      'install npm:@juicesharp/rpiv-ask-user-question',
      'install npm:@juicesharp/rpiv-todo',
    ]);
  });

  it('@integration re-reads settings after install so the merge starts from the post-install file', async () => {
    const log = writePluginStub({
      version: '1.4.0',
      installed: ['npm:pi-subagents', 'npm:pi-workspace-history'],
      rewriteSettings: true,
    });
    writeFileSync(settingsPath(), JSON.stringify({ deviceId: 'dev-1' }, null, 2) + '\n');
    const env = injectedEnv();

    const initialConfig = piAdapter.readConfig();
    let selectCalls = 0;
    const prompts = {
      selectAgent: async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_researcher';
        throw new AbortPromptError();
      },
      chooseAction: async () => 'change_model',
      searchModel: async (models: Model[]) =>
        models.find((m) => m.id === 'chat-latest') ?? models[0],
      chooseVariant: async () => 'default',
      selectThinking: async () => 'high',
      confirmApply: async () => true,
    };

    const deps: SetupWizardDeps = {
      ...(piDeps(env, prompts) as SetupWizardDeps),
      prepare: () => piAdapter.prepare!({ env, confirm: async () => true }),
      reloadConfig: () => piAdapter.readConfig(),
    };

    const result = await runSetupWizard(initialConfig as never, deps as never);

    expect(result.appliedChanges).toBe(1);
    expect(readFileSync(log, 'utf-8')).toContain('install npm:pi-web-access');
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf-8'));
    // Written by the stub `pi install`, so it only survives because setup
    // re-read settings after installing and before merging the model.
    expect(settings.installedByStub).toBe(true);
    expect(settings.subagents.agentOverrides.pas_researcher).toEqual({
      model: 'chat-latest',
      defaultProvider: 'openai',
      thinking: 'high',
    });
  });

  it('@integration falls back to manual model entry when discovery is empty', async () => {
    writePiStub('[ "$1" = "--version" ] && { echo 1.4.0; exit 0; }\nexit 0');
    const env = injectedEnv();
    piAdapter.preflight(env);

    const config = piAdapter.readConfig();
    let selectCalls = 0;
    let inputCalls = 0;
    const prompts = {
      selectAgent: async () => {
        selectCalls += 1;
        if (selectCalls === 1) return 'pas_developer';
        throw new AbortPromptError();
      },
      chooseAction: async () => 'change_model',
      searchModel: async () => {
        throw new Error('search should not run when discovery is empty');
      },
      chooseVariant: async () => 'default',
      inputModel: async () => {
        inputCalls += 1;
        return 'manual/model';
      },
      confirmApply: async () => true,
    };

    const result = await runSetupWizard(config as never, piDeps(env, prompts) as never);

    expect(inputCalls).toBe(1);
    expect(result.appliedChanges).toBe(1);
    const settings = JSON.parse(readFileSync(settingsPath(), 'utf-8'));
    expect(settings.subagents.agentOverrides.pas_developer).toEqual({ model: 'manual/model' });
  });
});
