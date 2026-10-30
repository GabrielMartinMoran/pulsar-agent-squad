import { beforeAll, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
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

  it('should print the DRY-RUN copy line for the pas-toolkit plugin', async () => {
    // Build first to ensure the plugin artifact exists
    await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();

    const result = await $`bun run ${CLI_ENTRY} install --target=opencode --dry-run`.quiet();
    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout).toContain('pas-toolkit.ts');
    expect(stdout).toContain('.config/opencode/plugins');
  });

  it('should install the plugin to a --destdir fixture byte-identical to source', async () => {
    await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();

    const destdir = mkdtempSync(join(tmpdir(), 'pas-install-fixture-'));
    try {
      const result = await $`bun run ${CLI_ENTRY} install --target=opencode --destdir=${destdir}`.quiet();
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

// ---------------------------------------------------------------------------
// Pi target install
// ---------------------------------------------------------------------------

const PI_STUB = `#!/usr/bin/env bash
set -u
echo "$@" >> "$PI_LOG"
cmd="$1"
case "$cmd" in
  --version)
    echo "pi 1.0.0"
    exit 0
    ;;
  list)
    echo "Installed packages:"
    if [ -n "\${PI_LIST_OUTPUT:-}" ]; then printf '%s\\n' "$PI_LIST_OUTPUT"; fi
    exit 0
    ;;
  install)
    if [ -n "\${PI_FAIL_PACKAGE:-}" ] && [ "$2" = "$PI_FAIL_PACKAGE" ]; then
      echo "simulated install failure for $2" >&2
      exit 7
    fi
    echo "installed $2"
    exit 0
    ;;
esac
exit 0
`;

interface PiFixture {
  root: string;
  home: string;
  bin: string;
  log: string;
}

function makePiFixture(): PiFixture {
  const root = mkdtempSync(join(tmpdir(), 'pas-pi-install-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const log = join(root, 'pi.log');
  const stub = join(bin, 'pi');
  writeFileSync(stub, PI_STUB);
  chmodSync(stub, 0o755);
  return { root, home, bin, log };
}

function piEnv(
  fixture: PiFixture,
  extra: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    HOME: fixture.home,
    PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
    PI_LOG: fixture.log,
  };
  return { ...base, ...extra };
}

function readLog(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
}

describe('@integration Pi install', () => {
  beforeAll(async () => {
    const built = await $`bun run ${CLI_ENTRY} build --target=pi`.quiet();
    expect(built.exitCode).toBe(0);
  });

  it('@integration Pi install copies artifacts and creates directories', async () => {
    const fixture = makePiFixture();
    try {
      const result = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env(piEnv(fixture))
        .quiet();

      expect(result.exitCode).toBe(0);

      const agent = join(fixture.home, '.pi/agent/agents/pas_developer.md');
      const skill = join(fixture.home, '.pi/agent/skills/pas-lead/SKILL.md');
      const settings = join(fixture.home, '.pi/agent/pas-settings.snippet.json');
      const extension = join(fixture.home, '.pi/agent/extensions/pas-toolkit/index.ts');

      expect(existsSync(agent)).toBe(true);
      expect(existsSync(skill)).toBe(true);
      expect(existsSync(settings)).toBe(true);
      expect(existsSync(extension)).toBe(true);

      const stdout = result.stdout.toString();
      expect(stdout).toContain(join(fixture.home, '.pi/agent/agents'));
      expect(stdout).toContain(join(fixture.home, '.pi/agent/skills'));
      expect(stdout).toContain(settings);
      expect(stdout).toContain(join(fixture.home, '.pi/agent/extensions/pas-toolkit'));
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration Pi install requires the Pi binary', async () => {
    const fixture = makePiFixture();
    try {
      const emptyBin = join(fixture.root, 'empty-bin');
      mkdirSync(emptyBin, { recursive: true });
      const env: Record<string, string> = {
        HOME: fixture.home,
        PATH: `${emptyBin}:${dirname(process.execPath)}`,
      };

      const result = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env(env)
        .nothrow()
        .quiet();

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain('not found on PATH');
      expect(existsSync(join(fixture.home, '.pi/agent/agents/pas_developer.md'))).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration Pi install always installs the configured plugins', async () => {
    const fixture = makePiFixture();
    try {
      const result = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env(piEnv(fixture, { PI_LIST_OUTPUT: 'npm:pi-subagents' }))
        .quiet();

      expect(result.exitCode).toBe(0);

      const log = readLog(fixture.log);
      expect(log.filter((line) => line === 'install npm:pi-subagents')).toHaveLength(0);
      expect(log.filter((line) => line === 'install npm:pi-web-access')).toHaveLength(1);
      expect(
        log.filter((line) => line === 'install npm:@juicesharp/rpiv-ask-user-question'),
      ).toHaveLength(1);
      expect(log.filter((line) => line === 'install npm:@juicesharp/rpiv-todo')).toHaveLength(1);

      expect(result.stdout.toString()).toContain(
        'Package already configured (skipped): npm:pi-subagents',
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration Pi install preserves an edited settings snippet', async () => {
    const fixture = makePiFixture();
    try {
      const settingsDir = join(fixture.home, '.pi/agent');
      const installed = join(settingsDir, 'pas-settings.snippet.json');
      const backup = `${installed}.bak`;
      const edited = '{"subagents":{"defaultModel":"my-custom-model"}}\n';
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(installed, edited);

      const first = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env(piEnv(fixture))
        .quiet();
      expect(first.exitCode).toBe(0);

      const artifact = readFileSync('dist/platforms/pi/settings.snippet.json');
      expect(readFileSync(backup, 'utf-8')).toBe(edited);
      expect(readFileSync(installed).equals(artifact)).toBe(true);

      const second = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env(piEnv(fixture))
        .quiet();
      expect(second.exitCode).toBe(0);

      expect(readFileSync(backup, 'utf-8')).toBe(edited);
      expect(readFileSync(installed).equals(artifact)).toBe(true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration Pi install reports a clear error when the settings destination is a directory', async () => {
    const fixture = makePiFixture();
    try {
      const conflicting = join(fixture.home, '.pi/agent/pas-settings.snippet.json');
      mkdirSync(conflicting, { recursive: true });

      const result = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env(piEnv(fixture))
        .nothrow()
        .quiet();

      expect(result.exitCode).not.toBe(0);
      const stderr = result.stderr.toString();
      expect(stderr).toContain(`destination '${conflicting}' is not a regular file`);
      expect(stderr).toContain('Remove or rename');
      expect(stderr).not.toContain('EISDIR');
      expect(stderr).not.toContain('at copyFileArtifact');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration Pi install reports a clear error when the backup path is a directory', async () => {
    const fixture = makePiFixture();
    try {
      const settingsDir = join(fixture.home, '.pi/agent');
      const installed = join(settingsDir, 'pas-settings.snippet.json');
      const backup = `${installed}.bak`;
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(installed, '{"subagents":{"defaultModel":"my-custom-model"}}\n');
      mkdirSync(backup, { recursive: true });

      const result = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env(piEnv(fixture))
        .nothrow()
        .quiet();

      expect(result.exitCode).not.toBe(0);
      const stderr = result.stderr.toString();
      expect(stderr).toContain(`could not write backup '${backup}'`);
      expect(stderr).toContain('Remove or rename');
      expect(stderr).not.toContain('at copyFileArtifact');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration Pi install reports an unchanged settings snippet without a backup', async () => {
    const fixture = makePiFixture();
    try {
      const settingsDir = join(fixture.home, '.pi/agent');
      const installed = join(settingsDir, 'pas-settings.snippet.json');
      const backup = `${installed}.bak`;
      const artifact = readFileSync('dist/platforms/pi/settings.snippet.json');
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(installed, artifact);

      const result = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env(piEnv(fixture))
        .quiet();

      expect(result.exitCode).toBe(0);
      const stdout = result.stdout.toString();
      expect(stdout).toContain(`Unchanged target: pi -> ${installed}`);
      expect(stdout).not.toContain(`Installed target: pi -> ${installed}`);
      expect(existsSync(backup)).toBe(false);
      expect(readFileSync(installed).equals(artifact)).toBe(true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration Pi install aborts on the first failing package', async () => {
    const fixture = makePiFixture();
    try {
      const result = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi`
        .env(piEnv(fixture, { PI_FAIL_PACKAGE: 'npm:pi-subagents' }))
        .nothrow()
        .quiet();

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain('failed with exit code 7');

      const log = readLog(fixture.log);
      expect(log.filter((line) => line === 'install npm:pi-subagents')).toHaveLength(1);
      expect(log.filter((line) => line === 'install npm:pi-web-access')).toHaveLength(0);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('@integration Dry run previews without mutating', async () => {
    const fixture = makePiFixture();
    try {
      const result = await $`${process.execPath} run ${CLI_ENTRY} install --target=pi --dry-run`
        .env(piEnv(fixture))
        .quiet();

      expect(result.exitCode).toBe(0);

      const stdout = result.stdout.toString();
      expect(stdout).toContain('DRY-RUN: cp');
      expect(stdout).toContain('DRY-RUN: pi install npm:pi-subagents');
      expect(stdout).toContain('DRY-RUN: pi install npm:pi-web-access');
      expect(stdout).toContain('DRY-RUN: pi install npm:@juicesharp/rpiv-ask-user-question');
      expect(stdout).toContain('DRY-RUN: pi install npm:@juicesharp/rpiv-todo');
      expect(stdout).toContain('DRY-RUN: would install target: pi ->');
      expect(stdout).not.toContain('Installed target: pi ->');

      expect(existsSync(join(fixture.home, '.pi/agent'))).toBe(false);
      expect(readLog(fixture.log).filter((line) => line.startsWith('install '))).toHaveLength(0);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
