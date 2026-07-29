/**
 * Integration test for the read-only `nas agents` summary surfaces:
 *  - bare `nas agents` (no subcommand)
 *  - explicit `nas agents list` subcommand
 *
 * Both code paths must produce the same human-friendly summary built from
 * the live opencode.json config, with `default` for unset model/variant/
 * reasoning effort values.
 *
 * To stay isolated from the user's real config, we point the config
 * loader at a temp file by writing one and setting HOME to its parent
 * directory for the duration of the spawn.
 */

import { describe, expect, it, afterEach, beforeEach } from 'bun:test';
import { spawnSync } from 'bun';
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const REPO_ROOT = join(import.meta.dir, '..', '..');

function makeTempConfigDir(): string {
  const dir = join(tmpdir(), 'nas-agents-list-int-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.config', 'opencode'), { recursive: true });
  return dir;
}

function writeConfigFile(home: string, content: object): string {
  const file = join(home, '.config', 'opencode', 'opencode.json');
  writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

function runNas(home: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(['bun', 'run', 'src/cli/index.ts', ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, HOME: home },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? -1,
  };
}

let tempHome = '';

beforeEach(() => {
  tempHome = makeTempConfigDir();
});

afterEach(() => {
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

describe('nas agents list — read-only summary', () => {
  it('should print a multi-agent summary with `default` for every agent when no overrides are set', () => {
    writeConfigFile(tempHome, { default_agent: 'Nova Agent Squad' });
    const r = runNas(tempHome, ['agents', 'list']);
    expect(r.exitCode).toBe(0);

    const out = r.stdout;
    expect(out).toContain('nas_researcher');
    expect(out).toContain('nas_planner');
    expect(out).toContain('nas_developer');
    expect(out).toContain('nas_developer_mini');
    expect(out).toContain('nas_qa');
    expect(out).toContain('Nova Agent Squad');
    // All agents report default model + variant; reasoning effort is retired.
    expect(out.match(/Model:\s+default/g)?.length).toBe(6);
    expect(out.match(/Variant:\s+default/g)?.length).toBe(6);
    expect(out).not.toContain('Reasoning effort:');
  });

  it('should print the same summary for bare `nas agents` and `nas agents list`', () => {
    writeConfigFile(tempHome, {
      agent: { nas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' } },
    });
    const bare = runNas(tempHome, ['agents']);
    const list = runNas(tempHome, ['agents', 'list']);

    expect(bare.exitCode).toBe(0);
    expect(list.exitCode).toBe(0);
    expect(bare.stdout).toBe(list.stdout);
  });

  it('should show the configured model and variant for an overridden agent', () => {
    writeConfigFile(tempHome, {
      agent: {
        nas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
        nas_qa: { model: 'opencode/deepseek-v4-pro' },
      },
    });
    const r = runNas(tempHome, ['agents', 'list']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Model:\s+anthropic\/claude-sonnet-4-6/);
    expect(r.stdout).toMatch(/Variant:\s+high/);
    expect(r.stdout).toMatch(/Model:\s+opencode\/deepseek-v4-pro/);
    expect(r.stdout).toMatch(/Variant:\s+default/);
    expect(r.stdout).not.toContain('Reasoning effort:');
  });

  it('should expose the list subcommand in nas agents --help output', () => {
    const r = runNas(tempHome, ['agents', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('list');
  });

  it('should not modify the config file (read-only)', () => {
    const file = writeConfigFile(tempHome, {
      agent: { nas_developer: { model: 'anthropic/claude-sonnet-4-6' } },
    });
    const before = readFileSync(file, 'utf-8');
    const r = runNas(tempHome, ['agents', 'list']);
    expect(r.exitCode).toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('should accept --plain on `nas agents list` and emit no ANSI codes', () => {
    writeConfigFile(tempHome, {
      agent: { nas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' } },
    });
    const r = runNas(tempHome, ['agents', 'list', '--plain']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('\x1b[');
    // Plain output still surfaces the configured model and the state indicator
    expect(r.stdout).toMatch(/Model:\s+anthropic\/claude-sonnet-4-6/);
    expect(r.stdout).toMatch(/Variant:\s+high/);
    expect(r.stdout).toMatch(/●/); // override marker
  });

  it('should accept --plain on bare `nas agents` and emit no ANSI codes', () => {
    writeConfigFile(tempHome, {});
    const r = runNas(tempHome, ['agents', '--plain']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('\x1b[');
    // Default state indicator is present
    expect(r.stdout).toMatch(/○/);
  });

  it('should emit no ANSI codes when NO_COLOR is set, even on a TTY simulator', () => {
    writeConfigFile(tempHome, {});
    const result = spawnSync(['bun', 'run', 'src/cli/index.ts', 'agents', 'list'], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: tempHome, NO_COLOR: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).not.toContain('\x1b[');
  });

  it('should keep bare `nas agents` and `nas agents list` byte-identical with --plain', () => {
    writeConfigFile(tempHome, {
      agent: {
        nas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
        nas_qa: { model: 'opencode/deepseek-v4-pro' },
      },
    });
    const bare = runNas(tempHome, ['agents', '--plain']);
    const list = runNas(tempHome, ['agents', 'list', '--plain']);
    expect(bare.exitCode).toBe(0);
    expect(list.exitCode).toBe(0);
    expect(bare.stdout).toBe(list.stdout);
  });
});
