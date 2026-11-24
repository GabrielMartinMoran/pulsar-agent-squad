import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { $ } from 'bun';
import {
  INSTALL_INVENTORY_FILENAME,
  hashBytes,
  type InstallInventory,
} from '../../src/cli/lib/install-inventory';

const CLI_ENTRY = 'src/cli/index.ts';
const TMP_ROOT = '/tmp/opencode';
const CANONICAL_AGENTS = [
  'Pulsar Agent Squad.md',
  'Pulsar Agent Turbo.md',
  'pas_researcher.md',
  'pas_developer.md',
  'pas_qa.md',
];

function makeFixture(): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, 'pas-uninstall-'));
}

/**
 * Isolated runtime inputs for every uninstall subprocess. HOME resolves inside
 * the fixture, so neither default destination can reach the real profile.
 * PATH stays inherited so `bun` still comes from the test runner environment.
 */
function fixtureEnv(root: string): Record<string, string | undefined> {
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    PAS_OPENCODE_CONFIG_PATH: join(home, 'missing-opencode.json'),
  };
}

function runUninstall(root: string, args: string[]) {
  return $`bun run ${CLI_ENTRY} uninstall ${args}`
    .env(fixtureEnv(root))
    .quiet()
    .nothrow();
}

function seedInventory(
  dir: string,
  entries: Array<{ name: string; sha256: string }>,
): void {
  const inventory: InstallInventory = { version: 1, files: entries };
  writeFileSync(
    join(dir, INSTALL_INVENTORY_FILENAME),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
}

describe('uninstall command', () => {
  let fixtureRoot = '';
  let agentsDir = '';
  let pluginsDir = '';

  beforeAll(() => {
    // Unique fixture per run: setup and cleanup never touch the real profile.
    fixtureRoot = makeFixture();
    agentsDir = join(fixtureRoot, 'agents');
    pluginsDir = join(fixtureRoot, 'plugins');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(pluginsDir, { recursive: true });

    const content = '---\nname: test\n---\n# Test';
    for (const agent of CANONICAL_AGENTS) {
      writeFileSync(join(agentsDir, agent), content);
    }
  });

  afterAll(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('should show "DRY-RUN: rm" lines for PAS agent files with --dry-run', async () => {
    const result = await runUninstall(fixtureRoot, [
      '--dry-run',
      `--dest=${agentsDir}`,
      `--plugins-dest=${pluginsDir}`,
    ]);
    const stdout = result.stdout.toString();
    expect(stdout).toContain('DRY-RUN: rm');
    expect(stdout).toContain('Pulsar Agent Squad.md');
    expect(stdout).toContain('Pulsar Agent Turbo.md');
    expect(stdout).toContain('pas_researcher.md');
    expect(stdout).toContain('pas_developer.md');
    expect(stdout).toContain('pas_qa.md');
  });

  it('should exit 0 on dry-run', async () => {
    const result = await runUninstall(fixtureRoot, [
      '--dry-run',
      `--dest=${agentsDir}`,
      `--plugins-dest=${pluginsDir}`,
    ]);
    expect(result.exitCode).toBe(0);
  });

  it('should show removal confirmation lines', async () => {
    const result = await runUninstall(fixtureRoot, [
      '--dry-run',
      `--dest=${agentsDir}`,
      `--plugins-dest=${pluginsDir}`,
    ]);
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
    fixtureRoot = makeFixture();
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
    const result = await runUninstall(fixtureRoot, [
      '--dry-run',
      `--dest=${fixtureAgentsDir}`,
      `--plugins-dest=${fixturePluginsDir}`,
    ]);
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain(`DRY-RUN: rm '${fixturePlugin}'`);

    expect(existsSync(fixturePlugin)).toBe(true);
    expect(existsSync(unrelatedPlugin)).toBe(true);
    expect(existsSync(join(fixtureAgentsDir, 'pas_developer.md'))).toBe(true);
    expect(existsSync(join(fixtureAgentsDir, 'Pulsar Agent Turbo.md'))).toBe(true);
  });

  it('should remove the plugin file but keep the plugins directory and siblings', async () => {
    const result = await runUninstall(fixtureRoot, [
      `--dest=${fixtureAgentsDir}`,
      `--plugins-dest=${fixturePluginsDir}`,
    ]);
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain(`✓ Removed: ${fixturePlugin}`);

    expect(existsSync(fixturePlugin)).toBe(false);
    expect(existsSync(fixturePluginsDir)).toBe(true);
    expect(existsSync(unrelatedPlugin)).toBe(true);
  });
});

describe('uninstall command: destination inventory', () => {
  it('removes only recorded unmodified files and preserves edited, symlinked and unowned files', async () => {
    const root = makeFixture();
    const agentsDir = join(root, 'agents');
    const pluginsDir = join(root, 'plugins');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(pluginsDir, { recursive: true });

    try {
      const recorded = new Map<string, string>();
      for (const agent of CANONICAL_AGENTS) {
        const content = `installed ${agent}`;
        writeFileSync(join(agentsDir, agent), content);
        recorded.set(agent, hashBytes(content));
      }
      seedInventory(
        agentsDir,
        [...recorded].map(([name, sha256]) => ({ name, sha256 })),
      );

      // Edited after install; the record no longer matches.
      writeFileSync(join(agentsDir, 'pas_qa.md'), 'edited after install');

      // Replaced with a symlink; it must be preserved and never followed.
      const external = join(root, 'external.md');
      writeFileSync(external, 'external content');
      rmSync(join(agentsDir, 'pas_researcher.md'));
      symlinkSync(external, join(agentsDir, 'pas_researcher.md'));

      writeFileSync(join(agentsDir, 'user-agent.md'), 'mine');
      writeFileSync(join(agentsDir, 'pas_unowned.md'), 'not recorded');

      const plugin = join(pluginsDir, 'pas-toolkit.ts');
      writeFileSync(plugin, '// pas-toolkit fixture\n');
      const unrelatedPlugin = join(pluginsDir, 'unrelated.js');
      writeFileSync(unrelatedPlugin, '// unrelated\n');

      const result = await runUninstall(root, [
        `--dest=${agentsDir}`,
        `--plugins-dest=${pluginsDir}`,
      ]);
      expect(result.exitCode).toBe(0);

      for (const removed of [
        'Pulsar Agent Squad.md',
        'Pulsar Agent Turbo.md',
        'pas_developer.md',
      ]) {
        expect(existsSync(join(agentsDir, removed))).toBe(false);
      }
      expect(readFileSync(join(agentsDir, 'pas_qa.md'), 'utf-8')).toBe(
        'edited after install',
      );
      expect(lstatSync(join(agentsDir, 'pas_researcher.md')).isSymbolicLink()).toBe(
        true,
      );
      expect(readFileSync(external, 'utf-8')).toBe('external content');
      expect(readFileSync(join(agentsDir, 'user-agent.md'), 'utf-8')).toBe('mine');
      expect(readFileSync(join(agentsDir, 'pas_unowned.md'), 'utf-8')).toBe(
        'not recorded',
      );
      expect(existsSync(plugin)).toBe(false);
      expect(existsSync(unrelatedPlugin)).toBe(true);

      // The uninstall keeps ownership records for the files it preserved, so
      // a later run still cannot treat them as unowned canonical names.
      const inventory = JSON.parse(
        readFileSync(join(agentsDir, INSTALL_INVENTORY_FILENAME), 'utf-8'),
      ) as InstallInventory;
      expect(inventory.files.map((entry) => entry.name).sort()).toEqual([
        'pas_qa.md',
        'pas_researcher.md',
      ]);
      expect(inventory.files.find((entry) => entry.name === 'pas_qa.md')?.sha256).toBe(
        recorded.get('pas_qa.md'),
      );
      expect(
        inventory.files.find((entry) => entry.name === 'pas_researcher.md')
          ?.sha256,
      ).toBe(recorded.get('pas_researcher.md'));

      // A repeated uninstall keeps both protected files and their original
      // records instead of falling back to name-based canonical cleanup.
      const repeated = await runUninstall(root, [
        `--dest=${agentsDir}`,
        `--plugins-dest=${pluginsDir}`,
      ]);
      expect(repeated.exitCode).toBe(0);
      expect(readFileSync(join(agentsDir, 'pas_qa.md'), 'utf-8')).toBe(
        'edited after install',
      );
      expect(lstatSync(join(agentsDir, 'pas_researcher.md')).isSymbolicLink()).toBe(
        true,
      );
      expect(readFileSync(external, 'utf-8')).toBe('external content');
      expect(readFileSync(join(agentsDir, 'user-agent.md'), 'utf-8')).toBe('mine');
      expect(readFileSync(join(agentsDir, 'pas_unowned.md'), 'utf-8')).toBe(
        'not recorded',
      );

      const repeatedInventory = JSON.parse(
        readFileSync(join(agentsDir, INSTALL_INVENTORY_FILENAME), 'utf-8'),
      ) as InstallInventory;
      expect(
        repeatedInventory.files.map((entry) => entry.name).sort(),
      ).toEqual(['pas_qa.md', 'pas_researcher.md']);
      for (const name of ['pas_qa.md', 'pas_researcher.md']) {
        expect(
          repeatedInventory.files.find((entry) => entry.name === name)?.sha256,
        ).toBe(recorded.get(name));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('retains an empty inventory marker so a repeated uninstall never falls back to canonical names', async () => {
    const root = makeFixture();
    const agentsDir = join(root, 'agents');
    const pluginsDir = join(root, 'plugins');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(pluginsDir, { recursive: true });

    try {
      const recorded = new Map<string, string>();
      for (const agent of CANONICAL_AGENTS) {
        const content = `installed ${agent}`;
        writeFileSync(join(agentsDir, agent), content);
        recorded.set(agent, hashBytes(content));
      }
      seedInventory(
        agentsDir,
        [...recorded].map(([name, sha256]) => ({ name, sha256 })),
      );

      const first = await runUninstall(root, [
        `--dest=${agentsDir}`,
        `--plugins-dest=${pluginsDir}`,
      ]);
      expect(first.exitCode).toBe(0);
      for (const agent of CANONICAL_AGENTS) {
        expect(existsSync(join(agentsDir, agent))).toBe(false);
      }

      // The marker stays valid with zero records: the destination keeps its
      // installed-state distinction after PAS-owned files are gone.
      const emptyInventory = JSON.parse(
        readFileSync(join(agentsDir, INSTALL_INVENTORY_FILENAME), 'utf-8'),
      ) as InstallInventory;
      expect(emptyInventory).toEqual({ version: 1, files: [] });

      // Files the user creates later with canonical PAS names are not owned.
      writeFileSync(join(agentsDir, 'pas_developer.md'), 'user recreated');
      writeFileSync(join(agentsDir, 'Pulsar Agent Squad.md'), 'user squad');
      writeFileSync(join(agentsDir, 'user-agent.md'), 'mine');

      const repeated = await runUninstall(root, [
        `--dest=${agentsDir}`,
        `--plugins-dest=${pluginsDir}`,
      ]);
      expect(repeated.exitCode).toBe(0);
      expect(readFileSync(join(agentsDir, 'pas_developer.md'), 'utf-8')).toBe(
        'user recreated',
      );
      expect(readFileSync(join(agentsDir, 'Pulsar Agent Squad.md'), 'utf-8')).toBe(
        'user squad',
      );
      expect(readFileSync(join(agentsDir, 'user-agent.md'), 'utf-8')).toBe('mine');

      const repeatedInventory = JSON.parse(
        readFileSync(join(agentsDir, INSTALL_INVENTORY_FILENAME), 'utf-8'),
      ) as InstallInventory;
      expect(repeatedInventory).toEqual({ version: 1, files: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the pre-inventory canonical fallback exactly and never widens it', async () => {
    const root = makeFixture();
    const agentsDir = join(root, 'agents');
    mkdirSync(agentsDir, { recursive: true });

    try {
      for (const agent of CANONICAL_AGENTS) {
        writeFileSync(join(agentsDir, agent), `legacy ${agent}`);
      }
      writeFileSync(join(agentsDir, 'pas_unowned.md'), 'unowned');
      writeFileSync(join(agentsDir, 'user-agent.md'), 'mine');

      const result = await runUninstall(root, [
        `--dest=${agentsDir}`,
        `--plugins-dest=${join(root, 'plugins')}`,
      ]);
      expect(result.exitCode).toBe(0);

      for (const agent of CANONICAL_AGENTS) {
        expect(existsSync(join(agentsDir, agent))).toBe(false);
      }
      expect(readFileSync(join(agentsDir, 'pas_unowned.md'), 'utf-8')).toBe('unowned');
      expect(readFileSync(join(agentsDir, 'user-agent.md'), 'utf-8')).toBe('mine');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails on a malformed inventory without deleting agents or the plugin', async () => {
    const root = makeFixture();
    const agentsDir = join(root, 'agents');
    const pluginsDir = join(root, 'plugins');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(pluginsDir, { recursive: true });

    try {
      writeFileSync(join(agentsDir, 'pas_developer.md'), 'hand written');
      writeFileSync(join(agentsDir, 'user-agent.md'), 'mine');
      writeFileSync(
        join(agentsDir, INSTALL_INVENTORY_FILENAME),
        '{"version":1,"files":[{"name":"../escape.md","sha256":"bad"}]}',
      );
      const plugin = join(pluginsDir, 'pas-toolkit.ts');
      writeFileSync(plugin, '// plugin\n');

      const result = await runUninstall(root, [
        `--dest=${agentsDir}`,
        `--plugins-dest=${pluginsDir}`,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain('invalid install inventory');
      expect(readFileSync(join(agentsDir, 'pas_developer.md'), 'utf-8')).toBe(
        'hand written',
      );
      expect(readFileSync(join(agentsDir, 'user-agent.md'), 'utf-8')).toBe('mine');
      expect(existsSync(plugin)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not follow a symlinked inventory file', async () => {
    const root = makeFixture();
    const agentsDir = join(root, 'agents');
    mkdirSync(agentsDir, { recursive: true });

    try {
      const content = 'installed developer';
      writeFileSync(join(agentsDir, 'pas_developer.md'), content);
      const realInventory = join(root, 'real-inventory.json');
      writeFileSync(
        realInventory,
        JSON.stringify({
          version: 1,
          files: [{ name: 'pas_developer.md', sha256: hashBytes(content) }],
        }),
      );
      symlinkSync(realInventory, join(agentsDir, INSTALL_INVENTORY_FILENAME));

      const result = await runUninstall(root, [
        `--dest=${agentsDir}`,
        `--plugins-dest=${join(root, 'plugins')}`,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain('not a regular file');
      expect(readFileSync(join(agentsDir, 'pas_developer.md'), 'utf-8')).toBe(
        content,
      );
      expect(lstatSync(join(agentsDir, INSTALL_INVENTORY_FILENAME)).isSymbolicLink()).toBe(
        true,
      );
      expect(existsSync(realInventory)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
