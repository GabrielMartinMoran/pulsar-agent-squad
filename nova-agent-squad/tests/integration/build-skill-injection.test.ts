/**
 * Integration test for the build-time `permission.skill` injection.
 *
 * The fix for the IADEV skill deny precedence bug
 * (memory: permission-skill-precedence-bug-confirmed-20260701) is
 * implemented at the BUILD step: the user's per-agent
 * `permission.skill` block in `~/.config/opencode/opencode.json` is
 * compiled INTO the dist agent's frontmatter `permission:` block,
 * placed AFTER the existing `*`: allow line.
 *
 * This test exercises the real `nas build` CLI with a fixture
 * `opencode.json` (via the `NAS_OPENCODE_CONFIG_PATH` env var) and
 * verifies the dist output for every NAS agent.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { $ } from 'bun';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const CLI_ENTRY = 'src/cli/index.ts';

let tempHome = '';
let fixtureConfig = '';

const NAS_AGENT_FILES = [
  'nas_developer.md',
  'nas_developer_mini.md',
  'nas_planner.md',
  'nas_qa.md',
  'nas_researcher.md',
  'Nova Agent Squad.md',
];

beforeAll(() => {
  tempHome = join(
    tmpdir(),
    'nas-build-skill-inj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
  );
  mkdirSync(tempHome, { recursive: true });
  mkdirSync(join(tempHome, '.config', 'opencode'), { recursive: true });

  fixtureConfig = join(tempHome, '.config', 'opencode', 'opencode.json');
  writeConfig(fixtureConfig);
});

afterAll(() => {
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
  // Restore dist from canonical backup so other test suites are not
  // affected.
  if (existsSync('/tmp/canonical-dist-openode')) {
    const target = 'dist/platforms/opencode/agents';
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const f of readdirSyncSafe('/tmp/canonical-dist-openode')) {
      const content = readFileSync(join('/tmp/canonical-dist-openode', f));
      writeFileSync(join(target, f), content);
    }
  }
});

function writeConfig(path: string): void {
  const config = {
    $schema: 'https://opencode.ai/config.json',
    default_agent: 'Nova Agent Squad',
    agent: {
      nas_developer: {
        permission: { skill: { 'IADEV*': 'deny', 'git-*': 'deny' } },
      },
      nas_developer_mini: {
        permission: { skill: { 'IADEV*': 'deny' } },
      },
      nas_planner: {
        permission: { skill: { 'IADEV*': 'deny' } },
      },
      nas_qa: {
        permission: { skill: { 'IADEV*': 'deny' } },
      },
      nas_researcher: {
        permission: { skill: { 'IADEV*': 'deny' } },
      },
      'Nova Agent Squad': {
        permission: { skill: { 'IADEV*': 'deny' } },
      },
    },
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
}

function readdirSyncSafe(path: string): string[] {
  try {
    return require('fs').readdirSync(path) as string[];
  } catch {
    return [];
  }
}

describe('nas build — permission.skill injection (CLI-preserving fix)', () => {
  it('injects per-agent `permission.skill` block into the dist frontmatter', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`
      .env({
        ...process.env,
        NAS_OPENCODE_CONFIG_PATH: fixtureConfig,
      })
      .quiet();
    expect(result.exitCode).toBe(0);

    // The nas_developer dist file must have its skill block injected.
    const devPath = 'dist/platforms/opencode/agents/nas_developer.md';
    expect(existsSync(devPath)).toBe(true);
    const devContent = readFileSync(devPath, 'utf-8');

    // Source frontmatter has `*`: allow as a child of permission.
    expect(devContent).toMatch(/permission:\n\s+"\*": allow/);

    // After injection, a `skill:` key sits AFTER the `*`: allow line.
    const starIdx = devContent.indexOf('"*": allow');
    const skillIdx = devContent.indexOf('\n  skill:');
    expect(starIdx).toBeGreaterThan(-1);
    expect(skillIdx).toBeGreaterThan(starIdx);

    // The injected skill block must include the per-agent rules.
    expect(devContent).toContain('"IADEV*": deny');
    expect(devContent).toContain('"git-*": deny');
  });

  it('injects the skill block for every NAS agent that has rules in the fixture', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`
      .env({
        ...process.env,
        NAS_OPENCODE_CONFIG_PATH: fixtureConfig,
      })
      .quiet();
    expect(result.exitCode).toBe(0);

    for (const f of NAS_AGENT_FILES) {
      const path = join('dist/platforms/opencode/agents', f);
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, 'utf-8');

      // Each NAS agent dist file should now have an `IADEV*`: deny in
      // its `permission.skill` block.
      expect(content).toContain('"IADEV*": deny');
    }
  });

  it('preserves caveman INJECT markers and the agent body', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`
      .env({
        ...process.env,
        NAS_OPENCODE_CONFIG_PATH: fixtureConfig,
      })
      .quiet();
    expect(result.exitCode).toBe(0);

    const devContent = readFileSync(
      'dist/platforms/opencode/agents/nas_developer.md',
      'utf-8',
    );
    expect(devContent).not.toContain('INJECT:caveman');
    expect(devContent).toContain('# nas_developer');
  });

  it('places the `skill:` block AFTER `*`: allow so last-match-wins applies', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`
      .env({
        ...process.env,
        NAS_OPENCODE_CONFIG_PATH: fixtureConfig,
      })
      .quiet();
    expect(result.exitCode).toBe(0);

    const devPath = 'dist/platforms/opencode/agents/nas_developer.md';
    const content = readFileSync(devPath, 'utf-8');
    const lines = content.split('\n');
    const starLine = lines.findIndex((l) => l.trim() === '"*": allow');
    const skillLine = lines.findIndex((l) => l.trim() === 'skill:');
    expect(starLine).toBeGreaterThan(0);
    expect(skillLine).toBeGreaterThan(starLine);
    // Skill block must be a direct sibling of `*`: allow, indented 2 spaces.
    expect(lines[skillLine]).toBe('  skill:');
    expect(lines[skillLine + 1].startsWith('    ')).toBe(true);
  });
});
