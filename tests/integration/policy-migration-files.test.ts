import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'bun';
import { loadOrMigratePolicyStore } from '../../src/cli/lib/policy-migration';

describe('policy migration filesystem boundary', () => {
  it('migrates once and leaves opencode.json bytes untouched', () => {
    const home = mkdtempSync(join(tmpdir(), 'pas-policy-migration-'));
    const configPath = join(home, '.config/opencode/opencode.json');
    const oldHome = process.env.HOME;
    const oldXdg = process.env.XDG_CONFIG_HOME;
    try {
      mkdirSync(join(home, '.config/opencode'), { recursive: true });
      const original = '{"agent":{"worker":{"permission":{"skill":{"doc-*":"deny"}}}}}\n';
      writeFileSync(configPath, original);
      process.env.HOME = home;
      process.env.XDG_CONFIG_HOME = join(home, '.config');
      expect(loadOrMigratePolicyStore(home).migrated).toBe(true);
      expect(loadOrMigratePolicyStore(home).migrated).toBe(false);
      expect(readFileSync(configPath, 'utf8')).toBe(original);
      expect(JSON.parse(readFileSync(join(home, '.config/opencode/pas/policies.json'), 'utf8')).agents.worker.skills).toEqual({ 'doc-*': 'deny' });
    } finally {
      if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
      if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('hard-fails build and install dry-run on a malformed policy store', () => {
    const home = mkdtempSync(join(tmpdir(), 'pas-policy-invalid-'));
    try {
      const path = join(home, '.config/opencode/pas/policies.json');
      mkdirSync(join(home, '.config/opencode/pas'), { recursive: true });
      writeFileSync(path, '{bad');
      for (const args of [['build', '--target=opencode'], ['install', '--target=opencode', '--dry-run']]) {
        const result = spawnSync(['bun', 'run', 'src/cli/index.ts', ...args], {
          cwd: join(import.meta.dir, '../..'), env: { ...process.env, HOME: home }, stdout: 'pipe', stderr: 'pipe',
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr.toString()).toContain(path);
        expect(result.stderr.toString()).toContain('Malformed JSON');
      }
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
