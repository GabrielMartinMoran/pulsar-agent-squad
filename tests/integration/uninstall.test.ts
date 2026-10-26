import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { $ } from 'bun';

const CLI_ENTRY = 'src/cli/index.ts';

describe('uninstall command', () => {
  const tempAgentsDir = join(process.env.HOME!, '.config/opencode/agents-pas-test-tmp');

  beforeAll(() => {
    // Create a temp agents dir with canonical agent files for testing
    if (existsSync(tempAgentsDir)) {
      rmSync(tempAgentsDir, { recursive: true, force: true });
    }
    mkdirSync(tempAgentsDir, { recursive: true });

    const content = '---\nname: test\n---\n# Test';
    const agents = [
      'Pulsar Agent Squad.md',
      'Pulsar Turbo.md',
      'pas_researcher.md',
      'pas_developer.md',
      'pas_qa.md',
    ];
    for (const agent of agents) {
      writeFileSync(join(tempAgentsDir, agent), content);
    }
  });

  afterAll(() => {
    if (existsSync(tempAgentsDir)) {
      rmSync(tempAgentsDir, { recursive: true, force: true });
    }
  });

  it('should show "DRY-RUN: rm" lines for PAS agent files with --dry-run', async () => {
    const result = await $`bun run ${CLI_ENTRY} uninstall --dry-run --dest=${tempAgentsDir}`.quiet();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('DRY-RUN: rm');
     expect(stdout).toContain('Pulsar Agent Squad.md');
     expect(stdout).toContain('Pulsar Turbo.md');
     expect(stdout).toContain('pas_researcher.md');
     expect(stdout).toContain('pas_developer.md');
     expect(stdout).toContain('pas_qa.md');
  });

  it('should exit 0 on dry-run', async () => {
    const result = await $`bun run ${CLI_ENTRY} uninstall --dry-run --dest=${tempAgentsDir}`.quiet();
    expect(result.exitCode).toBe(0);
  });

  it('should show removal confirmation lines', async () => {
    const result = await $`bun run ${CLI_ENTRY} uninstall --dry-run --dest=${tempAgentsDir}`.quiet();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('Uninstalling');
  });
});

describe('uninstall command: pas-toolkit plugin', () => {
  let fixtureRoot = '';
  let fixtureAgentsDir = '';
  let fixturePluginsDir = '';
  let fixturePlugin = '';
  let unrelatedPlugin = '';

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'pas-uninstall-fixture-'));
    fixtureAgentsDir = join(fixtureRoot, 'agents');
    fixturePluginsDir = join(fixtureRoot, 'plugins');
    mkdirSync(fixtureAgentsDir, { recursive: true });
    mkdirSync(fixturePluginsDir, { recursive: true });

    const agentContent = '---\nname: test\n---\n# Test';
    for (const agent of [
      'Pulsar Agent Squad.md',
      'Pulsar Turbo.md',
      'pas_researcher.md',
      'pas_developer.md',
      'pas_qa.md',
    ]) {
      writeFileSync(join(fixtureAgentsDir, agent), agentContent);
    }

    fixturePlugin = join(fixturePluginsDir, 'pas-toolkit.ts');
    writeFileSync(fixturePlugin, '// pas-toolkit fixture\n');
    unrelatedPlugin = join(fixturePluginsDir, 'unrelated-plugin.js');
    writeFileSync(unrelatedPlugin, '// unrelated plugin fixture\n');
  });

  afterAll(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('should print the plugin DRY-RUN line and keep every fixture file', async () => {
    const result = await $`bun run ${CLI_ENTRY} uninstall --dry-run --dest=${fixtureAgentsDir} --plugins-dest=${fixturePluginsDir}`.quiet();
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain(`DRY-RUN: rm '${fixturePlugin}'`);

    expect(existsSync(fixturePlugin)).toBe(true);
    expect(existsSync(unrelatedPlugin)).toBe(true);
    expect(existsSync(join(fixtureAgentsDir, 'pas_developer.md'))).toBe(true);
    expect(existsSync(join(fixtureAgentsDir, 'Pulsar Turbo.md'))).toBe(true);
  });

  it('should remove the plugin file but keep the plugins directory and siblings', async () => {
    const result = await $`bun run ${CLI_ENTRY} uninstall --dest=${fixtureAgentsDir} --plugins-dest=${fixturePluginsDir}`.quiet();
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain(`✓ Removed: ${fixturePlugin}`);

    expect(existsSync(fixturePlugin)).toBe(false);
    expect(existsSync(fixturePluginsDir)).toBe(true);
    expect(existsSync(unrelatedPlugin)).toBe(true);
  });
});
