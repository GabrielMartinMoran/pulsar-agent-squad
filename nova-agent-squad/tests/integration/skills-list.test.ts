/**
 * Integration tests for the read-only `nas skills` / `nas skills list`
 * command surface.
 *
 * Verifies (per 2026-06-30 bugfix — the CLI manages only NAS agent
 * per-agent blocks; top-level `permission.skill` is not a managed
 * scope):
 *   - byte-identical output between bare `nas skills` and `nas skills list`
 *   - one card per NAS agent is rendered (no "Global" card)
 *   - the OpenCode `permission.skill` source of truth is reflected
 *     (per-agent blocks only; top-level rules are NOT surfaced)
 *   - the read-only surface never mutates the config (no backup, no write)
 *   - `--plain` and `NO_COLOR` honor the same color guards as `nas agents`
 *   - the subcommand list is exposed in `nas skills --help`
 *   - bare `nas skills` and `nas skills list` accept the same args
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'bun';
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const REPO_ROOT = join(import.meta.dir, '..', '..');

function makeTempConfigDir(): string {
  const dir = join(
    tmpdir(),
    'nas-skills-list-int-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.config', 'opencode'), { recursive: true });
  return dir;
}

function writeConfigFile(home: string, content: object): string {
  const file = join(home, '.config', 'opencode', 'opencode.json');
  writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

function runNas(
  home: string,
  args: string[],
  envOverride: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(['bun', 'run', 'src/cli/index.ts', ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, HOME: home, ...envOverride },
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

describe('nas skills list — read-only summary', () => {
  it('shows one card per NAS agent and does NOT show a "Global" card', () => {
    writeConfigFile(tempHome, { default_agent: 'Nova Agent Squad' });
    const r = runNas(tempHome, ['skills', 'list', '--plain']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('nas_researcher');
    expect(r.stdout).toContain('nas_planner');
    expect(r.stdout).toContain('nas_developer');
    expect(r.stdout).toContain('nas_developer_mini');
    expect(r.stdout).toContain('nas_qa');
    expect(r.stdout).toContain('Nova Agent Squad');
    // No "Global" card line — the CLI does not manage top-level rules.
    expect(r.stdout).not.toMatch(/^\s*Global\s*$/m);
    // Every scope shows "(no rules)" (6 NAS agents).
    expect(r.stdout.match(/\(no rules\)/g)?.length).toBe(6);
  });

  it('emits byte-identical output for bare `nas skills` and `nas skills list`', () => {
    writeConfigFile(tempHome, {
      agent: { nas_developer: { permission: { skill: { 'git-*': 'deny' } } } },
    });
    // Use --skip-discovery so the output does not depend on the live
    // `opencode debug skill` ordering (which can vary between calls
    // when skills are added/removed).
    const bare = runNas(tempHome, ['skills', '--plain', '--skip-discovery']);
    const list = runNas(tempHome, ['skills', 'list', '--plain', '--skip-discovery']);
    expect(bare.exitCode).toBe(0);
    expect(list.exitCode).toBe(0);
    expect(bare.stdout).toBe(list.stdout);
  }, 20_000);

  it('does NOT surface top-level `permission.skill` rules (CLI does not manage them)', () => {
    writeConfigFile(tempHome, {
      permission: { skill: { '*': 'allow', 'docs-writer': 'deny' } },
    });
    const r = runNas(tempHome, ['skills', 'list', '--plain']);
    expect(r.exitCode).toBe(0);
    // No "Global" card.
    expect(r.stdout).not.toMatch(/^\s*Global\s*$/m);
    // The top-level patterns must not appear in the output.
    expect(r.stdout).not.toMatch(/Pattern:\s+\*/);
    expect(r.stdout).not.toMatch(/Pattern:\s+docs-writer/);
  });

  it('reflects the configured per-agent rules', () => {
    writeConfigFile(tempHome, {
      agent: {
        nas_developer: { permission: { skill: { 'git-*': 'deny' } } },
      },
    });
    const r = runNas(tempHome, ['skills', 'list', '--plain']);
    expect(r.exitCode).toBe(0);
    // The pattern must appear in the nas_developer block; indexOf confirms
    // nas_developer is the right card.
    const devIdx = r.stdout.indexOf('nas_developer');
    const nextIdx = r.stdout.indexOf('nas_developer_mini');
    expect(devIdx).toBeGreaterThanOrEqual(0);
    expect(nextIdx).toBeGreaterThan(devIdx);
    const devBlock = r.stdout.slice(devIdx, nextIdx);
    expect(devBlock).toMatch(/Pattern:\s+git-\*/);
  });

  it('does not modify the config file (read-only)', () => {
    const file = writeConfigFile(tempHome, {
      agent: { nas_developer: { permission: { skill: { 'docs-writer': 'deny' } } } },
    });
    const before = readFileSync(file, 'utf-8');
    // --skip-discovery avoids `opencode debug skill` writing its own
    // fields (e.g. `$schema`) into opencode.json — that is an OpenCode
    // side effect, not ours. This test asserts NAS code is read-only.
    const r = runNas(tempHome, ['skills', 'list', '--skip-discovery']);
    expect(r.exitCode).toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('does not create a backup file (read-only surface does not write)', () => {
    writeConfigFile(tempHome, {
      agent: { nas_developer: { permission: { skill: { 'docs-writer': 'deny' } } } },
    });
    // --skip-discovery to isolate our backup behavior from the OpenCode
    // side effect on the config file.
    runNas(tempHome, ['skills', 'list', '--skip-discovery']);
    // No backup should have been created
    const ls = spawnSync(['ls', join(tempHome, '.config', 'opencode')], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: tempHome },
      stdout: 'pipe',
    });
    const out = ls.stdout.toString();
    expect(out).not.toMatch(/opencode\.json\.bak/);
  });

  it('exposes the subcommands in `nas skills --help`', () => {
    const r = runNas(tempHome, ['skills', '--help']);
    expect(r.exitCode).toBe(0);
    const out = r.stdout;
    expect(out).toContain('list');
    expect(out).toContain('setup');
    expect(out).toContain('add');
    expect(out).toContain('remove');
    expect(out).toContain('clear');
  });

  it('exposes the top-level `skills` command in `nas --help`', () => {
    const r = runNas(tempHome, ['--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('skills');
  });

  it('emits no ANSI codes when NO_COLOR is set', () => {
    writeConfigFile(tempHome, {});
    const r = runNas(tempHome, ['skills', 'list', '--skip-discovery'], { NO_COLOR: '1' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('\x1b[');
  }, 20_000);

  it('--plain is accepted on both `nas skills list` and bare `nas skills`', () => {
    writeConfigFile(tempHome, {});
    // --skip-discovery to keep the test focused on --plain handling and
    // avoid running `opencode debug skill` twice (which is slow).
    const list = runNas(tempHome, ['skills', 'list', '--plain', '--skip-discovery']);
    const bare = runNas(tempHome, ['skills', '--plain', '--skip-discovery']);
    expect(list.exitCode).toBe(0);
    expect(bare.exitCode).toBe(0);
    expect(list.stdout).not.toContain('\x1b[');
    expect(bare.stdout).not.toContain('\x1b[');
  }, 20_000);

  it('preserves byte-identical output between bare and subcommand with --plain', () => {
    writeConfigFile(tempHome, {
      agent: { nas_qa: { permission: { skill: { 'foo': 'deny' } } } },
    });
    // --skip-discovery keeps the assertion focused on the read-only view
    // (live skill ordering varies).
    const bare = runNas(tempHome, ['skills', '--plain', '--skip-discovery']);
    const list = runNas(tempHome, ['skills', 'list', '--plain', '--skip-discovery']);
    expect(bare.exitCode).toBe(0);
    expect(list.exitCode).toBe(0);
    expect(bare.stdout).toBe(list.stdout);
  }, 20_000);

  it('--skip-discovery skips the "Available skills" reference list', () => {
    writeConfigFile(tempHome, {});
    const r = runNas(tempHome, ['skills', 'list', '--skip-discovery', '--plain']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toMatch(/Available skills/i);
  });

  it('shows override and default indicators, never success/failure glyphs', () => {
    writeConfigFile(tempHome, {
      agent: { nas_developer: { permission: { skill: { 'foo': 'deny' } } } },
    });
    const r = runNas(tempHome, ['skills', 'list', '--plain']);
    expect(r.exitCode).toBe(0);
    // At least one override marker (the agent with rules)
    expect(r.stdout.match(/●/g)?.length).toBeGreaterThanOrEqual(1);
    // At least one default marker (the other agents)
    expect(r.stdout.match(/○/g)?.length).toBeGreaterThanOrEqual(1);
    // No success/failure semantics
    expect(r.stdout).not.toMatch(/[✓✔]/);
    expect(r.stdout).not.toMatch(/[✗✘×]/);
  });
});
