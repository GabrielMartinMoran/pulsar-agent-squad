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
