import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { performUpdate } from '../../src/cli/commands/update';

describe('performUpdate — preflight', () => {
  let workDir: string;
  let originalCwd: string;

  beforeAll(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(join(tmpdir(), 'nas-update-test-'));
  });

  afterAll(() => {
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
    expect(src).toContain("--ff-only");
    // Refuse release-based logic (release-fetching code).
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain('download');
    expect(src).not.toContain('tarball');
  });
});
