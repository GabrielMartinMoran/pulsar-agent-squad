import { describe, expect, it, beforeAll } from 'bun:test';
import { existsSync, readdirSync, rmSync, readFileSync } from 'fs';
import { $ } from 'bun';

const CLI_ENTRY = 'src/cli/index.ts';

// Clean up before tests
beforeAll(() => {
  if (existsSync('dist/platforms/opencode')) {
    rmSync('dist/platforms/opencode', { recursive: true, force: true });
  }
});

describe('build command', () => {
  it('should create dist/platforms/opencode/agents/ with the exact PAS roster', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);

    const agentsDir = 'dist/platforms/opencode/agents';
    expect(existsSync(agentsDir)).toBe(true);

    const files = readdirSync(agentsDir);
    expect(files.sort()).toEqual([
      'Pulsar Agent Squad.md',
      'pas_developer.md',
      'pas_qa.md',
      'pas_researcher.md',
    ]);
  });

  it('should inject shared developer content into pas_developer.md', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);

    const devContent = readFileSync('dist/platforms/opencode/agents/pas_developer.md', 'utf-8');
    expect(devContent).toContain('<skill_application>');
    expect(devContent).toContain('<test_coverage_explanation>');
    expect(devContent).not.toContain('PAS concise-work reference');
  });

  it('should build pas_qa.md without legacy progress guidance', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);

    const qaContent = readFileSync('dist/platforms/opencode/agents/pas_qa.md', 'utf-8');
    expect(qaContent).toContain('<skill_compliance>');
    expect(qaContent).toContain('<test_sufficiency>');
    expect(qaContent).not.toContain('PAS concise-work reference');
  });

  it('should build file-based platform target', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=cursor`.quiet();
    expect(result.exitCode).toBe(0);

    expect(existsSync('dist/platforms/cursor/AGENTS.md')).toBe(true);
  });

  it('should fail for unknown target', async () => {
    let exitCode = 0;
    try {
      await $`bun run ${CLI_ENTRY} build --target=nonexistent`.quiet();
    } catch (e: any) {
      exitCode = e.exitCode;
    }
    expect(exitCode).not.toBe(0);
  });


});
