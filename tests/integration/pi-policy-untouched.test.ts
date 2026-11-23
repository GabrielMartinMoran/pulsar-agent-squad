import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { $ } from 'bun';

describe('Pi policy non-regression', () => {
  it('keeps Pi build artifacts byte-identical when an OpenCode tool policy exists', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pas-pi-policy-'));
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
    const target = 'dist/platforms/pi';
    try {
      expect((await $`bun run src/cli/index.ts build --target=pi`.env(env).quiet()).exitCode).toBe(0);
      const before = new Map<string, Buffer>();
      for (const path of ['agents/pas_researcher.md', 'agents/pas_developer.md', 'agents/pas_qa.md', 'settings.snippet.json', 'extensions/pas-toolkit/index.ts', 'extensions/pas-toolkit/core.ts']) before.set(path, readFileSync(join(target, path)));
      mkdirSync(join(home, '.config/opencode/pas'), { recursive: true });
      writeFileSync(join(home, '.config/opencode/pas/policies.json'), JSON.stringify({ version: 1, agents: { pas_engineer: { skills: {}, tools: ['shell'] } } }));
      expect((await $`bun run src/cli/index.ts build --target=pi`.env(env).quiet()).exitCode).toBe(0);
      for (const [path, bytes] of before) expect(readFileSync(join(target, path))).toEqual(bytes);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
