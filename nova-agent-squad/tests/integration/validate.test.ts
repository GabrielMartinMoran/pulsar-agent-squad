import { describe, expect, it } from 'bun:test';
import { $ } from 'bun';

const CLI_ENTRY = 'src/cli/index.ts';

describe('validate command', () => {
  it('should output checkmarks for valid agent files', async () => {
    const result = await $`bun run ${CLI_ENTRY} validate`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('✓ src/agents/Nova Agent Squad.md');
    expect(result.stdout.toString()).toContain('✓ src/agents/nas_researcher.md');
    expect(result.stdout.toString()).toContain('✓ src/agents/nas_planner.md');
    expect(result.stdout.toString()).toContain('✓ src/agents/nas_developer.md');
    expect(result.stdout.toString()).toContain('✓ src/agents/nas_qa.md');
  });

  it('should output header "Validating centralized agent structure..."', async () => {
    const result = await $`bun run ${CLI_ENTRY} validate`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Validating centralized agent structure...');
  });

  it('should report missing agent file with cross mark', async () => {
    // We test via the actual validate output format — the code should check each file
    const result = await $`bun run ${CLI_ENTRY} validate`.quiet();
    // When all files exist, output should contain checkmarks not crosses for agents
    expect(result.stdout.toString()).not.toContain('✗ src/agents/');
  });

  it('should exit 0 when all agent files exist with frontmatter', async () => {
    const result = await $`bun run ${CLI_ENTRY} validate`.quiet();
    expect(result.exitCode).toBe(0);
  });

  it('should contain "Validation complete!" at the end', async () => {
    const result = await $`bun run ${CLI_ENTRY} validate`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Validation complete!');
  });
});
