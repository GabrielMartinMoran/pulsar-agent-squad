/**
 * Integration tests for the non-interactive `pas skills add`,
 * `pas skills remove`, and `pas skills clear` commands.
 *
 * Verifies (per 2026-06-30 bugfix — broad scope means "all PAS agents",
 * not top-level `permission.skill`):
 *   - the broad scope fans out to every canonical PAS agent as a
 *     per-agent block, NEVER writing to top-level `permission.skill`
 *   - per-agent scope writes only to the named agent
 *   - top-level `permission.skill` (legacy/manual) is preserved by add
 *     and remove, and is never touched by clear
 *   - backup is created BEFORE the write
 *   - the pattern, action, scope, and agent fields are reflected in
 *     the resulting opencode.json
 *   - error paths (bad action, bad scope, missing --agent for agent
 *     scope) exit with a non-zero code and a clear message
 *   - --dry-run prints the resulting config without writing
 *   - native OpenCode wildcards are preserved verbatim
 *   - command failure leaves the original config intact
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'bun';
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const REPO_ROOT = join(import.meta.dir, '..', '..');

const PAS_AGENTS = [
  'Pulsar Agent Squad',
  'pas_researcher',
  'pas_developer',
  'pas_qa',
];

function makeTempConfigDir(): string {
  const dir = join(
    tmpdir(),
    'pas-skills-mut-int-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
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
  tempHome = makeTempConfigDir();
});

afterEach(() => {
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

describe('pas skills add — non-interactive', () => {
  it('default scope (all-pas) fans out the rule to every canonical PAS agent', () => {
    writeConfigFile(tempHome, {});
    const r = runPas(tempHome, ['skills', 'add', 'docs-writer', 'deny']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    // Top-level permission.skill is NEVER written by the broad scope.
    expect(after.permission?.skill).toBeUndefined();
    // Every canonical agent has the rule on its per-agent block.
    for (const name of PAS_AGENTS) {
      expect(after.agent?.[name]?.permission?.skill).toEqual({ 'docs-writer': 'deny' });
    }
  });

  it('explicit --scope all-pas fans out the rule to every canonical PAS agent', () => {
    writeConfigFile(tempHome, {});
    const r = runPas(tempHome, [
      'skills',
      'add',
      'git-*',
      'deny',
      '--scope',
      'all-pas',
    ]);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    expect(after.permission?.skill).toBeUndefined();
    for (const name of PAS_AGENTS) {
      expect(after.agent?.[name]?.permission?.skill).toEqual({ 'git-*': 'deny' });
    }
  });

  it('preserves legacy top-level `permission.skill` (the CLI does not manage it)', () => {
    writeConfigFile(tempHome, {
      permission: { skill: { '*': 'allow' } },
    });
    const r = runPas(tempHome, ['skills', 'add', 'docs-writer', 'deny']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    // Top-level is preserved as-is (no merge, no overwrite).
    expect(after.permission?.skill).toEqual({ '*': 'allow' });
    // The new rule landed on every canonical agent.
    for (const name of PAS_AGENTS) {
      expect(after.agent?.[name]?.permission?.skill).toEqual({ 'docs-writer': 'deny' });
    }
  });

  it('creates a backup file before writing', () => {
    writeConfigFile(tempHome, { default_agent: 'Pulsar Agent Squad' });
    const r = runPas(tempHome, ['skills', 'add', 'git-*', 'deny']);
    expect(r.exitCode).toBe(0);
    const files = listOpencodeDir(tempHome);
    // Expect opencode.json and at least one .bak.* file
    const backups = files.filter((f) => f.startsWith('opencode.json.bak.'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves native OpenCode wildcards (`*`, `?`) verbatim', () => {
    writeConfigFile(tempHome, {});
    const r = runPas(tempHome, ['skills', 'add', 'a*?b', 'allow']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    for (const name of PAS_AGENTS) {
      expect(after.agent?.[name]?.permission?.skill).toEqual({ 'a*?b': 'allow' });
    }
  });

  it('preserves other top-level config keys', () => {
    writeConfigFile(tempHome, {
      default_agent: 'Pulsar Agent Squad',
      provider: { cursor: { name: 'Cursor' } },
    });
    const r = runPas(tempHome, ['skills', 'add', 'git-*', 'deny']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    expect(after.default_agent).toBe('Pulsar Agent Squad');
    expect(after.provider).toEqual({ cursor: { name: 'Cursor' } });
    // Top-level permission.skill is NOT created by the broad scope.
    expect(after.permission?.skill).toBeUndefined();
    for (const name of PAS_AGENTS) {
      expect(after.agent?.[name]?.permission?.skill).toEqual({ 'git-*': 'deny' });
    }
  });

  it('adds a per-agent rule when --scope agent --agent <name> is provided', () => {
    writeConfigFile(tempHome, {});
    const r = runPas(tempHome, [
      'skills',
      'add',
      'git-*',
      'deny',
      '--scope',
      'agent',
      '--agent',
       'pas_developer',
    ]);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    expect(after.agent?.pas_developer?.permission?.skill).toEqual({ 'git-*': 'deny' });
    // No other agent is touched.
    for (const name of PAS_AGENTS) {
      if (name === 'pas_developer') continue;
      expect(after.agent?.[name]?.permission?.skill).toBeUndefined();
    }
  });

  it('appends to an existing per-agent skill block (broad scope)', () => {
    writeConfigFile(tempHome, {
       agent: { pas_developer: { permission: { skill: { '*': 'allow' } } } },
    });
    const r = runPas(tempHome, ['skills', 'add', 'docs-writer', 'deny']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    // pas_developer keeps its existing rule AND gets the new one.
    expect(after.agent?.pas_developer?.permission?.skill).toEqual({
      '*': 'allow',
      'docs-writer': 'deny',
    });
    // All other canonical agents get the new rule only.
    for (const name of PAS_AGENTS) {
      if (name === 'pas_developer') continue;
      expect(after.agent?.[name]?.permission?.skill).toEqual({ 'docs-writer': 'deny' });
    }
  });

  it('rejects an invalid action and does not write the config', () => {
    const file = writeConfigFile(tempHome, {});
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'add', 'docs-writer', 'bogus']);
    expect(r.exitCode).not.toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects --scope agent without --agent', () => {
    const file = writeConfigFile(tempHome, {});
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'add', 'docs-writer', 'deny', '--scope', 'agent']);
    expect(r.exitCode).not.toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects an unknown scope (the old `global` value)', () => {
    // The bugfix renames the broad scope `global` → `all-pas`. The old
    // value must be rejected, not silently treated as the broad scope.
    const file = writeConfigFile(tempHome, {});
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, [
      'skills',
      'add',
      'docs-writer',
      'deny',
      '--scope',
      'global',
    ]);
    expect(r.exitCode).not.toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects an empty pattern', () => {
    const file = writeConfigFile(tempHome, {});
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'add', '', 'deny']);
    expect(r.exitCode).not.toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('--dry-run prints the resulting config without writing', () => {
    const file = writeConfigFile(tempHome, {});
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'add', 'docs-writer', 'deny', '--dry-run']);
    expect(r.exitCode).toBe(0);
    // The dry-run output must contain the new rule on an agent block.
    expect(r.stdout).toMatch(/"docs-writer"/);
    // The actual file must NOT have changed
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
    // No backup should have been created either
    const files = listOpencodeDir(tempHome);
    expect(files.some((f) => f.startsWith('opencode.json.bak.'))).toBe(false);
  });
});

describe('pas skills remove — non-interactive', () => {
  it('default scope (all-pas) removes the pattern from every PAS agent', () => {
    writeConfigFile(tempHome, {
      agent: {
        pas_developer: { permission: { skill: { 'a': 'deny' } } },
        pas_qa: { permission: { skill: { 'a': 'deny' } } },
      },
    });
    const r = runPas(tempHome, ['skills', 'remove', 'a']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    expect(after.agent?.pas_developer?.permission?.skill).toBeUndefined();
    expect(after.agent?.pas_qa?.permission?.skill).toBeUndefined();
  });

  it('preserves top-level `permission.skill` (CLI does not manage it)', () => {
    writeConfigFile(tempHome, {
      permission: { skill: { '*': 'allow' } },
      agent: {
        pas_developer: { permission: { skill: { 'a': 'deny' } } },
      },
    });
    const r = runPas(tempHome, ['skills', 'remove', 'a']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    // Top-level is preserved verbatim.
    expect(after.permission?.skill).toEqual({ '*': 'allow' });
    // The per-agent rule is removed.
    expect(after.agent?.pas_developer?.permission?.skill).toBeUndefined();
  });

  it('creates a backup before writing', () => {
    writeConfigFile(tempHome, {
      agent: { pas_developer: { permission: { skill: { '*': 'allow' } } } },
    });
    const r = runPas(tempHome, ['skills', 'remove', '*']);
    expect(r.exitCode).toBe(0);
    const files = listOpencodeDir(tempHome);
    expect(files.some((f) => f.startsWith('opencode.json.bak.'))).toBe(true);
  });

  it('is a no-op (still exit 0) when the pattern does not exist', () => {
    writeConfigFile(tempHome, {
      agent: { pas_developer: { permission: { skill: { '*': 'allow' } } } },
    });
    const r = runPas(tempHome, ['skills', 'remove', 'no-such-pattern']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    expect(after.agent?.pas_developer?.permission?.skill).toEqual({ '*': 'allow' });
  });

  it('removes a per-agent rule', () => {
    writeConfigFile(tempHome, {
      agent: { pas_developer: { permission: { skill: { 'a': 'deny', 'b': 'ask' } } } },
    });
    const r = runPas(tempHome, [
      'skills',
      'remove',
      'a',
      '--scope',
      'agent',
      '--agent',
      'pas_developer',
    ]);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    expect(after.agent?.pas_developer?.permission?.skill).toEqual({ b: 'ask' });
  });

  it('--dry-run prints the resulting config without writing', () => {
    const file = writeConfigFile(tempHome, {
      agent: { pas_developer: { permission: { skill: { '*': 'allow', 'docs-writer': 'deny' } } } },
    });
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'remove', 'docs-writer', '--dry-run']);
    expect(r.exitCode).toBe(0);
    // The dry-run output must not contain the removed pattern.
    expect(r.stdout).not.toMatch(/"docs-writer"/);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects --scope agent without --agent', () => {
    const file = writeConfigFile(tempHome, {});
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'remove', '*', '--scope', 'agent']);
    expect(r.exitCode).not.toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects the old `global` scope value (bugfix renamed it to `all-pas`)', () => {
    const file = writeConfigFile(tempHome, {
      agent: { pas_developer: { permission: { skill: { 'a': 'deny' } } } },
    });
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'remove', 'a', '--scope', 'global']);
    expect(r.exitCode).not.toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });
});

describe('pas skills clear — non-interactive', () => {
  it('default scope (all) clears every PAS agent per-agent block, never touching top-level', () => {
    writeConfigFile(tempHome, {
      permission: { skill: { '*': 'allow' } },
      agent: {
        pas_developer: { permission: { skill: { 'a': 'deny' } } },
        pas_qa: { permission: { skill: { 'b': 'ask' } } },
      },
    });
    const r = runPas(tempHome, ['skills', 'clear']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    // Top-level is preserved (the CLI does not manage it).
    expect(after.permission?.skill).toEqual({ '*': 'allow' });
    // Per-agent blocks are cleared.
    expect(after.agent?.pas_developer?.permission).toBeUndefined();
    expect(after.agent?.pas_qa?.permission).toBeUndefined();
  });

  it('clears a single per-agent scope with --scope agent --agent <name>', () => {
    writeConfigFile(tempHome, {
      permission: { skill: { '*': 'allow' } },
      agent: {
        pas_developer: { permission: { skill: { 'a': 'deny' } } },
        pas_qa: { permission: { skill: { 'b': 'ask' } } },
      },
    });
    const r = runPas(tempHome, [
      'skills',
      'clear',
      '--scope',
      'agent',
      '--agent',
      'pas_developer',
    ]);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    // Top-level is preserved.
    expect(after.permission?.skill).toEqual({ '*': 'allow' });
    // Only the named agent is cleared.
    expect(after.agent?.pas_developer?.permission).toBeUndefined();
    expect(after.agent?.pas_qa?.permission?.skill).toEqual({ b: 'ask' });
  });

  it('clears every PAS agent per-agent block with --scope all-pas', () => {
    writeConfigFile(tempHome, {
      permission: { skill: { '*': 'allow' } },
      agent: {
        pas_developer: {
          permission: { skill: { 'docs-writer': 'deny' } },
          model: 'anthropic/claude-sonnet-4-6',
        },
      },
    });
    const r = runPas(tempHome, ['skills', 'clear', '--scope', 'all-pas']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    // Top-level is preserved.
    expect(after.permission?.skill).toEqual({ '*': 'allow' });
    // Per-agent block is cleared.
    expect(after.agent?.pas_developer?.permission).toBeUndefined();
    // The agent itself is kept if it had a model.
    expect(after.agent?.pas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('clears all (per-agent only) with --scope all', () => {
    writeConfigFile(tempHome, {
      permission: { skill: { '*': 'allow' } },
      agent: {
        pas_developer: {
          permission: { skill: { 'docs-writer': 'deny' } },
          model: 'anthropic/claude-sonnet-4-6',
        },
      },
    });
    const r = runPas(tempHome, ['skills', 'clear', '--scope', 'all']);
    expect(r.exitCode).toBe(0);
    const file = join(tempHome, '.config', 'opencode', 'opencode.json');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    // Top-level is preserved (the CLI does not manage it).
    expect(after.permission?.skill).toEqual({ '*': 'allow' });
    expect(after.agent?.pas_developer?.permission).toBeUndefined();
    expect(after.agent?.pas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('rejects the old `global` scope value (bugfix removed it for `clear`)', () => {
    const file = writeConfigFile(tempHome, {
      permission: { skill: { '*': 'allow' } },
    });
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'clear', '--scope', 'global']);
    expect(r.exitCode).not.toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('creates a backup before writing', () => {
    writeConfigFile(tempHome, {
      agent: { pas_developer: { permission: { skill: { '*': 'allow' } } } },
    });
    const r = runPas(tempHome, ['skills', 'clear']);
    expect(r.exitCode).toBe(0);
    const files = listOpencodeDir(tempHome);
    expect(files.some((f) => f.startsWith('opencode.json.bak.'))).toBe(true);
  });

  it('--dry-run prints the resulting config without writing', () => {
    const file = writeConfigFile(tempHome, {
      agent: { pas_developer: { permission: { skill: { '*': 'allow' } } } },
    });
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'clear', '--dry-run']);
    expect(r.exitCode).toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects an invalid scope', () => {
    const file = writeConfigFile(tempHome, {});
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'clear', '--scope', 'wrong']);
    expect(r.exitCode).not.toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects --scope agent without --agent', () => {
    const file = writeConfigFile(tempHome, {});
    const before = readFileSync(file, 'utf-8');
    const r = runPas(tempHome, ['skills', 'clear', '--scope', 'agent']);
    expect(r.exitCode).not.toBe(0);
    const after = readFileSync(file, 'utf-8');
    expect(after).toBe(before);
  });
});
