import { spawnSync } from 'bun';
import { readPiPackages } from './pi-packages';

/**
 * Explicit environment used when spawning `pi`. Callers that need to isolate
 * PATH (tests, alternate installs) pass one; when omitted the child inherits
 * the current process environment exactly as before.
 */
export type PiSpawnEnv = Record<string, string | undefined>;

/**
 * Spawn options that isolate PATH in tests while inheriting it in production.
 * Shared by every `pi` invocation so call sites cannot drift.
 */
export function piSpawnOptions(env?: PiSpawnEnv): {
  stdout: 'pipe';
  stderr: 'pipe';
  env?: PiSpawnEnv;
} {
  return env === undefined
    ? { stdout: 'pipe', stderr: 'pipe' }
    : { stdout: 'pipe', stderr: 'pipe', env };
}

/** True when the `pi` binary responds to `--version` with exit code 0. */
export function piAvailable(env?: PiSpawnEnv): boolean {
  try {
    const result = spawnSync(['pi', '--version'], piSpawnOptions(env));
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Strip the bullet and surrounding whitespace from one `pi list` line. */
export function packageLineToken(line: string): string {
  return line.trim().replace(/^[-*]\s+/, '');
}

/**
 * True when one `pi list` line clearly names the configured source.
 *
 * Matching is line-exact: the whole trimmed line must equal either the
 * configured source spec (`npm:pi-subagents`) or its bare package name
 * (`pi-subagents`). Substring matching is deliberately avoided so a longer
 * package (`npm:pi-subagents-extra`) or a filesystem path containing the name
 * cannot be mistaken for a configured package.
 */
export function isPiPackageListed(source: string, listOutput: string): boolean {
  const spec = source.trim();
  if (!spec) return false;
  const bareName = spec.startsWith('npm:') ? spec.slice('npm:'.length) : spec;

  return listOutput
    .split(/\r?\n/)
    .map(packageLineToken)
    .some((line) => line === spec || line === bareName);
}

/** True when `pi list` already reports the source as configured. */
export function piPackageConfigured(source: string, env?: PiSpawnEnv): boolean {
  try {
    const result = spawnSync(['pi', 'list'], piSpawnOptions(env));
    if (result.exitCode !== 0) return false;
    return isPiPackageListed(source, result.stdout.toString());
  } catch {
    return false;
  }
}

/**
 * Parse a Pi version string into `[major, minor, patch]`.
 *
 * Accepts a bare version (`1.4.0`) or a version embedded in command output
 * (`pi 1.4.0`). Returns `null` when no complete three-part version exists.
 */
export function parsePiVersion(text: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `version` is present and greater than or equal to `min`. */
export function isVersionAtLeast(
  version: readonly [number, number, number] | null,
  min: readonly [number, number, number],
): boolean {
  if (!version) return false;
  for (let i = 0; i < 3; i += 1) {
    if (version[i] > min[i]) return true;
    if (version[i] < min[i]) return false;
  }
  return true;
}

/** Strip the `npm:` prefix so bare and prefixed specs compare equal. */
export function barePackageName(source: string): string {
  return source.startsWith('npm:') ? source.slice('npm:'.length) : source;
}

/**
 * Extract package specs from `pi list` output, ignoring the header and the
 * resolved filesystem path lines that follow each package.
 */
export function parsePiInstalledPackages(listOutput: string): string[] {
  return listOutput
    .split(/\r?\n/)
    .map(packageLineToken)
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('/') &&
        !line.endsWith(':') &&
        !/\s/.test(line),
    );
}

/**
 * Configured packages that are not installed yet, in configured order.
 *
 * Matching is exact (prefix-aware for `npm:`), so a longer package such as
 * `npm:pi-subagents-extra` does not satisfy `npm:pi-subagents`. Packages that
 * are installed but absent from `configured` are never returned: this function
 * feeds installs only, and there is no removal path.
 */
export function missingPackages(
  configured: readonly string[],
  installed: readonly string[],
): string[] {
  const installedNames = new Set<string>();
  for (const source of installed) {
    const trimmed = source.trim();
    if (!trimmed) continue;
    installedNames.add(trimmed);
    installedNames.add(barePackageName(trimmed));
  }

  return configured.filter((source) => {
    const trimmed = source.trim();
    return !installedNames.has(trimmed) && !installedNames.has(barePackageName(trimmed));
  });
}

/**
 * Install one Pi package source.
 *
 * Logs the exact `Installing package: pi install <source>` line through `log`
 * (the setup summary collects it; `pas install` prints it). A non-zero exit
 * throws with the command and captured stderr; callers own the reporting and
 * exit semantics.
 */
export function installPiPackage(
  source: string,
  env?: PiSpawnEnv,
  log: (line: string) => void = console.log,
): void {
  log(`Installing package: pi install ${source}`);
  const result = spawnSync(['pi', 'install', source], piSpawnOptions(env));
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(
      `'pi install ${source}' failed with exit code ${result.exitCode}.` +
        (stderr ? ` ${stderr}` : ''),
    );
  }
}

/**
 * Install the configured Pi packages from `config/pi-packages.txt`.
 *
 * Dry-run only prints the planned installs. Configured packages are skipped
 * with a message. A failed install prints the captured stderr and exits
 * non-zero, matching the command's existing behavior.
 */
export function installPiPackages(dryRun: boolean): void {
  for (const source of readPiPackages()) {
    if (dryRun) {
      console.log(`DRY-RUN: pi install ${source}`);
      continue;
    }

    if (piPackageConfigured(source)) {
      console.log(`Package already configured (skipped): ${source}`);
      continue;
    }

    try {
      installPiPackage(source);
    } catch (error) {
      console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
}
