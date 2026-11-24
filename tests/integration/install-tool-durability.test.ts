import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'bun';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const TMP_ROOT = '/tmp/opencode';
const CLI_ENTRY = 'src/cli/index.ts';

let root = '';
let home = '';
let installRoot = '';
let storePath = '';
let configPath = '';
let agentsDir = '';

function env(): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    PAS_OPENCODE_CONFIG_PATH: configPath,
  };
}

function run(args: string[]) {
  return spawnSync(['bun', 'run', CLI_ENTRY, ...args], {
    cwd: root,
    env: env(),
  });
}

beforeAll(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
  root = mkdtempSync(join(TMP_ROOT, 'pas-tool-install-repo-'));
  home = join(root, 'home');
  installRoot = join(root, 'installed');
  storePath = join(home, '.config/opencode/pas/policies.json');
  configPath = join(home, '.config/opencode/opencode.json');
  agentsDir = join(installRoot, '.config/opencode/agents');

  // The fixture ships the same five legacy agents as the real project.
  cpSync(join(REPO_ROOT, 'src'), join(root, 'src'), { recursive: true });
  cpSync(join(REPO_ROOT, 'config'), join(root, 'config'), { recursive: true });
  cpSync(join(REPO_ROOT, 'package.json'), join(root, 'package.json'));
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');

  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(
    storePath,
    JSON.stringify({
      version: 1,
      agents: {
        pas_developer: { tools: ['shell'] },
        pas_qa: { tools: ['webfetch'] },
      },
    }),
  );
  writeFileSync(
    configPath,
    '{\n  "default_agent": "Pulsar Agent Squad",\n  "unrelated": {"keep": true}\n}\n',
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('tool policy install durability', () => {
  it('installs stored denies in legacy format and does not discard unrelated settings', () => {
    const configBefore = readFileSync(configPath);
    const storeBefore = readFileSync(storePath);

    const first = run([
      'install',
      '--target=opencode',
      `--destdir=${installRoot}`,
    ]);
    expect(first.exitCode).toBe(0);

    const installed = readFileSync(join(agentsDir, 'pas_qa.md'), 'utf8');
    expect(installed).toMatch(/^ {2}webfetch: deny$/m);
    expect(installed).toMatch(/^ {2}bash: allow$/m);
    expect(installed).not.toContain('\npermissions:');

    const installedDeveloper = readFileSync(
      join(agentsDir, 'pas_developer.md'),
      'utf8',
    );
    expect(installedDeveloper).toMatch(/^ {2}bash: deny$/m);
    expect(installedDeveloper).toContain('    "specs/**/*.feature": deny');

    // The five-agent roster is installed; only the selected files changed.
    for (const file of [
      'Pulsar Agent Squad.md',
      'Pulsar Agent Turbo.md',
      'pas_developer.md',
      'pas_qa.md',
      'pas_researcher.md',
    ]) {
      expect(existsSync(join(agentsDir, file))).toBe(true);
    }

    expect(readFileSync(configPath)).toEqual(configBefore);
    expect(readFileSync(storePath)).toEqual(storeBefore);

    // A reinstall regenerates the deny even after a hand edit.
    writeFileSync(join(agentsDir, 'pas_qa.md'), 'hand edit');
    const second = run([
      'install',
      '--target=opencode',
      `--destdir=${installRoot}`,
    ]);
    expect(second.exitCode).toBe(0);
    const reinstalled = readFileSync(join(agentsDir, 'pas_qa.md'), 'utf8');
    expect(reinstalled).not.toBe('hand edit');
    expect(reinstalled).toMatch(/^ {2}webfetch: deny$/m);

    // Uninstall removes the owned agent files but never the policy store or
    // unrelated OpenCode settings.
    const removed = run([
      'uninstall',
      `--dest=${agentsDir}`,
      `--plugins-dest=${join(installRoot, '.config/opencode/plugins')}`,
    ]);
    expect(removed.exitCode).toBe(0);
    expect(existsSync(join(agentsDir, 'pas_qa.md'))).toBe(false);
    expect(readFileSync(storePath)).toEqual(storeBefore);
    expect(readFileSync(configPath)).toEqual(configBefore);

    // A later install re-applies the stored deny.
    const third = run([
      'install',
      '--target=opencode',
      `--destdir=${installRoot}`,
    ]);
    expect(third.exitCode).toBe(0);
    expect(readFileSync(join(agentsDir, 'pas_qa.md'), 'utf8')).toMatch(
      /^ {2}webfetch: deny$/m,
    );
    expect(readFileSync(join(agentsDir, 'pas_developer.md'), 'utf8')).toMatch(
      /^ {2}bash: deny$/m,
    );
    expect(readFileSync(storePath)).toEqual(storeBefore);
    expect(readFileSync(configPath)).toEqual(configBefore);
  });
});
