import { beforeAll, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { $ } from 'bun';

const CLI_ENTRY = 'src/cli/index.ts';

const OPENCODE_AGENTS_DIST = 'dist/platforms/opencode/agents';

/** The roster the current build ships to OpenCode. */
const SHIPPED_AGENTS = [
  'Pulsar Agent Squad.md',
  'Pulsar Agent Turbo.md',
  'pas_copilot.md',
  'pas_engineer.md',
  'pas_researcher.md',
];

interface HomeFixture {
  root: string;
  home: string;
}

function makeHomeFixture(): HomeFixture {
  const root = mkdtempSync(join(tmpdir(), 'pas-install-prune-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  return { root, home };
}

function opencodeAgentsDir(home: string): string {
  return join(home, '.config/opencode/agents');
}

/** Seed `dir` with placeholder agent files and return it. */
function seedAgentFiles(dir: string, names: string[]): string {
  mkdirSync(dir, { recursive: true });
  for (const name of names) writeFileSync(join(dir, name), `# ${name} seeded\n`);
  return dir;
}

function installOpencode(home: string, extraArgs: string[] = []) {
  return $`${process.execPath} run ${CLI_ENTRY} install --target=opencode --destdir=${home} ${extraArgs}`
    .nothrow()
    .quiet();
}

describe('@integration opencode install pruning', () => {
  beforeAll(async () => {
    const built = await $`${process.execPath} run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(built.exitCode).toBe(0);
  });

  it('@integration removes retired pas_ agents and keeps the shipped roster', async () => {
    const fixture = makeHomeFixture();
    try {
      const agentsDir = seedAgentFiles(opencodeAgentsDir(fixture.home), [
        'pas_developer.md',
        'pas_qa.md',
      ]);

      const result = await installOpencode(fixture.home);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(`✓ Pruned stale agent: ${join(agentsDir, 'pas_developer.md')}`);
      expect(result.stdout.toString()).toContain(`✓ Pruned stale agent: ${join(agentsDir, 'pas_qa.md')}`);

      expect(existsSync(join(agentsDir, 'pas_developer.md'))).toBe(false);
      expect(existsSync(join(agentsDir, 'pas_qa.md'))).toBe(false);
      for (const agent of SHIPPED_AGENTS) {
        expect(existsSync(join(agentsDir, agent))).toBe(true);
      }
      expect(readdirSync(agentsDir).sort()).toEqual([...SHIPPED_AGENTS].sort());
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration keeps agent files PAS does not own', async () => {
    const fixture = makeHomeFixture();
    try {
      const unrelated = [
        'IADEV-x.md',
        'nas_y.md',
        'Nova Agent Squad.md',
        'user-custom-agent.md',
        'pas_not-an-agent.txt',
      ];
      const agentsDir = seedAgentFiles(opencodeAgentsDir(fixture.home), [
        ...unrelated,
        'pas_developer.md',
      ]);

      const result = await installOpencode(fixture.home);
      expect(result.exitCode).toBe(0);

      for (const file of unrelated) {
        expect(existsSync(join(agentsDir, file))).toBe(true);
      }
      expect(existsSync(join(agentsDir, 'pas_developer.md'))).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration removes an orchestrator the roster no longer ships', async () => {
    const retired = 'Pulsar Agent Turbo.md';
    const retiredDist = join(OPENCODE_AGENTS_DIST, retired);
    const fixture = makeHomeFixture();
    // Park the artifact outside the dist roster so install cannot copy it.
    const parkedDist = join(fixture.root, retired);
    try {
      // Simulate a roster that dropped one orchestrator from its shipped set.
      renameSync(retiredDist, parkedDist);

      const agentsDir = seedAgentFiles(opencodeAgentsDir(fixture.home), [retired]);
      const result = await installOpencode(fixture.home);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(`✓ Pruned stale agent: ${join(agentsDir, retired)}`);
      expect(existsSync(join(agentsDir, retired))).toBe(false);
      expect(existsSync(join(agentsDir, 'Pulsar Agent Squad.md'))).toBe(true);
      expect(readdirSync(agentsDir).sort()).toEqual(
        [...SHIPPED_AGENTS.filter((agent) => agent !== retired)].sort(),
      );
    } finally {
      if (existsSync(parkedDist)) renameSync(parkedDist, retiredDist);
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration dry run reports prune candidates without removing them', async () => {
    const fixture = makeHomeFixture();
    try {
      const agentsDir = seedAgentFiles(opencodeAgentsDir(fixture.home), [
        'pas_developer.md',
        'pas_qa.md',
        'IADEV-x.md',
      ]);

      const result = await installOpencode(fixture.home, ['--dry-run']);
      expect(result.exitCode).toBe(0);

      const stdout = result.stdout.toString();
      expect(stdout).toContain(`DRY-RUN: rm '${join(agentsDir, 'pas_developer.md')}'`);
      expect(stdout).toContain(`DRY-RUN: rm '${join(agentsDir, 'pas_qa.md')}'`);
      expect(stdout).not.toContain('IADEV-x.md');

      // Nothing was removed and nothing was installed.
      expect(readdirSync(agentsDir).sort()).toEqual(['IADEV-x.md', 'pas_developer.md', 'pas_qa.md']);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration reports nothing to prune when the agents directory is missing or empty', async () => {
    const missing = makeHomeFixture();
    try {
      const result = await installOpencode(missing.home);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(`Nothing to prune: ${opencodeAgentsDir(missing.home)}`);
    } finally {
      rmSync(missing.root, { recursive: true, force: true });
    }

    const empty = makeHomeFixture();
    try {
      mkdirSync(opencodeAgentsDir(empty.home), { recursive: true });
      const result = await installOpencode(empty.home);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(`Nothing to prune: ${opencodeAgentsDir(empty.home)}`);
      expect(readdirSync(opencodeAgentsDir(empty.home)).sort()).toEqual([...SHIPPED_AGENTS].sort());
    } finally {
      rmSync(empty.root, { recursive: true, force: true });
    }
  });

  it('@integration leaves the Pi roster alone', async () => {
    const PI_STUB = `#!/usr/bin/env bash
set -u
case "$1" in
  --version) echo "pi 1.0.0"; exit 0 ;;
  list) echo "Installed packages:"; exit 0 ;;
  install) echo "installed $2"; exit 0 ;;
esac
exit 0
`;
    const root = mkdtempSync(join(tmpdir(), 'pas-install-prune-pi-'));
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    mkdirSync(home, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const stub = join(bin, 'pi');
    writeFileSync(stub, PI_STUB);
    chmodSync(stub, 0o755);

    const piAgentsDir = join(home, '.pi/agent/agents');
    const retiredPiAgents = ['pas_stale.md', 'pas_qa_retired.md'];

    try {
      seedAgentFiles(piAgentsDir, retiredPiAgents);

      const result = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env({ HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` })
        .nothrow()
        .quiet();
      expect(result.exitCode).toBe(0);

      // The prune is OpenCode-only: Pi keeps every file it did not install.
      expect(result.stdout.toString()).not.toContain('Nothing to prune');
      for (const file of retiredPiAgents) {
        expect(existsSync(join(piAgentsDir, file))).toBe(true);
      }
      // Pi intentionally still ships these two names.
      expect(existsSync(join(piAgentsDir, 'pas_developer.md'))).toBe(true);
      expect(existsSync(join(piAgentsDir, 'pas_qa.md'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
