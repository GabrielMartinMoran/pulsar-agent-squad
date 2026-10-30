import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs';
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
      'Pulsar Agent Turbo.md',
      'pas_researcher.md',
      'pas_developer.md',
      'pas_engineer.md',
      'pas_copilot.md',
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
     expect(stdout).toContain('Pulsar Agent Turbo.md');
     expect(stdout).toContain('pas_researcher.md');
     expect(stdout).toContain('pas_developer.md');
     expect(stdout).toContain('pas_engineer.md');
     expect(stdout).toContain('pas_copilot.md');
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
      'Pulsar Agent Turbo.md',
      'pas_researcher.md',
      'pas_developer.md',
      'pas_engineer.md',
      'pas_copilot.md',
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
    expect(existsSync(join(fixtureAgentsDir, 'Pulsar Agent Turbo.md'))).toBe(true);
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

// ---------------------------------------------------------------------------
// Opencode target uninstall from a real install
// ---------------------------------------------------------------------------

describe('@integration opencode uninstall', () => {
  it('@integration Uninstall removes every shipped agent from a real installed roster', async () => {
    const built = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(built.exitCode).toBe(0);

    const root = mkdtempSync(join(tmpdir(), 'pas-opencode-uninstall-'));
    const home = join(root, 'home');
    const agentsDir = join(home, '.config/opencode/agents');
    const pluginsDir = join(home, '.config/opencode/plugins');

    try {
      // Real install into an isolated HOME; never the user's ~/.config.
      const install = await $`bun run ${CLI_ENTRY} install --target=opencode --destdir=${home}`.quiet();
      expect(install.exitCode).toBe(0);
      expect(existsSync(agentsDir)).toBe(true);

      const shippedAgents = readdirSync(agentsDir).filter((file) => file.endsWith('.md'));
      expect(shippedAgents).toEqual(
        expect.arrayContaining(['pas_engineer.md', 'pas_copilot.md', 'pas_researcher.md']),
      );
      expect(existsSync(join(pluginsDir, 'pas-toolkit.ts'))).toBe(true);

      // Simulate a machine that still holds the pre-copiloted legacy names.
      for (const legacy of ['pas_developer.md', 'pas_qa.md']) {
        writeFileSync(join(agentsDir, legacy), '# legacy agent\n');
      }
      // An unrelated user agent must survive uninstall.
      const unrelated = join(agentsDir, 'user-custom-agent.md');
      writeFileSync(unrelated, '# custom agent\n');

      const result = await $`bun run ${CLI_ENTRY} uninstall --dest=${agentsDir} --plugins-dest=${pluginsDir}`.quiet();
      expect(result.exitCode).toBe(0);

      // No PAS agent file — shipped or legacy — may remain.
      for (const agent of [...shippedAgents, 'pas_developer.md', 'pas_qa.md']) {
        expect(existsSync(join(agentsDir, agent))).toBe(false);
      }
      expect(existsSync(join(pluginsDir, 'pas-toolkit.ts'))).toBe(false);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Pi target uninstall
// ---------------------------------------------------------------------------

describe('@integration Pi uninstall', () => {
  const STUB_PI = `#!/usr/bin/env bash
set -u
case "$1" in
  --version) echo "pi 1.0.0"; exit 0 ;;
  list) echo "Installed packages:"; exit 0 ;;
  install) echo "installed $2"; exit 0 ;;
esac
exit 0
`;

  it('@integration Uninstall removes only Pi artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pas-pi-uninstall-'));
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    mkdirSync(home, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const stub = join(bin, 'pi');
    writeFileSync(stub, STUB_PI);
    chmodSync(stub, 0o755);

    try {
      const install = await $`bun run ${CLI_ENTRY} install --target=pi`
        .env({ HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, PI_LOG: join(root, 'pi.log') })
        .quiet();
      expect(install.exitCode).toBe(0);

      const installedAgent = join(home, '.pi/agent/agents/pas_developer.md');
      expect(existsSync(installedAgent)).toBe(true);

      // An unrelated file in the same directory must survive uninstall.
      const unrelated = join(home, '.pi/agent/agents/user-custom-agent.md');
      writeFileSync(unrelated, '# custom agent\n');

      const result = await $`bun run ${CLI_ENTRY} uninstall --target=pi --destdir=${home}`.quiet();
      expect(result.exitCode).toBe(0);

      expect(existsSync(installedAgent)).toBe(false);
      expect(existsSync(join(home, '.pi/agent/agents/pas_qa.md'))).toBe(false);
      expect(existsSync(join(home, '.pi/agent/skills/pas-lead/SKILL.md'))).toBe(false);
      expect(existsSync(join(home, '.pi/agent/pas-settings.snippet.json'))).toBe(false);
      expect(existsSync(join(home, '.pi/agent/extensions/pas-toolkit/index.ts'))).toBe(false);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('@integration Uninstall is idempotent on a second run', async () => {
    const built = await $`bun run ${CLI_ENTRY} build --target=pi`.quiet();
    expect(built.exitCode).toBe(0);

    const root = mkdtempSync(join(tmpdir(), 'pas-pi-uninstall-twice-'));
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    mkdirSync(home, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const stub = join(bin, 'pi');
    writeFileSync(stub, STUB_PI);
    chmodSync(stub, 0o755);

    try {
      const install = await $`bun run ${CLI_ENTRY} install --target=pi`
        .env({ HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, PI_LOG: join(root, 'pi.log') })
        .quiet();
      expect(install.exitCode).toBe(0);

      const installedAgent = join(home, '.pi/agent/agents/pas_developer.md');
      const unrelated = join(home, '.pi/agent/agents/user-custom-agent.md');
      writeFileSync(unrelated, '# custom agent\n');

      const first = await $`bun run ${CLI_ENTRY} uninstall --target=pi --destdir=${home}`.quiet();
      expect(first.exitCode).toBe(0);
      expect(first.stdout.toString()).toContain(`✓ Removed: ${installedAgent}`);

      const second = await $`bun run ${CLI_ENTRY} uninstall --target=pi --destdir=${home}`.quiet();
      expect(second.exitCode).toBe(0);
      expect(second.stdout.toString()).toContain('Not found (skipped):');
      expect(second.stdout.toString()).not.toContain('✓ Removed:');

      expect(existsSync(installedAgent)).toBe(false);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
