/**
 * Integration test for the build-time `permission.skill` injection.
 *
 * The fix for the IADEV skill deny precedence bug
 * (memory: permission-skill-precedence-bug-confirmed-20260701) is
 * implemented at the BUILD step: the user's per-agent
 * `permission.skill` block in `~/.config/opencode/opencode.json` is
 * compiled into the dist agent's native V2 `permissions` list, after the
 * existing wildcard rules.
 *
 * This test exercises the real `pas build` CLI with a fixture
 * `opencode.json` (via the `PAS_OPENCODE_CONFIG_PATH` env var) and
 * verifies the dist output for every unchanged canonical agent.
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

const PAS_AGENT_FILES = [
  'Pulsar Agent Squad.md',
  'Pulsar Agent Turbo.md',
  'pas_copilot.md',
  'pas_engineer.md',
  'pas_researcher.md',
];

beforeAll(() => {
  tempHome = join(
    tmpdir(),
    'pas-build-skill-inj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
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
    default_agent: 'Pulsar Agent Squad',
    agent: {
      pas_engineer: {
        permission: { skill: { 'IADEV*': 'deny', 'git-*': 'deny' } },
      },
      pas_copilot: {
        permission: { skill: { 'IADEV*': 'deny' } },
      },
      pas_researcher: {
        permission: { skill: { 'IADEV*': 'deny' } },
      },
      'Pulsar Agent Squad': {
        permission: { skill: { 'IADEV*': 'deny' } },
      },
      'Pulsar Agent Turbo': {
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

describe('pas build — permission.skill injection (CLI-preserving fix)', () => {
  it('injects per-agent `permission.skill` block into the dist frontmatter', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`
      .env({
        ...process.env,
        PAS_OPENCODE_CONFIG_PATH: fixtureConfig,
      })
      .quiet();
    expect(result.exitCode).toBe(0);

    // The pas_engineer dist file must have its skill block injected.
    const devPath = 'dist/platforms/opencode/agents/pas_engineer.md';
    expect(existsSync(devPath)).toBe(true);
    const devContent = readFileSync(devPath, 'utf-8');

    // Source frontmatter uses OpenCode V2 permissions.
    expect(devContent).toContain('permissions:\n');
    expect(devContent).not.toContain('\npermission:\n');

    // Injected skill rules follow the wildcard, so last-match-wins applies.
    const starIdx = devContent.indexOf('  - action: "*"');
    const skillIdx = devContent.lastIndexOf('  - action: skill');
    expect(starIdx).toBeGreaterThanOrEqual(0);
    expect(skillIdx).toBeGreaterThan(starIdx);

    // The injected skill block must include the per-agent rules.
    expect(devContent).toContain('resource: "IADEV*"\n    effect: deny');
    expect(devContent).toContain('resource: "git-*"\n    effect: deny');
  });

  it('injects the skill block for every canonical agent that has rules in the fixture', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`
      .env({
        ...process.env,
        PAS_OPENCODE_CONFIG_PATH: fixtureConfig,
      })
      .quiet();
    expect(result.exitCode).toBe(0);

    for (const f of PAS_AGENT_FILES) {
      const path = join('dist/platforms/opencode/agents', f);
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, 'utf-8');

      // Each canonical agent dist file should have the configured V2 skill rule.
      expect(content).toContain('resource: "IADEV*"\n    effect: deny');
      expect(content).toContain('  - action: skill');
    }
  });

  it('builds the developer agent body without legacy progress guidance', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`
      .env({
        ...process.env,
        PAS_OPENCODE_CONFIG_PATH: fixtureConfig,
      })
      .quiet();
    expect(result.exitCode).toBe(0);

    const devContent = readFileSync(
      'dist/platforms/opencode/agents/pas_engineer.md',
      'utf-8',
    );
    expect(devContent).not.toContain('PAS concise-work reference');
    expect(devContent).toContain('# pas_engineer');
  });

  it('places skill entries after the wildcard rule so last-match-wins applies', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`
      .env({
        ...process.env,
        PAS_OPENCODE_CONFIG_PATH: fixtureConfig,
      })
      .quiet();
    expect(result.exitCode).toBe(0);

    const devPath = 'dist/platforms/opencode/agents/pas_engineer.md';
    const content = readFileSync(devPath, 'utf-8');
    const lines = content.split('\n');
    const starLine = lines.findIndex((l) => l.trim() === '- action: "*"');
    const skillLine = lines.findIndex((l) => l.trim() === '- action: skill');
    expect(starLine).toBeGreaterThanOrEqual(0);
    expect(skillLine).toBeGreaterThan(starLine);
    expect(lines[skillLine + 1]).toBe('    resource: "IADEV*"');
    expect(lines[skillLine + 2]).toBe('    effect: deny');
  });
});
