import { defineCommand } from 'citty';
import { spawnSync } from 'bun';

/**
 * Run a shell command and return its captured stdout.
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

/**
 * `nas update` — pull the current upstream branch and (optionally) rebuild
 * and reinstall the canonical target.
 *
 * Contract:
 *   - Default branch behavior: the current upstream branch
 *     (i.e. `git pull` with no explicit branch argument).
 *   - Does NOT implement release-based updater logic (no /releases/latest,
 *     no version pin, no tag fetch). This command is a local checkout helper
 *     for users who track the main branch.
 *   - Does NOT auto-install bun or auto-edit default_agent.
 *   - Does NOT modify tracked files outside of `git pull`'s own behavior.
 */
export async function performUpdate(opts: UpdateOptions): Promise<number> {
  // 1. Pre-flight: must be inside a git working tree
  const inRepo = run(['git', 'rev-parse', '--is-inside-work-tree'], true);
  if (inRepo.exitCode !== 0 || inRepo.stdout.trim() !== 'true') {
    console.error('Error: not a git repository. Run `nas update` from inside a NAS checkout.');
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

  // 3. Working-tree must be clean (or stashed) — refuse to clobber local edits
  const statusPorcelain = run(['git', 'status', '--porcelain'], true).stdout.trim();
  if (statusPorcelain.length > 0) {
    console.error('Error: working tree has uncommitted changes. Commit or stash before updating.');
    console.error(statusPorcelain);
    return 1;
  }

  // 4. Plan the actions
  const steps: string[] = [`git pull (current upstream branch: ${branch})`];
  if (opts.rebuild) steps.push('nas build --target=opencode');
  if (opts.reinstall) steps.push('nas install --target=opencode');

  console.log('>> Plan:');
  for (const s of steps) console.log(`     - ${s}`);

  if (opts.check) {
    console.log('>> --check set: not modifying anything.');
    return 0;
  }

  // 5. git pull — current upstream branch behavior
  console.log('>> git pull');
  const pull = run(['git', 'pull', '--ff-only'], false);
  process.stdout.write(pull.stdout);
  if (pull.stderr.length > 0) process.stderr.write(pull.stderr);

  // 6. Optional rebuild / reinstall — only when explicitly requested
  if (opts.rebuild) {
    console.log('>> nas build --target=opencode');
    run(['bun', 'run', 'cli', 'build', '--target=opencode'], false);
  }
  if (opts.reinstall) {
    console.log('>> nas install --target=opencode');
    run(['bun', 'run', 'cli', 'install', '--target=opencode'], false);
  }

  console.log('>> nas update: done.');
  return 0;
}

export const updateCommand = defineCommand({
  meta: {
    name: 'update',
    description: 'Pull the current upstream NAS branch (optionally rebuild and reinstall)',
  },
  args: {
    check: {
      type: 'boolean',
      description: 'Show the plan without modifying anything',
    },
    rebuild: {
      type: 'boolean',
      description: 'After pulling, run `nas build --target=opencode`',
    },
    reinstall: {
      type: 'boolean',
      description: 'After pulling, run `nas install --target=opencode`',
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
