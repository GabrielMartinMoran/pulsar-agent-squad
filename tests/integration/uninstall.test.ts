import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'fs';
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
