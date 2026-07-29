/**
 * Integration tests for the `pas agents profile` CLI surface (FEAT-008).
 *
 * The library lives in `src/cli/lib/profile-store.ts`; the CLI wraps it in
 * five thin commands (`save` / `list` / `load` / `rename` / `delete`).
 * These tests exercise the full CLI surface end-to-end via `spawnSync`,
 * with HOME pointed at a temp directory so both `~/.config/opencode/opencode.json`
 * and `~/.config/opencode/pas/profiles/*.json` are isolated per test.
 *
 * Approved contract:
 *   - Storage path is `~/.config/opencode/pas/profiles/<name>.json`.
 *   - `save` snapshots model+variant for the unchanged canonical agent set only,
 *     rejects duplicates, drops extra fields, prints success.
 *   - `list` prints sorted names, prints "no profiles" when empty,
 *     exits 0 in both cases.
 *   - `load` intersects with `PAS_AGENTS`, ignores orphaned profile
 *     entries, removes canonical overrides absent from the profile,
 *     preserves unrelated config fields, and creates a backup before
 *     writing. Prints which canonical agents were updated and which
 *     orphaned entries were ignored.
 *   - `rename` rejects missing source and existing target.
 *   - `delete` rejects missing source.
 *   - `pas agents profile --help` lists every subcommand.
 *   - `pas agents --help` lists `profile`.
 */

import { describe, expect, it, afterEach, beforeEach } from 'bun:test';
import { spawnSync } from 'bun';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const REPO_ROOT = join(import.meta.dir, '..', '..');

function makeTempHome(): string {
  const dir = join(
    tmpdir(),
    'pas-agents-profile-int-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.config', 'opencode'), { recursive: true });
  return dir;
}

function writeOpencodeConfig(home: string, content: object): string {
  const file = join(home, '.config', 'opencode', 'opencode.json');
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

function listProfilesDir(home: string): string[] {
  const dir = join(home, '.config', 'opencode', 'pas', 'profiles');
  return spawnSync(['ls'], { cwd: dir, stdout: 'pipe' })
    .stdout.toString()
    .split('\n')
    .filter(Boolean);
}

function listOpencodeDir(home: string): string[] {
  return spawnSync(['ls'], {
    cwd: join(home, '.config', 'opencode'),
    stdout: 'pipe',
  })
    .stdout.toString()
    .split('\n')
    .filter(Boolean);
}

function runPas(
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
  tempHome = makeTempHome();
});

afterEach(() => {
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// save
// -----------------------------------------------------------------------------

describe('pas agents profile save — non-interactive', () => {
  it('writes a profile file containing only canonical agent model+variant', () => {
    writeOpencodeConfig(tempHome, {
      agent: {
        pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
        pas_qa: { model: 'opencode/deepseek-v4-pro' },
        'some-other-agent': { model: 'openai/gpt-5' },
      },
    });
    const r = runPas(tempHome, ['agents', 'profile', 'save', 'my-setup']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('my-setup');

    const profilePath = join(
      tempHome,
      '.config',
      'opencode',
      'pas',
      'profiles',
      'my-setup.json',
    );
    expect(existsSync(profilePath)).toBe(true);
    const payload = JSON.parse(readFileSync(profilePath, 'utf-8'));
    expect(payload).toEqual({
      pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
      pas_qa: { model: 'opencode/deepseek-v4-pro' },
    });
    expect(payload.some_other_agent ?? payload['some-other-agent']).toBeUndefined();
  });

  it('drops extra fields beyond `model` and `variant` per agent', () => {
    writeOpencodeConfig(tempHome, {
      agent: {
        pas_developer: {
          model: 'anthropic/claude-sonnet-4-6',
          variant: 'high',
          mode: 'subagent',
          permission: { skill: { '*': 'allow' } },
        } as Record<string, unknown>,
      },
    });
    const r = runPas(tempHome, ['agents', 'profile', 'save', 'minimal']);
    expect(r.exitCode).toBe(0);
    const profilePath = join(
      tempHome,
      '.config',
      'opencode',
      'pas',
      'profiles',
      'minimal.json',
    );
    const payload = JSON.parse(readFileSync(profilePath, 'utf-8'));
    expect(payload).toEqual({
      pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
    });
  });

  it('rejects a duplicate name without overwriting the existing file', () => {
    writeOpencodeConfig(tempHome, {
      agent: { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } },
    });
    const first = runPas(tempHome, ['agents', 'profile', 'save', 'dup']);
    expect(first.exitCode).toBe(0);

    const profilePath = join(
      tempHome,
      '.config',
      'opencode',
      'pas',
      'profiles',
      'dup.json',
    );
    const before = readFileSync(profilePath, 'utf-8');

    const second = runPas(tempHome, [
      'agents',
      'profile',
      'save',
      'dup',
    ]);
    expect(second.exitCode).not.toBe(0);
    expect(second.stderr.toLowerCase()).toMatch(/exists/);
    expect(readFileSync(profilePath, 'utf-8')).toBe(before);
  });
});

// -----------------------------------------------------------------------------
// list
// -----------------------------------------------------------------------------

describe('pas agents profile list — read-only', () => {
  it('prints "(no profiles)" (or equivalent) and exits 0 when empty', () => {
    writeOpencodeConfig(tempHome, {});
    const r = runPas(tempHome, ['agents', 'profile', 'list']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toLowerCase()).toMatch(/no profiles/);
  });

  it('prints every saved profile name in sorted order and exits 0', () => {
    writeOpencodeConfig(tempHome, {});
     mkdirSync(join(tempHome, '.config', 'opencode', 'pas', 'profiles'), {
      recursive: true,
    });
    // Use the CLI's own command so we do not handcraft a partial fixture.
    runPas(tempHome, ['agents', 'profile', 'save', 'b-setup']);
    runPas(tempHome, ['agents', 'profile', 'save', 'a-setup']);
    runPas(tempHome, ['agents', 'profile', 'save', 'c-setup']);

    const r = runPas(tempHome, ['agents', 'profile', 'list']);
    expect(r.exitCode).toBe(0);
    const idx = (s: string) => r.stdout.indexOf(s);
    expect(idx('a-setup')).toBeGreaterThanOrEqual(0);
    expect(idx('b-setup')).toBeGreaterThan(idx('a-setup'));
    expect(idx('c-setup')).toBeGreaterThan(idx('b-setup'));
    // Sorted order means a-setup appears before b-setup before c-setup.
  });

  it('does not modify the config (read-only)', () => {
    const file = writeOpencodeConfig(tempHome, {
      default_agent: 'Pulsar Agent Squad',
    });
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['agents', 'profile', 'list']);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(file, 'utf-8')).toBe(before);
  });
});

// -----------------------------------------------------------------------------
// load
// -----------------------------------------------------------------------------

describe('pas agents profile load — applies model overrides from the profile', () => {
  it('writes canonical agent overrides and prints the updated list', () => {
    writeOpencodeConfig(tempHome, {});
    runPas(tempHome, [
      'agents',
      'profile',
      'save',
      'my-setup',
    ]);
    // Replace the saved profile with a controlled payload so we can assert
    // exact fields.
    writeFileSync(
      join(
        tempHome,
        '.config',
        'opencode',
         'pas',
        'profiles',
        'my-setup.json',
      ),
      JSON.stringify({
        pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
        pas_qa: { model: 'opencode/deepseek-v4-pro' },
      }, null, 2),
    );

    const r = runPas(tempHome, ['agents', 'profile', 'load', 'my-setup']);
    expect(r.exitCode).toBe(0);
    const after = JSON.parse(
      readFileSync(join(tempHome, '.config', 'opencode', 'opencode.json'), 'utf-8'),
    );
    expect(after.agent.pas_developer).toEqual({
      model: 'anthropic/claude-sonnet-4-6',
      variant: 'high',
    });
    expect(after.agent.pas_qa).toEqual({ model: 'opencode/deepseek-v4-pro' });
    // The CLI must surface the updated agents in its output.
    expect(r.stdout).toContain('pas_developer');
    expect(r.stdout).toContain('pas_qa');
  });

  it('silently ignores profile entries for non-canonical / orphaned agents', () => {
    writeOpencodeConfig(tempHome, {});
    // Hand-write a profile with one canonical + one orphaned entry.
    mkdirSync(join(tempHome, '.config', 'opencode', 'pas', 'profiles'), {
      recursive: true,
    });
    writeFileSync(
      join(
        tempHome,
        '.config',
        'opencode',
         'pas',
        'profiles',
        'legacy.json',
      ),
      JSON.stringify({
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
        legacy_agent: { model: 'openai/gpt-5' },
      }, null, 2),
    );

    const r = runPas(tempHome, ['agents', 'profile', 'load', 'legacy']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('legacy_agent'); // the CLI surfaces the ignored entry
    const after = JSON.parse(
      readFileSync(join(tempHome, '.config', 'opencode', 'opencode.json'), 'utf-8'),
    );
    expect(after.agent.pas_developer).toEqual({ model: 'anthropic/claude-sonnet-4-6' });
    expect(after.agent.legacy_agent).toBeUndefined();
  });

  it('removes canonical overrides absent from the profile', () => {
    writeOpencodeConfig(tempHome, {
      agent: {
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
        pas_qa: { model: 'opencode/deepseek-v4-pro' },
      },
    });
    mkdirSync(join(tempHome, '.config', 'opencode', 'pas', 'profiles'), {
      recursive: true,
    });
    writeFileSync(
      join(
        tempHome,
        '.config',
        'opencode',
         'pas',
        'profiles',
        'single.json',
      ),
      JSON.stringify({
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
      }, null, 2),
    );

    const r = runPas(tempHome, ['agents', 'profile', 'load', 'single']);
    expect(r.exitCode).toBe(0);
    const after = JSON.parse(
      readFileSync(join(tempHome, '.config', 'opencode', 'opencode.json'), 'utf-8'),
    );
    expect(after.agent.pas_developer).toEqual({ model: 'anthropic/claude-sonnet-4-6' });
    expect(after.agent.pas_qa).toBeUndefined();
  });

  it('preserves unrelated top-level config fields and non-canonical overrides', () => {
    writeOpencodeConfig(tempHome, {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'Pulsar Agent Squad',
      permission: { edit: { '*': 'allow' } },
      provider: { cursor: { name: 'Cursor' } },
      agent: {
        'user-custom-agent': { model: 'openai/gpt-5' },
      },
    });
    mkdirSync(join(tempHome, '.config', 'opencode', 'pas', 'profiles'), {
      recursive: true,
    });
    writeFileSync(
      join(
        tempHome,
        '.config',
        'opencode',
         'pas',
        'profiles',
        'setup.json',
      ),
      JSON.stringify({
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
      }, null, 2),
    );

    const r = runPas(tempHome, ['agents', 'profile', 'load', 'setup']);
    expect(r.exitCode).toBe(0);
    const after = JSON.parse(
      readFileSync(join(tempHome, '.config', 'opencode', 'opencode.json'), 'utf-8'),
    );
    expect(after.$schema).toBe('https://opencode.ai/config.json');
    expect(after.default_agent).toBe('Pulsar Agent Squad');
    expect(after.permission).toEqual({ edit: { '*': 'allow' } });
    expect(after.provider).toEqual({ cursor: { name: 'Cursor' } });
    expect(after.agent['user-custom-agent']).toEqual({ model: 'openai/gpt-5' });
    expect(after.agent.pas_developer).toEqual({ model: 'anthropic/claude-sonnet-4-6' });
  });

  it('creates a timestamped backup of opencode.json before writing', () => {
    writeOpencodeConfig(tempHome, {
      default_agent: 'Pulsar Agent Squad',
    });
    mkdirSync(join(tempHome, '.config', 'opencode', 'pas', 'profiles'), {
      recursive: true,
    });
    writeFileSync(
      join(
        tempHome,
        '.config',
        'opencode',
         'pas',
        'profiles',
        'setup.json',
      ),
      JSON.stringify({
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
      }, null, 2),
    );

    const r = runPas(tempHome, ['agents', 'profile', 'load', 'setup']);
    expect(r.exitCode).toBe(0);
    const files = listOpencodeDir(tempHome);
    const backups = files.filter((f) => f.startsWith('opencode.json.bak.'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects when the profile does not exist', () => {
    writeOpencodeConfig(tempHome, {});
    const r = runPas(tempHome, ['agents', 'profile', 'load', 'nope']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/not exist/);
  });
});

// -----------------------------------------------------------------------------
// rename
// -----------------------------------------------------------------------------

describe('pas agents profile rename — non-interactive', () => {
  it('renames the profile file and preserves the content', () => {
    writeOpencodeConfig(tempHome, {});
    runPas(tempHome, ['agents', 'profile', 'save', 'old-name']);
    const r = runPas(tempHome, [
      'agents',
      'profile',
      'rename',
      'old-name',
      'new-name',
    ]);
    expect(r.exitCode).toBe(0);
    const oldPath = join(
      tempHome,
      '.config',
      'opencode',
       'pas',
      'profiles',
      'old-name.json',
    );
    const newPath = join(
      tempHome,
      '.config',
      'opencode',
       'pas',
      'profiles',
      'new-name.json',
    );
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
  });

  it('rejects when the source profile does not exist', () => {
    const r = runPas(tempHome, [
      'agents',
      'profile',
      'rename',
      'ghost',
      'phantom',
    ]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/not exist/);
  });

  it('rejects when the target profile already exists', () => {
    writeOpencodeConfig(tempHome, {});
    runPas(tempHome, ['agents', 'profile', 'save', 'alpha']);
    runPas(tempHome, ['agents', 'profile', 'save', 'beta']);
    const r = runPas(tempHome, [
      'agents',
      'profile',
      'rename',
      'alpha',
      'beta',
    ]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/exists/);
    // The source must remain untouched.
    const alphaPath = join(
      tempHome,
      '.config',
      'opencode',
       'pas',
      'profiles',
      'alpha.json',
    );
    expect(existsSync(alphaPath)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// delete
// -----------------------------------------------------------------------------

describe('pas agents profile delete — non-interactive', () => {
  it('deletes the profile file and exits 0', () => {
    writeOpencodeConfig(tempHome, {});
    runPas(tempHome, ['agents', 'profile', 'save', 'to-remove']);
    const file = join(
      tempHome,
      '.config',
      'opencode',
       'pas',
      'profiles',
      'to-remove.json',
    );
    expect(existsSync(file)).toBe(true);

    const r = runPas(tempHome, ['agents', 'profile', 'delete', 'to-remove']);
    expect(r.exitCode).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  it('rejects when the profile does not exist', () => {
    const r = runPas(tempHome, ['agents', 'profile', 'delete', 'nope']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/not exist/);
  });
});

// -----------------------------------------------------------------------------
// Discoverability — help contract
// -----------------------------------------------------------------------------

describe('help — discoverability of the `profile` subcommand', () => {
   it('`pas agents --help` lists `profile`', () => {
    const r = runPas(tempHome, ['agents', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('profile');
  });

   it('`pas agents profile --help` lists every subcommand', () => {
    const r = runPas(tempHome, ['agents', 'profile', '--help']);
    expect(r.exitCode).toBe(0);
    const out = r.stdout;
    expect(out).toContain('save');
    expect(out).toContain('list');
    expect(out).toContain('load');
    expect(out).toContain('rename');
    expect(out).toContain('delete');
  });
});

// -----------------------------------------------------------------------------
// Storage path sanity
// -----------------------------------------------------------------------------

describe('storage path — files live in ~/.config/opencode/pas/profiles/', () => {
  it('saved profiles land under the approved contract path', () => {
    writeOpencodeConfig(tempHome, {
      agent: { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } },
    });
    const r = runPas(tempHome, ['agents', 'profile', 'save', 'path-check']);
    expect(r.exitCode).toBe(0);
    const files = listProfilesDir(tempHome);
    expect(files).toContain('path-check.json');
  });
});
