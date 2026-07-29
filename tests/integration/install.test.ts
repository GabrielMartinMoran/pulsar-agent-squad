import { describe, expect, it } from 'bun:test';
import { $ } from 'bun';

const CLI_ENTRY = 'src/cli/index.ts';

describe('install command', () => {
  it('should show help for install command', async () => {
    const result = await $`bun run ${CLI_ENTRY} install --help`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('--target');
    expect(result.stdout.toString()).toContain('--dry-run');
    expect(result.stdout.toString()).toContain('--destdir');
  });

  it('should print DRY-RUN lines for install --target=opencode --dry-run', async () => {
    // Build first to ensure dist exists
    await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();

    const result = await $`bun run ${CLI_ENTRY} install --target=opencode --dry-run`.quiet();
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain('DRY-RUN');
    expect(stdout).toContain('.config/opencode/agents');
  });

  it('should fail for unknown target', async () => {
    let exitCode = 0;
    try {
      await $`bun run ${CLI_ENTRY} install --target=nonexistent`.quiet();
    } catch (e: any) {
      exitCode = e.exitCode;
    }
    expect(exitCode).not.toBe(0);
  });

  it('should fail when target not built', async () => {
    // Remove cursor dist if exists
    const { rmSync, existsSync } = require('fs');
    if (existsSync('dist/platforms/cursor')) {
      rmSync('dist/platforms/cursor', { recursive: true, force: true });
    }

    let exitCode = 0;
    try {
      await $`bun run ${CLI_ENTRY} install --target=cursor`.quiet();
    } catch (e: any) {
      exitCode = e.exitCode;
    }
    expect(exitCode).not.toBe(0);
  });
});
