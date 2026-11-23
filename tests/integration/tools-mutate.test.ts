import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'bun';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadPolicyStore } from '../../src/cli/lib/policy-store';
import { PAS_AGENTS } from '../../src/cli/commands/agents/presenter';

describe('pas tools mutations', () => {
  it('blocks by default, normalizes aliases, unblocks selectively, and honors dry-run', () => {
    const home = mkdtempSync(join(tmpdir(), 'pas-tools-mutate-'));
    const run = (...args: string[]) => spawnSync(['bun', 'run', 'src/cli/index.ts', 'tools', ...args], { cwd: join(import.meta.dir, '../..'), env: { ...process.env, HOME: home } });
    try {
      const first = run('block', 'bash'); expect(first.exitCode).toBe(0); expect(first.stdout.toString()).toContain('bash → shell');
      let store = loadPolicyStore(home)!;
      expect(PAS_AGENTS.every((agent) => store.agents[agent]?.tools.includes('shell'))).toBe(true);
      const before = readFileSync(join(home, '.config/opencode/pas/policies.json'), 'utf8');
      expect(run('block', 'vendor_tool', '--dry-run').exitCode).toBe(0);
      expect(readFileSync(join(home, '.config/opencode/pas/policies.json'), 'utf8')).toBe(before);
      expect(run('unblock', 'shell', '--scope', 'agent', '--agent', PAS_AGENTS[0]).exitCode).toBe(0);
      store = loadPolicyStore(home)!;
      expect(Boolean(store.agents[PAS_AGENTS[0]]?.tools.includes('shell'))).toBe(false);
      expect(store.agents[PAS_AGENTS[1]]?.tools.includes('shell')).toBe(true);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
