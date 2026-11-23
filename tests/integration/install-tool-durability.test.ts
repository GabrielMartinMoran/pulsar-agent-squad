import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { $ } from 'bun';

describe('tool policy install durability', () => {
  it('reinstall restores the stored deny and uninstall preserves the store', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-policy-install-'));
    const home = join(root, 'home');
    const installRoot = join(root, 'installed');
    mkdirSync(join(home, '.config/opencode/pas'), { recursive: true });
    const store = join(home, '.config/opencode/pas/policies.json');
    writeFileSync(store, JSON.stringify({ version: 1, agents: { pas_engineer: { skills: {}, tools: ['webfetch'] } } }));
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
    const installed = join(installRoot, '.config/opencode/agents/pas_engineer.md');
    try {
      const first = await $`bun run src/cli/index.ts install --target=opencode --destdir=${installRoot}`.env(env).quiet();
      expect(first.exitCode).toBe(0);
      expect(readFileSync(installed, 'utf8')).toContain('  - action: webfetch\n    resource: "*"\n    effect: deny');
      writeFileSync(installed, 'hand edit');
      const second = await $`bun run src/cli/index.ts install --target=opencode --destdir=${installRoot}`.env(env).quiet();
      expect(second.exitCode).toBe(0);
      expect(readFileSync(installed, 'utf8')).not.toBe('hand edit');
      expect(readFileSync(installed, 'utf8')).toContain('effect: deny');
      const bytes = readFileSync(store);
      const removed = await $`bun run src/cli/index.ts uninstall --target=opencode --dest=${join(installRoot, '.config/opencode/agents')} --plugins-dest=${join(installRoot, '.config/opencode/plugins')}`.env(env).quiet();
      expect(removed.exitCode).toBe(0);
      expect(existsSync(installed)).toBe(false);
      expect(readFileSync(store)).toEqual(bytes);
      const third = await $`bun run src/cli/index.ts install --target=opencode --destdir=${installRoot}`.env(env).quiet();
      expect(third.exitCode).toBe(0);
      expect(readFileSync(installed, 'utf8')).toContain('  - action: webfetch\n    resource: "*"\n    effect: deny');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
