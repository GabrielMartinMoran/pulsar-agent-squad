import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'bun';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { PAS_AGENTS } from '../../src/cli/commands/agents/presenter';
import { loadToolPolicyStore } from '../../src/cli/lib/policy-store';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const TMP_ROOT = '/tmp/opencode';

function makeHome(prefix: string): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, prefix));
}

function policyPath(home: string): string {
  return join(home, '.config', 'opencode', 'pas', 'policies.json');
}

function envFor(home: string): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    PAS_OPENCODE_CONFIG_PATH: join(home, 'missing-opencode.json'),
  };
}

function run(home: string, args: string[]) {
  return spawnSync(
    ['bun', 'run', 'src/cli/index.ts', 'tools', ...args],
    { cwd: REPO_ROOT, env: envFor(home) },
  );
}

describe('pas tools mutations', () => {
  it('lists every PAS agent without creating the store', () => {
    const home = makeHome('pas-tools-list-');
    try {
      const result = run(home, ['list', '--plain']);
      expect(result.exitCode).toBe(0);
      const stdout = result.stdout.toString();
      for (const agent of PAS_AGENTS) expect(stdout).toContain(agent);
      expect(stdout).toContain('(none)');
      expect(existsSync(policyPath(home))).toBe(false);
      expect(existsSync(join(home, '.config'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('blocks by default, normalizes aliases, unblocks selectively, and clears', () => {
    const home = makeHome('pas-tools-mutate-');
    try {
      const first = run(home, ['block', 'bash']);
      expect(first.exitCode).toBe(0);
      expect(first.stdout.toString()).toContain('bash');
      expect(first.stdout.toString()).toContain('shell');

      let store = loadToolPolicyStore(policyPath(home));
      expect(store).not.toBeNull();
      for (const agent of PAS_AGENTS) {
        expect(store?.agents[agent]?.tools).toEqual(['shell']);
      }

      const before = readFileSync(policyPath(home), 'utf8');
      expect(run(home, ['block', 'shell']).exitCode).toBe(0);
      expect(readFileSync(policyPath(home), 'utf8')).toBe(before);

      expect(
        run(home, [
          'block',
          'webfetch',
          '--scope',
          'agent',
          '--agent',
          'pas_qa',
        ]).exitCode,
      ).toBe(0);
      expect(
        run(home, [
          'unblock',
          'shell',
          '--scope',
          'agent',
          '--agent',
          'pas_qa',
        ]).exitCode,
      ).toBe(0);

      store = loadToolPolicyStore(policyPath(home));
      expect(store?.agents.pas_qa?.tools).toEqual(['webfetch']);
      expect(store?.agents.pas_developer?.tools).toEqual(['shell']);

      expect(run(home, ['clear']).exitCode).toBe(0);
      expect(loadToolPolicyStore(policyPath(home))).toEqual({
        version: 1,
        agents: {},
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('previews a mutation with --dry-run without writing', () => {
    const home = makeHome('pas-tools-dry-');
    try {
      const result = run(home, ['block', 'edit', '--dry-run']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('"edit"');
      expect(existsSync(policyPath(home))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects a non-deny effect and an invalid identifier without writing', () => {
    const home = makeHome('pas-tools-deny-only-');
    try {
      const allow = run(home, ['block', 'shell', '--effect', 'allow']);
      expect(allow.exitCode).not.toBe(0);
      expect(allow.stderr.toString()).toMatch(/deny-only/i);
      expect(existsSync(policyPath(home))).toBe(false);

      const wildcard = run(home, ['block', '*']);
      expect(wildcard.exitCode).not.toBe(0);
      expect(wildcard.stderr.toString()).toMatch(/Invalid tool identifier/);
      expect(existsSync(policyPath(home))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('reports an invalid store without overwriting it', () => {
    const home = makeHome('pas-tools-invalid-');
    try {
      const path = policyPath(home);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '{bad');
      const before = readFileSync(path);

      const block = run(home, ['block', 'shell']);
      expect(block.exitCode).not.toBe(0);
      expect(block.stderr.toString()).toContain(path);
      expect(readFileSync(path)).toEqual(before);

      const list = run(home, ['list']);
      expect(list.exitCode).not.toBe(0);
      expect(list.stderr.toString()).toContain(path);
      expect(readFileSync(path)).toEqual(before);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('leaves the OpenCode configuration byte-identical', () => {
    const home = makeHome('pas-tools-config-');
    try {
      const config = join(home, '.config', 'opencode', 'opencode.json');
      mkdirSync(dirname(config), { recursive: true });
      writeFileSync(config, '{\n  "default_agent": "Pulsar Agent Squad"\n}\n');
      const before = readFileSync(config);

      expect(run(home, ['block', 'shell']).exitCode).toBe(0);
      expect(readFileSync(config)).toEqual(before);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
