import { afterAll, describe, expect, it } from 'bun:test';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { $ } from 'bun';
import {
  INSTALL_INVENTORY_FILENAME,
  hashBytes,
  type InstallInventory,
} from '../../src/cli/lib/install-inventory';

const CLI_ENTRY = 'src/cli/index.ts';
const REPO_ROOT = join(import.meta.dir, '..', '..');
const TMP_ROOT = '/tmp/opencode';

mkdirSync(TMP_ROOT, { recursive: true });
const SURFACE_HOME = mkdtempSync(join(TMP_ROOT, 'pas-install-surface-home-'));
const SURFACE_ENV = fixtureEnv(SURFACE_HOME);
afterAll(() => {
  rmSync(SURFACE_HOME, { recursive: true, force: true });
});

function makeTmp(prefix: string): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, prefix));
}

/**
 * Minimal disposable copy of the repository so install tests can delete or
 * stale `dist/` without touching the checkout that runs the suite. The
 * manifest resolves relative to `src/cli/lib`, so the copy needs `src/`,
 * `config/`, `package.json`, and the dependency directory.
 */
function createFixtureRepo(): string {
  const root = makeTmp('pas-install-repo-');
  cpSync(join(REPO_ROOT, 'src'), join(root, 'src'), { recursive: true });
  cpSync(join(REPO_ROOT, 'config'), join(root, 'config'), { recursive: true });
  cpSync(join(REPO_ROOT, 'package.json'), join(root, 'package.json'));
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

/**
 * Isolated runtime inputs: HOME never points at the user's real profile and a
 * missing OpenCode config path keeps builds byte-identical to their sources.
 */
function fixtureEnv(home: string): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    PAS_OPENCODE_CONFIG_PATH: join(home, 'missing-opencode.json'),
  };
}

function runInFixture(
  fixture: string,
  home: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = $`bun run ${CLI_ENTRY} ${args}`.cwd(fixture).env(fixtureEnv(home)).quiet().nothrow();
  return result.then((r) => ({
    exitCode: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
  }));
}

/**
 * Content-and-type snapshot used to prove a preview wrote neither the
 * destination nor the fixture build output.
 */
function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  if (!existsSync(root)) return snapshot;

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        snapshot[relative] = `symlink:${readlinkSync(path)}`;
      } else if (entry.isDirectory()) {
        walk(path, relative);
      } else {
        snapshot[relative] = `file:${hashBytes(readFileSync(path))}`;
      }
    }
  };

  walk(root, '');
  return snapshot;
}

function readInventory(path: string): InstallInventory {
  return JSON.parse(readFileSync(path, 'utf-8')) as InstallInventory;
}

const OPENCODE_AGENTS = [
  'Pulsar Agent Squad.md',
  'Pulsar Agent Turbo.md',
  'pas_developer.md',
  'pas_qa.md',
  'pas_researcher.md',
];

describe('install command', () => {
  it('should show help for install command', async () => {
    const result = await $`bun run ${CLI_ENTRY} install --help`.env(SURFACE_ENV).quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('--target');
    expect(result.stdout.toString()).toContain('--dry-run');
    expect(result.stdout.toString()).toContain('--destdir');
  });

  it('should print DRY-RUN lines for install --target=opencode --dry-run', async () => {
    // Dry-run never builds; make sure the existing artifacts are present.
    await $`bun run ${CLI_ENTRY} build --target=opencode`.env(SURFACE_ENV).quiet();

    const result = await $`bun run ${CLI_ENTRY} install --target=opencode --dry-run`.env(SURFACE_ENV).quiet();
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain('DRY-RUN');
    expect(stdout).toContain('.config/opencode/agents');
  });

  it('should print the DRY-RUN copy line for the pas-toolkit plugin', async () => {
    // Dry-run never builds; make sure the existing artifacts are present.
    await $`bun run ${CLI_ENTRY} build --target=opencode`.env(SURFACE_ENV).quiet();

    const result = await $`bun run ${CLI_ENTRY} install --target=opencode --dry-run`.env(SURFACE_ENV).quiet();
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain('pas-toolkit.ts');
    expect(stdout).toContain('.config/opencode/plugins');
  });

  it('should install the plugin to a --destdir fixture byte-identical to source', async () => {
    // No explicit build: a real install builds the selected artifacts itself.
    const destdir = makeTmp('pas-install-fixture-');
    try {
      const result = await $`bun run ${CLI_ENTRY} install --target=opencode --destdir=${destdir}`.env(SURFACE_ENV).quiet();
      expect(result.exitCode).toBe(0);

      const installed = join(destdir, '.config/opencode/plugins/pas-toolkit.ts');
      expect(existsSync(installed)).toBe(true);

      const plugin = readFileSync(installed);
      const source = readFileSync('src/tools/pas-toolkit.ts');
      expect(plugin.equals(source)).toBe(true);
    } finally {
      rmSync(destdir, { recursive: true, force: true });
    }
  });

  it('should fail for unknown target', async () => {
    const result = await $`bun run ${CLI_ENTRY} install --target=nonexistent`.env(SURFACE_ENV).quiet().nothrow();
    expect(result.exitCode).not.toBe(0);
  });

  it('dry-run reports missing artifacts clearly and writes neither dist nor destination', async () => {
    const fixture = createFixtureRepo();
    const home = makeTmp('pas-install-home-');
    const dest = makeTmp('pas-install-dest-');
    try {
      const result = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        '--dry-run',
        `--destdir=${dest}`,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('missing built artifact');
      expect(result.stderr).toContain("pas build --target=opencode");
      // Dry-run is a preview: it neither rebuilds dist nor writes the destination.
      expect(existsSync(join(fixture, 'dist'))).toBe(false);
      expect(readdirSync(dest)).toEqual([]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  /**
   * Scenario D1 (`@integration`): a real install builds the selected
   * artifacts from source before any copy. Stale dist is replaced, unrelated
   * targets and destinations are preserved.
   */
  it('builds fresh selected artifacts before copying and preserves other targets', async () => {
    const fixture = createFixtureRepo();
    const home = makeTmp('pas-install-home-');
    const dest = makeTmp('pas-install-dest-');
    try {
      const staleAgents = join(fixture, 'dist/platforms/opencode/agents');
      mkdirSync(staleAgents, { recursive: true });
      writeFileSync(join(staleAgents, 'stale-agent.md'), 'stale');
      writeFileSync(join(staleAgents, 'pas_developer.md'), 'STALE');

      const otherTarget = join(fixture, 'dist/platforms/cursor/AGENTS.md');
      mkdirSync(dirname(otherTarget), { recursive: true });
      writeFileSync(otherTarget, 'keep me');

      const result = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        `--destdir=${dest}`,
      ]);

      expect(result.exitCode).toBe(0);
      // Fresh build: stale artifacts are gone from dist.
      expect(existsSync(join(staleAgents, 'stale-agent.md'))).toBe(false);

      // The copied artifacts match the fixture sources, not the stale dist.
      const installedDeveloper = readFileSync(
        join(dest, '.config/opencode/agents/pas_developer.md'),
        'utf-8',
      );
      const sourceDeveloper = readFileSync(
        join(fixture, 'src/agents/pas_developer.md'),
        'utf-8',
      );
      expect(installedDeveloper).toBe(sourceDeveloper);

      const installedAgents = readdirSync(join(dest, '.config/opencode/agents'))
        .filter((name) => name.endsWith('.md'))
        .sort();
      expect(installedAgents).toEqual([
        'Pulsar Agent Squad.md',
        'Pulsar Agent Turbo.md',
        'pas_developer.md',
        'pas_qa.md',
        'pas_researcher.md',
      ]);

      const installedPlugin = readFileSync(
        join(dest, '.config/opencode/plugins/pas-toolkit.ts'),
      );
      const sourcePlugin = readFileSync(join(fixture, 'src/tools/pas-toolkit.ts'));
      expect(installedPlugin.equals(sourcePlugin)).toBe(true);

      // Only the selected target is built and installed.
      expect(existsSync(otherTarget)).toBe(true);
      expect(readFileSync(otherTarget, 'utf-8')).toBe('keep me');
      expect(existsSync(join(dest, '.cursor'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  /**
   * Scenario D1 (`@integration`): a failed build leaves the install
   * destination unchanged.
   */
  it('leaves the destination unchanged when the selected build fails', async () => {
    const fixture = createFixtureRepo();
    const home = makeTmp('pas-install-home-');
    const dest = makeTmp('pas-install-dest-');
    try {
      // Remove a required source directory so the selected build fails.
      rmSync(join(fixture, 'src/agents'), { recursive: true, force: true });

      const userAgents = join(dest, '.config/opencode/agents');
      mkdirSync(userAgents, { recursive: true });
      writeFileSync(join(userAgents, 'user-agent.md'), 'mine');
      writeFileSync(join(dest, 'keep.txt'), 'keep');

      const result = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        `--destdir=${dest}`,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('build failed');
      // No destination write happened.
      expect(readFileSync(join(userAgents, 'user-agent.md'), 'utf-8')).toBe('mine');
      expect(readdirSync(userAgents)).toEqual(['user-agent.md']);
      expect(readdirSync(dest).sort()).toEqual(['.config', 'keep.txt']);
      expect(existsSync(join(dest, '.config/opencode/plugins'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  /**
   * Scenario D5 (`@integration`): the inventory is local to the selected
   * destination. A preview writes nothing; a changed roster retires only
   * verified unmodified files; edited, symlinked, unowned and user files stay;
   * uninstall removes only what the destination inventory still owns.
   */
  it('prunes only destination-local recorded retired agents and preserves user files', async () => {
    const fixture = createFixtureRepo();
    const home = makeTmp('pas-install-home-');
    const dest = makeTmp('pas-install-dest-');
    const agentsDest = join(dest, '.config/opencode/agents');
    const pluginsDest = join(dest, '.config/opencode/plugins');
    const inventoryPath = join(agentsDest, INSTALL_INVENTORY_FILENAME);
    try {
      const first = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        `--destdir=${dest}`,
      ]);
      expect(first.exitCode).toBe(0);

      // The inventory records exactly the copied regular agent files with
      // the digest of the destination bytes.
      const firstInventory = readInventory(inventoryPath);
      expect(firstInventory.files.map((entry) => entry.name).sort()).toEqual(
        [...OPENCODE_AGENTS].sort(),
      );
      for (const entry of firstInventory.files) {
        expect(hashBytes(readFileSync(join(agentsDest, entry.name)))).toBe(
          entry.sha256,
        );
      }

      // User and PAS-like files that PAS did not install are not owned.
      writeFileSync(join(agentsDest, 'user-agent.md'), 'mine');
      writeFileSync(join(agentsDest, 'pas_unowned.md'), 'not installed by PAS');

      // A recorded file edited after install, and a recorded file replaced
      // with a symlink, must never be pruned or followed.
      writeFileSync(join(agentsDest, 'pas_researcher.md'), 'edited by hand');
      const externalTarget = join(dest, 'external-target.md');
      writeFileSync(externalTarget, 'external content');
      rmSync(join(agentsDest, 'pas_qa.md'));
      symlinkSync(externalTarget, join(agentsDest, 'pas_qa.md'));

      // Changed roster: three files retire; one new agent ships.
      for (const retired of [
        'pas_developer.md',
        'pas_qa.md',
        'pas_researcher.md',
      ]) {
        rmSync(join(fixture, 'src/agents', retired));
      }
      writeFileSync(
        join(fixture, 'src/agents', 'pas_new.md'),
        '---\nname: pas_new\n---\n# New agent\n',
      );

      const beforePreviewDest = snapshotTree(agentsDest);
      const beforePreviewDist = snapshotTree(
        join(fixture, 'dist/platforms/opencode'),
      );

      const preview = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        '--dry-run',
        `--destdir=${dest}`,
      ]);
      expect(preview.exitCode).toBe(0);
      expect(preview.stdout).toContain('DRY-RUN');
      expect(snapshotTree(agentsDest)).toEqual(beforePreviewDest);
      expect(snapshotTree(join(fixture, 'dist/platforms/opencode'))).toEqual(
        beforePreviewDist,
      );

      const second = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        `--destdir=${dest}`,
      ]);
      expect(second.exitCode).toBe(0);

      // Only the recorded unmodified retired file was pruned.
      expect(existsSync(join(agentsDest, 'pas_developer.md'))).toBe(false);
      expect(readFileSync(join(agentsDest, 'pas_researcher.md'), 'utf-8')).toBe(
        'edited by hand',
      );
      expect(readFileSync(join(agentsDest, 'pas_qa.md'), 'utf-8')).toBe(
        'external content',
      );
      expect(readFileSync(join(agentsDest, 'user-agent.md'), 'utf-8')).toBe('mine');
      expect(readFileSync(join(agentsDest, 'pas_unowned.md'), 'utf-8')).toBe(
        'not installed by PAS',
      );
      expect(existsSync(join(agentsDest, 'pas_new.md'))).toBe(true);

      // Protected records survive the reinstall with their original digest, so
      // a later uninstall can still recognize them as PAS-owned.
      const secondInventory = readInventory(inventoryPath);
      expect(secondInventory.files.map((entry) => entry.name).sort()).toEqual([
        'Pulsar Agent Squad.md',
        'Pulsar Agent Turbo.md',
        'pas_new.md',
        'pas_qa.md',
        'pas_researcher.md',
      ]);
      for (const protectedName of ['pas_qa.md', 'pas_researcher.md']) {
        expect(
          secondInventory.files.find((entry) => entry.name === protectedName)
            ?.sha256,
        ).toBe(
          firstInventory.files.find((entry) => entry.name === protectedName)
            ?.sha256,
        );
      }

      const uninstall = await runInFixture(fixture, home, [
        'uninstall',
        `--dest=${agentsDest}`,
        `--plugins-dest=${pluginsDest}`,
      ]);
      expect(uninstall.exitCode).toBe(0);

      // Inventory-owned files and the plugin are gone; everything else stays.
      for (const shipped of [
        'Pulsar Agent Squad.md',
        'Pulsar Agent Turbo.md',
        'pas_new.md',
      ]) {
        expect(existsSync(join(agentsDest, shipped))).toBe(false);
      }
      expect(existsSync(inventoryPath)).toBe(true);
      expect(readInventory(inventoryPath).files.map((entry) => entry.name).sort()).toEqual([
        'pas_qa.md',
        'pas_researcher.md',
      ]);
      expect(existsSync(join(pluginsDest, 'pas-toolkit.ts'))).toBe(false);
      expect(readFileSync(join(agentsDest, 'pas_researcher.md'), 'utf-8')).toBe(
        'edited by hand',
      );
      expect(readFileSync(join(agentsDest, 'pas_qa.md'), 'utf-8')).toBe(
        'external content',
      );
      expect(readFileSync(externalTarget, 'utf-8')).toBe('external content');
      expect(readFileSync(join(agentsDest, 'user-agent.md'), 'utf-8')).toBe('mine');
      expect(readFileSync(join(agentsDest, 'pas_unowned.md'), 'utf-8')).toBe(
        'not installed by PAS',
      );

      // A repeated uninstall must keep using the retained records instead of
      // falling back to name-based canonical cleanup.
      const repeatedUninstall = await runInFixture(fixture, home, [
        'uninstall',
        `--dest=${agentsDest}`,
        `--plugins-dest=${pluginsDest}`,
      ]);
      expect(repeatedUninstall.exitCode).toBe(0);
      expect(readFileSync(join(agentsDest, 'pas_researcher.md'), 'utf-8')).toBe(
        'edited by hand',
      );
      expect(lstatSync(join(agentsDest, 'pas_qa.md')).isSymbolicLink()).toBe(true);
      expect(readFileSync(externalTarget, 'utf-8')).toBe('external content');
      expect(readFileSync(join(agentsDest, 'user-agent.md'), 'utf-8')).toBe('mine');
      expect(readFileSync(join(agentsDest, 'pas_unowned.md'), 'utf-8')).toBe(
        'not installed by PAS',
      );
      expect(readInventory(inventoryPath).files.map((entry) => entry.name).sort()).toEqual([
        'pas_qa.md',
        'pas_researcher.md',
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('fails on a malformed inventory before writing or deleting anything', async () => {
    const fixture = createFixtureRepo();
    const home = makeTmp('pas-install-home-');
    const dest = makeTmp('pas-install-dest-');
    const agentsDest = join(dest, '.config/opencode/agents');
    try {
      mkdirSync(agentsDest, { recursive: true });
      writeFileSync(join(agentsDest, 'pas_developer.md'), 'hand written');
      writeFileSync(
        join(agentsDest, INSTALL_INVENTORY_FILENAME),
        '{"version":1,"files":[{"name":"../escape.md","sha256":"bad"}]}',
      );
      const before = snapshotTree(dest);

      const result = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        `--destdir=${dest}`,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('invalid install inventory');
      expect(snapshotTree(dest)).toEqual(before);
      expect(existsSync(join(fixture, 'dist'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  /**
   * Scenario D5 (`@integration`): a symbolic link at a shipped agent path is a
   * conflict. The installer must report it and abort before copying anything,
   * without following the link or touching its target.
   */
  it('rejects a symbolic link at a shipped agent path before copying', async () => {
    const fixture = createFixtureRepo();
    const home = makeTmp('pas-install-home-');
    const dest = makeTmp('pas-install-dest-');
    const agentsDest = join(dest, '.config/opencode/agents');
    const inventoryPath = join(agentsDest, INSTALL_INVENTORY_FILENAME);
    try {
      const first = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        `--destdir=${dest}`,
      ]);
      expect(first.exitCode).toBe(0);

      // A later reinstall finds one shipped path replaced by a link.
      const externalTarget = join(dest, 'external-target.md');
      writeFileSync(externalTarget, 'external content');
      rmSync(join(agentsDest, 'pas_developer.md'));
      symlinkSync(externalTarget, join(agentsDest, 'pas_developer.md'));
      const inventoryBefore = readFileSync(inventoryPath);
      const before = snapshotTree(dest);

      const result = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        `--destdir=${dest}`,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('conflicting path');
      expect(result.stderr).toContain(join(agentsDest, 'pas_developer.md'));
      // Nothing was copied, pruned, or recorded, and the link target is intact.
      expect(snapshotTree(dest)).toEqual(before);
      expect(readFileSync(inventoryPath)).toEqual(inventoryBefore);
      expect(lstatSync(join(agentsDest, 'pas_developer.md')).isSymbolicLink()).toBe(
        true,
      );
      expect(readFileSync(externalTarget, 'utf-8')).toBe('external content');
      expect(existsSync(join(agentsDest, 'Pulsar Agent Squad.md'))).toBe(true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('rejects a symbolic link as the OpenCode agents directory', async () => {
    const fixture = createFixtureRepo();
    const home = makeTmp('pas-install-home-');
    const dest = makeTmp('pas-install-dest-');
    const opencodeDest = join(dest, '.config/opencode');
    const agentsDest = join(opencodeDest, 'agents');
    try {
      mkdirSync(opencodeDest, { recursive: true });
      const realAgents = join(dest, 'real-agents');
      mkdirSync(realAgents);
      symlinkSync(realAgents, agentsDest);
      const before = snapshotTree(dest);

      const result = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        `--destdir=${dest}`,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('conflicting path');
      expect(result.stderr).toContain(agentsDest);
      expect(snapshotTree(dest)).toEqual(before);
      expect(lstatSync(agentsDest).isSymbolicLink()).toBe(true);
      expect(readdirSync(realAgents)).toEqual([]);
      expect(existsSync(join(dest, '.config/opencode/plugins/pas-toolkit.ts'))).toBe(
        false,
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('rejects a non-regular file at a shipped agent path before copying', async () => {
    const fixture = createFixtureRepo();
    const home = makeTmp('pas-install-home-');
    const dest = makeTmp('pas-install-dest-');
    const agentsDest = join(dest, '.config/opencode/agents');
    try {
      mkdirSync(join(agentsDest, 'pas_qa.md'), { recursive: true });
      const before = snapshotTree(dest);

      const result = await runInFixture(fixture, home, [
        'install',
        '--target=opencode',
        `--destdir=${dest}`,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('conflicting path');
      expect(result.stderr).toContain(join(agentsDest, 'pas_qa.md'));
      expect(snapshotTree(dest)).toEqual(before);
      expect(lstatSync(join(agentsDest, 'pas_qa.md')).isDirectory()).toBe(true);
      expect(existsSync(join(agentsDest, 'pas_developer.md'))).toBe(false);
      expect(existsSync(join(agentsDest, INSTALL_INVENTORY_FILENAME))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });
});
