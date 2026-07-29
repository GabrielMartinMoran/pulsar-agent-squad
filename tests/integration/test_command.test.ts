import { describe, expect, it } from 'bun:test';
import { $ } from 'bun';

const CLI_ENTRY = 'src/cli/index.ts';

describe('test command', () => {
  it('should run contract tests and report results', async () => {
    // test command may exit non-zero if any test fails; capture output regardless
    const result = await $`bun run ${CLI_ENTRY} test`.nothrow().quiet();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('PASS');
    expect(stdout).toContain('Tests:');
  });

  it('should mention "passed" and "failed" counts in output', async () => {
    const result = await $`bun run ${CLI_ENTRY} test`.nothrow().quiet();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('passed');
    expect(stdout).toContain('failed');
  });

  it('should run at least one test script', async () => {
    const result = await $`bun run ${CLI_ENTRY} test`.nothrow().quiet();
    const stdout = result.stdout.toString();
    expect(stdout).toContain('PASS');
  });
});
