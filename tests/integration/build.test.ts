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
      'Pulsar Agent Turbo.md',
      'pas_developer.md',
      'pas_qa.md',
      'pas_researcher.md',
    ]);
  });

  it('should build the self-contained pas_developer.md prompt', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);

    const devContent = readFileSync('dist/platforms/opencode/agents/pas_developer.md', 'utf-8');
    expect(devContent).toContain('<skill_application>');
    expect(devContent).toContain('<test_coverage_explanation>');
    expect(devContent).not.toContain('INJECT:developer_shared');
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

  it('should build the pas-toolkit plugin byte-identical to its source', async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);

    const builtPath = 'dist/platforms/opencode/plugins/pas-toolkit.ts';
    expect(existsSync(builtPath)).toBe(true);

    const built = readFileSync(builtPath);
    const source = readFileSync('src/tools/pas-toolkit.ts');
    expect(built.equals(source)).toBe(true);
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

/**
 * The Lead prompt is prose; line wrapping inside the built artifact is not
 * part of its contract. Normalize whitespace so the assertions below pin
 * meaning instead of layout.
 */
function normalizeLeadPrompt(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

describe('built Lead prompt: parallel research contract', () => {
  let leadPrompt = '';

  beforeAll(async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);
    leadPrompt = normalizeLeadPrompt(
      readFileSync('dist/platforms/opencode/agents/Pulsar Agent Squad.md', 'utf-8'),
    );
  });

  it('runs research as one background batch with disjoint scopes', () => {
    expect(leadPrompt).toContain('## Parallel research batch');
    expect(leadPrompt).toContain('one `pas_researcher` per independent question');
    expect(leadPrompt).toContain('background: true');
    expect(leadPrompt).toContain('disjoint scopes');
    expect(leadPrompt).toContain('must not overlap in files or topics');
    expect(leadPrompt).toContain('Start with 2 researchers');
    expect(leadPrompt).toContain(
      'extend to 3 only when every question is clearly independent',
    );
    expect(leadPrompt).toContain('overlapping or dependent questions stay sequential');
    expect(leadPrompt).toContain('one researcher at a time');
    expect(leadPrompt).toContain('dispatch them as one background batch');
  });

  it('processes grouped or individual batch completions before the gate', () => {
    expect(leadPrompt).toContain('<subagent sessionID=');
    expect(leadPrompt).toContain('individually or grouped');
    expect(leadPrompt).toContain(
      'Process all completions before opening the Research Quality Gate',
    );
    expect(leadPrompt).toContain('one progress line per completed subagent');
    expect(leadPrompt).toContain('merged evidence');
  });

  it('falls back to sequential foreground research when background fails', () => {
    expect(leadPrompt).toContain('fall back to sequential foreground research');
    expect(leadPrompt).toContain('Never claim parallel execution');
  });

  it('keeps developer and QA delegations strictly sequential', () => {
    expect(leadPrompt).toContain('one at a time outside the research batch');
    expect(leadPrompt).toContain('developer and QA delegations remain strictly sequential');
    expect(leadPrompt).toContain('one atomic task at a time');
    expect(leadPrompt).not.toContain('one at a time. After');
  });

  it('keeps the approval gate and planning gates intact', () => {
    expect(leadPrompt).toContain('Implementation plan is ready. Do you');
    expect(leadPrompt).toContain('Research Quality Gate');
    expect(leadPrompt).toContain('Planning Quality Gate');
  });
});

describe('built Lead prompt: runtime permission contract', () => {
  let leadPrompt = '';

  beforeAll(async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);
    leadPrompt = normalizeLeadPrompt(
      readFileSync('dist/platforms/opencode/agents/Pulsar Agent Squad.md', 'utf-8'),
    );
  });

  it('treats a denial as configured policy, never as an incident', () => {
    expect(leadPrompt).toContain('## Runtime permissions and capabilities');
    expect(leadPrompt).toContain('is a configured policy, not an error');
    expect(leadPrompt).toContain('Never probe, retry, or investigate your permissions');
  });

  it('states the direct access profile, including compound shell rules', () => {
    expect(leadPrompt).toContain('`read`: `.pas/**`, `specs/**/*.feature`, and `docs/**`');
    expect(leadPrompt).toContain(
      'single commands matching `./pas *`, `git log *`, `git diff *`, or exactly `git status`',
    );
    expect(leadPrompt).toContain('compound commands pass only when every part is allowlisted');
    expect(leadPrompt).toContain('`subagent`: `pas_researcher`, `pas_developer`, `pas_qa`');
  });

  it('routes out-of-allowlist work to workers without re-litigating boundaries', () => {
    expect(leadPrompt).toContain('It is read-only and has no shell');
    expect(leadPrompt).toContain('Do not re-litigate a boundary mid-run');
    expect(leadPrompt).toContain('Those capabilities never transfer to you');
  });

  it('honors the workspace boundary for cross-directory PAS work', () => {
    expect(leadPrompt).toContain('delegate the one-time `.pas/` bootstrap to `pas_developer`');
    expect(leadPrompt).toContain('Never test a cross-directory `.pas/` write');
    expect(leadPrompt).toContain('banner concerns memory continuity, not permissions');
  });
});

describe('built Lead prompt: state lifecycle and hygiene contract', () => {
  let leadPrompt = '';

  beforeAll(async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);
    leadPrompt = normalizeLeadPrompt(
      readFileSync('dist/platforms/opencode/agents/Pulsar Agent Squad.md', 'utf-8'),
    );
  });

  it('defines the numbered-directory lifecycle section', () => {
    expect(leadPrompt).toContain('## State lifecycle and hygiene');
    expect(leadPrompt).toContain('five digits, zero-padded');
    expect(leadPrompt).toContain('Active holds only in-flight features');
    expect(leadPrompt).toContain('never renumber, never delete');
  });

  it('routes state operations through the installed toolkit with hygiene duties', () => {
    expect(leadPrompt).toContain('through the installed PAS toolkit');
    expect(leadPrompt).toContain(
      'Run `pas_toolkit check` at startup and before lifecycle transitions',
    );
    expect(leadPrompt).toContain('offer a cleanup');
    expect(leadPrompt).toContain('separately authorized work');
  });

  it('grants the toolkit permission and archives through the tool', () => {
    expect(leadPrompt).toContain('pas_toolkit: allow');
    expect(leadPrompt).toContain(
      'archive the feature state with `pas_toolkit archive`',
    );
  });
});

/**
 * The worker prompts are prose; line wrapping inside the built artifacts is
 * not part of their contract. Normalize whitespace so the assertions below
 * pin meaning instead of layout.
 */
function normalizeWorkerPrompt(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

describe('built worker prompts: internal parallelism guards', () => {
  let qaPrompt = '';
  let developerPrompt = '';

  beforeAll(async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);
    qaPrompt = normalizeWorkerPrompt(
      readFileSync('dist/platforms/opencode/agents/pas_qa.md', 'utf-8'),
    );
    developerPrompt = normalizeWorkerPrompt(
      readFileSync('dist/platforms/opencode/agents/pas_developer.md', 'utf-8'),
    );
  });

  it('runs independent QA checks concurrently and shared-state checks in sequence', () => {
    expect(qaPrompt).toContain('Run independent checks concurrently');
    expect(qaPrompt).toContain('share mutable state in sequence');
  });

  it('batches independent QA read, grep, and glob calls', () => {
    expect(qaPrompt).toContain('concurrent `bash` calls for independent checks');
    expect(qaPrompt).toContain('Batch independent `read`, `grep`, and `glob` calls');
  });

  it('batches side-effect-free developer calls while ordered work stays sequential', () => {
    expect(developerPrompt).toContain('Batch independent, side-effect-free calls');
    expect(developerPrompt).toContain('Keep ordered work strictly sequential');
  });
});

describe('built prompts: scenario tag policy', () => {
  let leadPrompt = '';
  let developerPrompt = '';
  let qaPrompt = '';

  beforeAll(async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);
    leadPrompt = normalizeLeadPrompt(
      readFileSync('dist/platforms/opencode/agents/Pulsar Agent Squad.md', 'utf-8'),
    );
    developerPrompt = normalizeWorkerPrompt(
      readFileSync('dist/platforms/opencode/agents/pas_developer.md', 'utf-8'),
    );
    qaPrompt = normalizeWorkerPrompt(
      readFileSync('dist/platforms/opencode/agents/pas_qa.md', 'utf-8'),
    );
  });

  it('tags every scenario with exactly one class tag at the lightest reliable level', () => {
    expect(leadPrompt).toContain('## Scenario tag policy');
    expect(leadPrompt).toContain('exactly one class tag');
    expect(leadPrompt).toContain(
      '`@unit`, `@integration`, `@contract`, `@e2e`, or `@manual`',
    );
    expect(leadPrompt).toContain('lightest reliable level');
    expect(leadPrompt).toContain('manual verification procedure');
  });

  it('implements tests at the class tag level and escalates instead of upgrading', () => {
    expect(developerPrompt).toContain('at its class tag level');
    expect(developerPrompt).toContain(
      'escalate (`test_strategy`) instead of upgrading the test',
    );
    expect(developerPrompt).toContain('`@manual` scenarios are not automated');
  });

  it('verifies tests against the class tag and keeps manual procedures', () => {
    expect(qaPrompt).toContain("Verify each scenario's tests against its class tag");
    expect(qaPrompt).toContain('`@manual` scenarios keep their manual procedure');
  });
});

describe('built prompts: project documentation contract', () => {
  let leadPrompt = '';
  let developerPrompt = '';
  let qaPrompt = '';

  beforeAll(async () => {
    const result = await $`bun run ${CLI_ENTRY} build --target=opencode`.quiet();
    expect(result.exitCode).toBe(0);
    leadPrompt = normalizeLeadPrompt(
      readFileSync('dist/platforms/opencode/agents/Pulsar Agent Squad.md', 'utf-8'),
    );
    developerPrompt = normalizeWorkerPrompt(
      readFileSync('dist/platforms/opencode/agents/pas_developer.md', 'utf-8'),
    );
    qaPrompt = normalizeWorkerPrompt(
      readFileSync('dist/platforms/opencode/agents/pas_qa.md', 'utf-8'),
    );
  });

  it('documents living docs as maps that reference their sources', () => {
    expect(leadPrompt).toContain('## Project documentation');
    expect(leadPrompt).toContain('are maps, not manuals');
    expect(leadPrompt).toContain('superseded, never rewritten');
    expect(leadPrompt).toContain('ubiquitous-language glossary');
    expect(leadPrompt).toContain('reference Figma when the project uses it');
    expect(leadPrompt).toContain('feature groups with pointers to their Gherkin specs');
  });

  it('extends the Lead read profile to docs/', () => {
    expect(leadPrompt).toContain(
      '`read`: `.pas/**`, `specs/**/*.feature`, and `docs/**`',
    );
  });

  it('requires the developer to update docs in the same task', () => {
    expect(developerPrompt).toContain('keep docs as maps that reference code and specs');
    expect(developerPrompt).toContain('supersede accepted ADRs instead of rewriting them');
  });

  it('requires QA to verify the docs update in the same diff', () => {
    expect(qaPrompt).toContain(
      'verify the matching `docs/` file was updated in the same diff',
    );
  });
});
