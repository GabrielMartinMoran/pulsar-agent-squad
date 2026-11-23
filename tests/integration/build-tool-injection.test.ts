import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { $ } from 'bun';

const home = join(tmpdir(), `pas-tool-build-${Date.now()}`);
const agents = ['Pulsar Agent Squad.md', 'Pulsar Agent Turbo.md', 'pas_copilot.md', 'pas_engineer.md', 'pas_researcher.md'];
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
const dist = 'dist/platforms/opencode/agents';

beforeAll(() => {
  mkdirSync(join(home, '.config/opencode/pas'), { recursive: true });
  writeFileSync(join(home, '.config/opencode/pas/policies.json'), JSON.stringify({ version: 1, agents: Object.fromEntries(agents.map((file) => [file.replace(/\.md$/, ''), { skills: {}, tools: ['shell'] }])) }));
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('OpenCode tool policy build', () => {
  it('injects stored denies into every canonical agent deterministically', async () => {
    const first = await $`bun run src/cli/index.ts build --target=opencode`.env(env).quiet();
    expect(first.exitCode).toBe(0);
    const bytes = agents.map((file) => readFileSync(join(dist, file)));
    for (let i = 0; i < agents.length; i++) {
      const content = bytes[i]!.toString();
      expect(content).toContain('  - action: shell\n    resource: "*"\n    effect: deny');
      const frontmatter = content.slice(content.indexOf('\n') + 1, content.indexOf('\n---', 4));
      expect(frontmatter.lastIndexOf('  - action: shell')).toBe(frontmatter.lastIndexOf('  - action: shell\n    resource: "*"\n    effect: deny'));
    }
    const second = await $`bun run src/cli/index.ts build --target=opencode`.env(env).quiet();
    expect(second.exitCode).toBe(0);
    expect(agents.map((file) => readFileSync(join(dist, file)))).toEqual(bytes);
  });
});
