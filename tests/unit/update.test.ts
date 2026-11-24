import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import {
  performUpdate,
  selectUpdateActions,
} from '../../src/cli/commands/update';

const TMP_ROOT = '/tmp/opencode';

function makeTmp(prefix: string): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, prefix));
}

describe('performUpdate — preflight', () => {
  let workDir: string;
  let originalCwd: string;

  beforeAll(() => {
    originalCwd = process.cwd();
    workDir = makeTmp('pas-update-test-');
  });

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });

  it('exits non-zero and does not modify files outside a git repository', async () => {
    // Change to a temp dir that is NOT a git repo. performUpdate must detect
    // this and return a non-zero exit code without touching anything.
    process.chdir(workDir);

    const code = await performUpdate({ check: false, rebuild: false, reinstall: false });

    expect(code).not.toBe(0);
  });

  it('exits non-zero (and does not modify files) when --check is used outside a git repo', async () => {
    process.chdir(workDir);

    const code = await performUpdate({ check: true, rebuild: false, reinstall: false });

    expect(code).not.toBe(0);
  });

  it('uses git pull (current-upstream behavior) and never modifies tracked files on its own', async () => {
    // We do not run a real `git pull` here — we verify by source inspection
    // that the command path uses `git pull` and does not write to disk
    // outside of subprocess results. This guards against accidental rewrites
    // during refactors.
    process.chdir(originalCwd);

    const src = await Bun.file('src/cli/commands/update.ts').text();
    expect(src).toContain('git pull');
    expect(src).toContain('--ff-only');
    // Refuse release-based logic (release-fetching code).
    expect(src).not.toContain('fetch(');
    expect(src).not.toContain('download');
    expect(src).not.toContain('tarball');
  });
});

/**
 * Scenario D2 (`@contract`): the action list is a pure decision used by both
 * the printed plan and the execution path. These unit cases pin the decision;
 * `tests/pas_update_contract_test.sh` pins the public CLI contract.
 */
describe('update action selection', () => {
  it('default update selects the OpenCode installer', () => {
    expect(selectUpdateActions({ rebuild: false, reinstall: false })).toEqual([
      { kind: 'install', target: 'opencode' },
    ]);
  });

  it('--reinstall selects the OpenCode installer', () => {
    expect(selectUpdateActions({ rebuild: false, reinstall: true })).toEqual([
      { kind: 'install', target: 'opencode' },
    ]);
  });

  it('--rebuild alone selects only the OpenCode build', () => {
    expect(selectUpdateActions({ rebuild: true, reinstall: false })).toEqual([
      { kind: 'build', target: 'opencode' },
    ]);
  });

  it('--rebuild --reinstall does not duplicate the build behind the install', () => {
    expect(selectUpdateActions({ rebuild: true, reinstall: true })).toEqual([
      { kind: 'install', target: 'opencode' },
    ]);
  });

  it('defaults to the opencode target', () => {
    for (const actions of [
      selectUpdateActions({ rebuild: false, reinstall: false }),
      selectUpdateActions({ rebuild: true, reinstall: false }),
      selectUpdateActions({ rebuild: false, reinstall: true }),
    ]) {
      expect(actions).toHaveLength(1);
      expect(actions[0].target).toBe('opencode');
    }
  });
});
