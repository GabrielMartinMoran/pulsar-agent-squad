import { defineCommand } from 'citty';
import { spawnSync } from 'bun';

/**
 * Run a shell command and return its captured output.
 * Exits the process on failure unless `optional` is true.
 */
function run(cmd: string[], optional = false): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync({
    cmd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  };
  if (!optional && out.exitCode !== 0) {
    process.stderr.write(out.stderr);
    throw new Error(`command failed (exit ${out.exitCode}): ${cmd.join(' ')}`);
  }
  return out;
}

interface UpdateOptions {
  check: boolean;
  rebuild: boolean;
  reinstall: boolean;
}

export type UpdateActionKind = 'build' | 'install';

export interface UpdateAction {
  kind: UpdateActionKind;
  target: string;
}

/**
 * Select the post-pull actions. The printed plan and the execution loop both
 * consume this one list, so they cannot drift apart.
 *
 * - default and `--reinstall`: install OpenCode; install builds internally.
 * - `--rebuild` alone: build OpenCode without installing.
 * - `--rebuild --reinstall`: install only, so the build is not duplicated.
 */
export function selectUpdateActions(opts: {
  rebuild: boolean;
  reinstall: boolean;
}): UpdateAction[] {
  const wantsInstall = opts.reinstall || !opts.rebuild;
  return [
    wantsInstall
      ? { kind: 'install', target: 'opencode' }
      : { kind: 'build', target: 'opencode' },
  ];
}

/** Human-readable action line shared by the plan and failure reports. */
export function describeUpdateAction(action: UpdateAction): string {
  return `pas ${action.kind} --target=${action.target}`;
}

function commandForAction(action: UpdateAction): string[] {
  return ['bun', 'run', 'cli', action.kind, `--target=${action.target}`];
}

/**
 * `pas update` - pull the current upstream branch and install/build OpenCode.
 *
 * Contract:
 *   - Fast-forward-only pull of the current upstream branch (`git pull
 *     --ff-only`). No release-based updater logic: no release fetches, version
 *     pins, or tag fetches.
 *   - The default action is a fresh OpenCode install (the installer builds
 *     selected artifacts itself). `--rebuild` alone builds without installing;
 *     `--reinstall` installs explicitly; `--check` shows the plan and changes
 *     nothing.
 *   - A failure after a completed pull is reported as partial completion with
 *     a nonzero status. The checkout is never rolled back.
 */
export async function performUpdate(opts: UpdateOptions): Promise<number> {
  // 1. Pre-flight: must be inside a git working tree
  const inRepo = run(['git', 'rev-parse', '--is-inside-work-tree'], true);
  if (inRepo.exitCode !== 0 || inRepo.stdout.trim() !== 'true') {
    console.error('Error: not a git repository. Run `pas update` from inside a PAS checkout.');
    return 1;
  }

  // 2. Show current state
  const branch = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  const remote = run(['git', 'config', '--get', 'branch.' + branch + '.remote'], true).stdout.trim() || 'origin';
  const upstream = run(
    ['git', 'rev-parse', '--abbrev-ref', '@{u}'],
    true,
  ).stdout.trim();

  console.log(`>> Current branch: ${branch}`);
  console.log(`>> Tracking remote: ${remote}${upstream ? ' (' + upstream + ')' : ''}`);

  // 3. Working-tree must be clean — refuse to clobber local edits
  const statusPorcelain = run(['git', 'status', '--porcelain'], true).stdout.trim();
  if (statusPorcelain.length > 0) {
    console.error('Error: working tree has uncommitted changes. Commit or stash before updating.');
    console.error(statusPorcelain);
    return 1;
  }

  // 4. Plan the actions once; the same list drives execution below.
  const actions = selectUpdateActions(opts);
  const steps = [
    `git pull --ff-only (current upstream branch: ${branch})`,
    ...actions.map(describeUpdateAction),
  ];

  console.log('>> Plan:');
  for (const s of steps) console.log(`     - ${s}`);

  if (opts.check) {
    console.log('>> --check set: not modifying anything.');
    return 0;
  }

  // 5. Fast-forward-only pull of the current upstream branch.
  console.log('>> git pull --ff-only');
  const pull = run(['git', 'pull', '--ff-only'], true);
  process.stdout.write(pull.stdout);
  if (pull.stderr.length > 0) process.stderr.write(pull.stderr);
  if (pull.exitCode !== 0) {
    console.error('Error: git pull --ff-only failed; nothing was built or installed.');
    return pull.exitCode || 1;
  }

  const head = run(['git', 'rev-parse', '--short', 'HEAD'], true).stdout.trim();

  // 6. Run the planned actions. A failure is surfaced as partial completion:
  //    the completed pull stays in place and is never rolled back.
  for (const action of actions) {
    const label = describeUpdateAction(action);
    console.log(`>> ${label}`);
    const result = run(commandForAction(action), true);
    process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);

    if (result.exitCode !== 0) {
      console.error(
        `>> pas update: partial — ${label} failed (exit ${result.exitCode}) after pulling ${head}.`,
      );
      console.error(`>> The checkout remains at ${head}; nothing was rolled back.`);
      console.error(`>> Fix the failure and re-run \`${label}\`.`);
      return result.exitCode || 1;
    }
  }

  console.log('>> pas update: done.');
  return 0;
}

export const updateCommand = defineCommand({
  meta: {
    name: 'update',
    description: 'Pull the current upstream PAS branch, then install OpenCode (or build/reinstall)',
  },
  args: {
    check: {
      type: 'boolean',
      description: 'Show the plan without pulling, building, or installing',
    },
    rebuild: {
      type: 'boolean',
      description: 'After pulling, run `pas build --target=opencode` (no install)',
    },
    reinstall: {
      type: 'boolean',
      description: 'After pulling, run `pas install --target=opencode`',
    },
  },
  async run({ args }) {
    const code = await performUpdate({
      check: Boolean(args.check),
      rebuild: Boolean(args.rebuild),
      reinstall: Boolean(args.reinstall),
    });
    if (code !== 0) process.exit(code);
  },
});

export default updateCommand;
