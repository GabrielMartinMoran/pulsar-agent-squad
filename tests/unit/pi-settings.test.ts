import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  defaultPiSettingsPath,
  piAgentDirExists,
  readPiSettings,
  removeAgentOverride,
  serializePiSettings,
  setAgentOverride,
  writePiSettings,
  PiSettingsError,
  type PiSettings,
} from '../../src/cli/commands/agents/targets/pi-settings';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pas-pi-settings-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
});

describe('defaultPiSettingsPath', () => {
  it('builds <home>/.pi/agent/settings.json without hardcoding ~', () => {
    expect(defaultPiSettingsPath('/home/alice')).toBe('/home/alice/.pi/agent/settings.json');
  });
});

describe('piAgentDirExists', () => {
  it('is true only when <home>/.pi/agent is a directory', () => {
    const home = tempRoot();
    expect(piAgentDirExists(home)).toBe(false);
    mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
    expect(piAgentDirExists(home)).toBe(true);
  });

  it('is false when <home>/.pi/agent is a file', () => {
    const home = tempRoot();
    mkdirSync(join(home, '.pi'), { recursive: true });
    writeFileSync(join(home, '.pi', 'agent'), 'not a directory');
    expect(piAgentDirExists(home)).toBe(false);
  });
});

describe('readPiSettings', () => {
  it('returns {} when the settings file is missing', () => {
    expect(readPiSettings(join(tempRoot(), 'missing.json'))).toEqual({});
  });

  it('parses an existing settings file', () => {
    const path = join(tempRoot(), 'settings.json');
    writeFileSync(path, JSON.stringify({ defaultProvider: 'openrouter' }));
    expect(readPiSettings(path)).toEqual({ defaultProvider: 'openrouter' });
  });

  it('throws PiSettingsError including the path and parse reason for malformed JSON', () => {
    const path = join(tempRoot(), 'settings.json');
    writeFileSync(path, '{ "subagents": ');
    let error: unknown;
    try {
      readPiSettings(path);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PiSettingsError);
    const message = (error as Error).message;
    expect(message).toContain(path);
    expect(message.toLowerCase()).toContain('json');
  });
});

describe('setAgentOverride', () => {
  it('writes a per-subagent override when no subagents key exists', () => {
    const settings: PiSettings = { defaultProvider: 'openrouter', deviceId: 'abc' };
    const result = setAgentOverride(settings, 'pas_developer', {
      model: '~deepseek/deepseek-flash-latest',
      defaultProvider: 'openrouter',
      thinking: 'high',
    });

    expect(result).toEqual({
      defaultProvider: 'openrouter',
      deviceId: 'abc',
      subagents: {
        agentOverrides: {
          pas_developer: {
            model: '~deepseek/deepseek-flash-latest',
            defaultProvider: 'openrouter',
            thinking: 'high',
          },
        },
      },
    });
    expect(settings).toEqual({ defaultProvider: 'openrouter', deviceId: 'abc' });
  });

  it('merges into an existing override without dropping unknown fields', () => {
    const settings: PiSettings = {
      subagents: {
        agentOverrides: {
          pas_developer: { model: 'old/model', custom: { keep: true } },
          pas_qa: { model: 'qa/model' },
        },
      },
    };
    const result = setAgentOverride(settings, 'pas_developer', {
      model: 'new/model',
      defaultProvider: 'openrouter',
    });

    expect(result).toEqual({
      subagents: {
        agentOverrides: {
          pas_developer: {
            model: 'new/model',
            defaultProvider: 'openrouter',
            custom: { keep: true },
          },
          pas_qa: { model: 'qa/model' },
        },
      },
    });
  });

  it('omits undefined optional fields instead of writing them', () => {
    const result = setAgentOverride({}, 'pas_qa', { model: 'qa/model' });
    expect(result).toEqual({
      subagents: { agentOverrides: { pas_qa: { model: 'qa/model' } } },
    });
    expect('defaultProvider' in (result.subagents as any).agentOverrides.pas_qa).toBe(false);
    expect('thinking' in (result.subagents as any).agentOverrides.pas_qa).toBe(false);
  });

  it('preserves unknown top-level keys and nested objects by value and type', () => {
    const settings: PiSettings = {
      lastChangelogVersion: '1.4.0',
      deviceId: 'dev-1',
      packages: ['npm:pi-subagents'],
      hideThinkingBlock: false,
      custom: { nested: { count: 7, enabled: true, list: [1, 'two', null] } },
    };
    const result = setAgentOverride(settings, 'pas_researcher', {
      model: '~deepseek/deepseek-flash-latest',
      defaultProvider: 'openrouter',
    });

    expect(result.lastChangelogVersion).toBe('1.4.0');
    expect(result.deviceId).toBe('dev-1');
    expect(result.packages).toEqual(['npm:pi-subagents']);
    expect(result.hideThinkingBlock).toBe(false);
    expect(result.custom).toEqual({
      nested: { count: 7, enabled: true, list: [1, 'two', null] },
    });
    expect(() => JSON.parse(serializePiSettings(result))).not.toThrow();
  });
});

describe('removeAgentOverride', () => {
  it('removes only the requested override and keeps the others', () => {
    const settings: PiSettings = {
      subagents: {
        agentOverrides: {
          pas_developer: { model: 'dev/model' },
          pas_qa: { model: 'qa/model' },
        },
      },
      defaultProvider: 'openrouter',
    };
    const result = removeAgentOverride(settings, 'pas_developer');

    expect(result).toEqual({
      subagents: { agentOverrides: { pas_qa: { model: 'qa/model' } } },
      defaultProvider: 'openrouter',
    });
  });

  it('prunes agentOverrides when empty and then subagents when empty', () => {
    const settings: PiSettings = {
      subagents: { agentOverrides: { pas_qa: { model: 'qa/model' } } },
      deviceId: 'dev-1',
    };
    const result = removeAgentOverride(settings, 'pas_qa');

    expect(result).toEqual({ deviceId: 'dev-1' });
    expect('subagents' in result).toBe(false);
  });

  it('keeps subagents when it still has other keys', () => {
    const settings: PiSettings = {
      subagents: { agentOverrides: { pas_qa: { model: 'qa/model' } }, maxConcurrent: 3 },
    };
    const result = removeAgentOverride(settings, 'pas_qa');

    expect(result).toEqual({ subagents: { maxConcurrent: 3 } });
  });

  it('returns an unchanged copy when the override does not exist', () => {
    const settings: PiSettings = { subagents: { agentOverrides: { pas_qa: { model: 'qa/model' } } } };
    const result = removeAgentOverride(settings, 'nope');
    expect(result).toEqual(settings);
    expect(result).not.toBe(settings);
  });
});

describe('serializePiSettings', () => {
  it('pretty-prints with two spaces and a trailing newline', () => {
    const text = serializePiSettings({ a: 1, subagents: { agentOverrides: {} } });
    expect(text).toBe('{\n  "a": 1,\n  "subagents": {\n    "agentOverrides": {}\n  }\n}\n');
  });
});

describe('writePiSettings', () => {
  it('writes a new file when the parent directory exists', () => {
    const home = tempRoot();
    const path = defaultPiSettingsPath(home);
    mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
    const settings: PiSettings = { subagents: { agentOverrides: { pas_qa: { model: 'qa/model' } } } };

    const result = writePiSettings(path, settings);

    expect(result).toEqual({ written: true });
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(settings);
    expect(readFileSync(path, 'utf-8').endsWith('\n')).toBe(true);
  });

  it('writes nothing and creates no backup when content is identical', () => {
    const home = tempRoot();
    const path = defaultPiSettingsPath(home);
    mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
    const settings: PiSettings = { a: 1 };
    writePiSettings(path, settings);
    const before = statSync(path).mtimeMs;
    const result = writePiSettings(path, settings, { backup: true, now: () => new Date('2026-10-29T12:34:56') });

    expect(result).toEqual({ written: false });
    expect(statSync(path).mtimeMs).toBe(before);
    expect(existsSync(`${path}.bak.20261029123456`)).toBe(false);
  });

  it('backs up the previous bytes before overwriting changed content', () => {
    const home = tempRoot();
    const path = defaultPiSettingsPath(home);
    mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
    const original = '{\n  "deviceId": "dev-1"\n}\n';
    writeFileSync(path, original);
    const settings: PiSettings = { deviceId: 'dev-1', subagents: { agentOverrides: { pas_qa: { model: 'qa/model' } } } };

    const result = writePiSettings(path, settings, { backup: true, now: () => new Date('2026-10-29T12:34:56') });

    expect(result).toEqual({ written: true, backupPath: `${path}.bak.20261029123456` });
    expect(readFileSync(result.backupPath!, 'utf-8')).toBe(original);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(settings);
  });

  it('does not back up a missing file', () => {
    const home = tempRoot();
    const path = defaultPiSettingsPath(home);
    mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
    const result = writePiSettings(path, { a: 1 }, { backup: true, now: () => new Date('2026-10-29T12:34:56') });
    expect(result).toEqual({ written: true });
    expect(existsSync(`${path}.bak.20261029123456`)).toBe(false);
  });

  it('throws PiSettingsError without creating the parent directory when it is missing', () => {
    const home = tempRoot();
    const path = defaultPiSettingsPath(home);

    let error: unknown;
    try {
      writePiSettings(path, { a: 1 });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PiSettingsError);
    expect((error as Error).message).toContain(path);
    expect(existsSync(join(home, '.pi'))).toBe(false);
  });
});
