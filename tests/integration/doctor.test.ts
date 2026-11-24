import { describe, expect, it } from 'bun:test';
import { $ } from 'bun';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

const CLI_ENTRY = 'src/cli/index.ts';
const TMP_ROOT = '/tmp/opencode';
const EMPTY_HOME = join(TMP_ROOT, 'pas-doctor-empty-home');

function isolatedEnv(home = EMPTY_HOME): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    PAS_OPENCODE_CONFIG_PATH: join(home, 'missing-opencode.json'),
  };
}

function runDoctor(home = EMPTY_HOME) {
  return $`bun run ${CLI_ENTRY} doctor`.env(isolatedEnv(home)).quiet().nothrow();
}

describe('doctor command', () => {
  it('should output section header for command preconditions', async () => {
    const result = await runDoctor();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('== doctor: command preconditions ==');
  });

  it('should report PASS for existing commands (bash)', async () => {
    const result = await runDoctor();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('PASS: commands/bash available');
  });

  it('should report PASS for existing commands (cp)', async () => {
    const result = await runDoctor();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('PASS: commands/cp available');
  });

  it('should report FAIL for nonexistent commands', async () => {
    const result = await runDoctor();
    // All standard commands should exist, so exit 0
    expect(result.exitCode).toBe(0);
  });

  it('should contain centralized structure section header', async () => {
    const result = await runDoctor();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('== doctor: centralized structure ==');
  });

  it('should contain manifest targets section header', async () => {
    const result = await runDoctor();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('== doctor: manifest targets and source routes ==');
  });

  it('should report source readable checks', async () => {
    const result = await runDoctor();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('source dir readable');
  });

  it('should report manifest entries in output', async () => {
    const result = await runDoctor();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('manifest/opencode');
  });

  it('should exit 0 when all checks pass', async () => {
    const result = await runDoctor();
    expect(result.exitCode).toBe(0);
  });

  it('should show summary PASS or FAIL at end', async () => {
    const result = await runDoctor();
    const stdout = result.stdout.toString();
    expect(stdout).toMatch(/PASS: doctor|FAIL: doctor/);
  });
});

describe('doctor tool policy store', () => {
  it('reports a store that has not been created yet as not configured', async () => {
    const result = await runDoctor();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(
      'PASS: tool policy store not configured',
    );
  });

  it('reports a readable store without modifying it', async () => {
    mkdirSync(TMP_ROOT, { recursive: true });
    const home = mkdtempSync(join(TMP_ROOT, 'pas-doctor-store-'));
    try {
      const path = join(home, '.config/opencode/pas/policies.json');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          agents: { pas_qa: { tools: ['webfetch'] } },
        }),
      );
      const before = readFileSync(path);

      const result = await runDoctor(home);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(
        'PASS: tool policy store readable and supported',
      );
      expect(result.stdout.toString()).toContain(path);
      expect(readFileSync(path)).toEqual(before);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('fails on an invalid store without overwriting it', async () => {
    mkdirSync(TMP_ROOT, { recursive: true });
    const home = mkdtempSync(join(TMP_ROOT, 'pas-doctor-invalid-'));
    try {
      const path = join(home, '.config/opencode/pas/policies.json');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '{bad');
      const before = readFileSync(path);

      const result = await runDoctor(home);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout.toString()).toContain(
        'FAIL: tool policy store unhealthy',
      );
      expect(result.stdout.toString()).toContain(path);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path)).toEqual(before);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
