import { describe, expect, it, afterEach } from 'bun:test';
import {
  setAgentModel,
  removeAgentOverride,
  readConfig,
  writeConfig,
  createBackup,
  type OpenCodeConfig,
} from '../../src/cli/lib/config-safety';
import { rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), 'nas-config-safety-test-' + Date.now());

function createTestConfig(content: object): string {
  mkdirSync(testDir, { recursive: true });
  const path = join(testDir, 'opencode.json');
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

function cleanup() {
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
}

afterEach(cleanup);

describe('setAgentModel', () => {
  it('should add entry to empty agent section', () => {
    const config: OpenCodeConfig = { default_agent: 'test' };
    const result = setAgentModel(config, 'nas_developer', 'anthropic/claude-sonnet-4-6');
    expect(result.agent).toEqual({ nas_developer: { model: 'anthropic/claude-sonnet-4-6' } });
    expect(result.default_agent).toBe('test');
  });

  it('should add entry when agent section exists with other agents', () => {
    const config: OpenCodeConfig = {
      agent: { existing: { model: 'old/model' } },
    };
    const result = setAgentModel(config, 'nas_developer', 'anthropic/claude-sonnet-4-6');
    expect(result.agent).toEqual({
      existing: { model: 'old/model' },
      nas_developer: { model: 'anthropic/claude-sonnet-4-6' },
    });
  });

  it('should update existing agent entry', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { model: 'old/model', mode: 'subagent' } },
    };
    const result = setAgentModel(config, 'nas_developer', 'anthropic/claude-sonnet-4-6');
    expect(result.agent).toEqual({
      nas_developer: { model: 'anthropic/claude-sonnet-4-6', mode: 'subagent' },
    });
  });

  it('should preserve all non-agent keys', () => {
    const config: OpenCodeConfig = {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'test',
      mcp: { server: { type: 'local', command: ['echo'] } as any },
      plugin: ['plugin-one'],
      provider: { cursor: { name: 'Cursor' } },
      instructions: ['AGENTS.md'],
    };
    const result = setAgentModel(config, 'nas_developer', 'anthropic/claude-sonnet-4-6');
    expect(result.$schema).toBe('https://opencode.ai/config.json');
    expect(result.default_agent).toBe('test');
    expect(result.mcp).toBeDefined();
    expect(result.plugin).toBeDefined();
    expect(result.provider).toBeDefined();
    expect(result.instructions).toBeDefined();
    expect(result.agent).toBeDefined();
  });

  it('should preserve unknown custom keys', () => {
    const config: OpenCodeConfig = {
      custom_field: 'preserved',
      another: 42,
    };
    const result = setAgentModel(config, 'nas_developer', 'model');
    expect(result.custom_field).toBe('preserved');
    expect(result.another).toBe(42);
  });
});

describe('setAgentModel with variant', () => {
  it('should set both model and variant when variant is provided', () => {
    const config: OpenCodeConfig = { default_agent: 'test' };
    const result = setAgentModel(config, 'nas_developer', 'openrouter/anthropic/claude-sonnet', 'high');
    expect(result.agent).toEqual({
      nas_developer: { model: 'openrouter/anthropic/claude-sonnet', variant: 'high' },
    });
  });

  it('should add variant to existing agent entry preserving other fields', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { model: 'old/model', mode: 'subagent' } },
    };
    const result = setAgentModel(config, 'nas_developer', 'openrouter/anthropic/claude-sonnet', 'max');
    expect(result.agent).toEqual({
      nas_developer: { model: 'openrouter/anthropic/claude-sonnet', mode: 'subagent', variant: 'max' },
    });
  });

  it('should remove variant field when variant is "default"', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { model: 'some/model', variant: 'high', mode: 'subagent' } },
    };
    const result = setAgentModel(config, 'nas_developer', 'some/model', 'default');
    expect(result.agent).toEqual({
      nas_developer: { model: 'some/model', mode: 'subagent' },
    });
    expect(result.agent!.nas_developer.variant).toBeUndefined();
  });

  it('should not add variant field when variant is undefined', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { model: 'some/model', mode: 'subagent' } },
    };
    const result = setAgentModel(config, 'nas_developer', 'some/model');
    expect(result.agent).toEqual({
      nas_developer: { model: 'some/model', mode: 'subagent' },
    });
    expect(result.agent!.nas_developer.variant).toBeUndefined();
  });

  it('should change variant to a new value', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { model: 'openrouter/anthropic/claude-sonnet', variant: 'high' } },
    };
    const result = setAgentModel(config, 'nas_developer', 'openrouter/anthropic/claude-sonnet', 'max');
    expect(result.agent!.nas_developer.variant).toBe('max');
  });
});

describe('removeAgentOverride', () => {
  it('should remove specific agent entry', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: { model: 'anthropic/model' },
        nas_qa: { model: 'other/model' },
      },
    };
    const result = removeAgentOverride(config, 'nas_developer');
    expect(result.agent).toBeDefined();
    expect(result.agent!.nas_developer).toBeUndefined();
    expect(result.agent!.nas_qa).toBeDefined();
  });

  it('should clean up empty agent section after last removal', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { model: 'anthropic/model' } },
    };
    const result = removeAgentOverride(config, 'nas_developer');
    expect(result.agent).toBeUndefined();
  });

  it('should do nothing when agent section does not exist', () => {
    const config: OpenCodeConfig = { default_agent: 'test' };
    const result = removeAgentOverride(config, 'nonexistent');
    expect(result.agent).toBeUndefined();
    expect(result.default_agent).toBe('test');
  });

  it('should do nothing when agent name not found', () => {
    const config: OpenCodeConfig = {
      agent: { other_agent: { model: 'some/model' } },
    };
    const result = removeAgentOverride(config, 'nas_developer');
    expect(result.agent).toEqual({ other_agent: { model: 'some/model' } });
  });
});

describe('readConfig / writeConfig', () => {
  it('should read and parse a valid config file', () => {
    const path = createTestConfig({ $schema: 'https://opencode.ai/config.json', default_agent: 'test' });
    const config = readConfig(path);
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.default_agent).toBe('test');
  });

  it('should throw descriptive error for malformed JSON', () => {
    const path = join(testDir, 'malformed.json');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(path, '{ broken json }');
    expect(() => readConfig(path)).toThrow(/malformed|parse|JSON/i);
  });

  it('should write config with 2-space indentation', () => {
    const path = createTestConfig({ key: 'value' });
    const config = readConfig(path);
    config.newKey = 'newValue';
    writeConfig(config, path);
    const raw = readFileSync(path, 'utf-8');
    const expected = `{\n  "key": "value",\n  "newKey": "newValue"\n}\n`;
    expect(raw).toBe(expected);
  });

  it('should preserve $schema field at top of output', () => {
    const path = createTestConfig({ $schema: 'https://opencode.ai/config.json', default_agent: 'test' });
    const config = readConfig(path);
    config.agent = { nas_dev: { model: 'test' } };
    writeConfig(config, path);
    const raw = readFileSync(path, 'utf-8');
    expect(raw).toStartWith('{\n  "$schema": "https://opencode.ai/config.json"');
  });

  it('should round-trip preserve all keys including unknown ones', () => {
    const original = {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'test',
      mcp: { server: { type: 'local', command: ['echo'], enabled: true } },
      instructions: ['instruction1', 'instruction2'],
      plugin: ['plugin-one', 'plugin-two'],
      provider: { cursor: { name: 'Cursor' }, anthropic: { options: { apiKey: 'key' } } },
      custom_unknown: 42,
    };
    const path = createTestConfig(original);
    writeConfig(original, path);
    const reRead = readConfig(path);
    expect(reRead).toEqual(original);
  });
});

describe('createBackup', () => {
  it('should create a timestamped backup of the config file', () => {
    const path = createTestConfig({ key: 'value' });
    const backupPath = createBackup(path);
    expect(backupPath).toMatch(/opencode\.json\.bak\.\d{14}$/);
    const backupContent = readFileSync(backupPath, 'utf-8');
    expect(backupContent).toContain('"key": "value"');
    // Clean up backup
    try { rmSync(backupPath); } catch {}
  });

  it('should return empty string when source does not exist', () => {
    const backupPath = createBackup('/nonexistent/path/opencode.json');
    expect(backupPath).toBe('');
  });
});

describe('integration: set + remove cycle', () => {
  it('should allow setting then removing agent model', () => {
    const config: OpenCodeConfig = { default_agent: 'test' };
    const withModel = setAgentModel(config, 'nas_developer', 'anthropic/model');
    expect(withModel.agent).toBeDefined();
    const removed = removeAgentOverride(withModel, 'nas_developer');
    expect(removed.agent).toBeUndefined();
    expect(removed).toEqual({ default_agent: 'test' });
  });
});
