import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'bun';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PAS_AGENTS } from '../../src/cli/commands/agents/presenter';

describe('pas tools list', () => {
  it('prints each canonical agent and current blocks without writing', () => {
    const home = mkdtempSync(join(tmpdir(), 'pas-tools-list-'));
    try {
      const dir = join(home, '.config/opencode/pas'); mkdirSync(dir, { recursive: true });
      const file = join(dir, 'policies.json');
      writeFileSync(file, JSON.stringify({ version: 1, agents: { [PAS_AGENTS[0]]: { skills: {}, tools: ['shell'] } } }));
      const before = readFileSync(file, 'utf8');
      const result = spawnSync(['bun', 'run', 'src/cli/index.ts', 'tools', 'list', '--plain'], { cwd: join(import.meta.dir, '../..'), env: { ...process.env, HOME: home } });
      expect(result.exitCode).toBe(0);
      const output = result.stdout.toString();
      for (const agent of PAS_AGENTS) expect(output).toContain(agent);
      expect(output).toContain('shell'); expect(output).toContain('(none)');
      expect(output).toContain('●'); expect(output).toContain('○');
      expect(output).not.toContain('\x1b[');
      expect(readFileSync(file, 'utf8')).toBe(before);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
