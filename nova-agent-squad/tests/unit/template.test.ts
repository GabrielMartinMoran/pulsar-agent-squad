import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('nas_caveman.eta template', () => {
  it('should render developer section for agent=developer', async () => {
    const template = readFileSync('src/cli/templates/nas_caveman.eta', 'utf-8');
    const { Eta } = await import('eta');
    const eta = new Eta({ autoTrim: false });
    const result = eta.renderString(template, { agent: 'developer' });
    expect(result).toContain('## Developer');
    expect(result).toContain('## Preserve exactly');
  });

  it('should render QA section for agent=qa', async () => {
    const template = readFileSync('src/cli/templates/nas_caveman.eta', 'utf-8');
    const { Eta } = await import('eta');
    const eta = new Eta({ autoTrim: false });
    const result = eta.renderString(template, { agent: 'qa' });
    expect(result).toContain('## QA');
    expect(result).not.toContain('## Developer');
    expect(result).toContain('## Preserve exactly');
  });

  it('should render shared section for both agents', async () => {
    const template = readFileSync('src/cli/templates/nas_caveman.eta', 'utf-8');
    const { Eta } = await import('eta');
    const eta = new Eta({ autoTrim: false });
    const devResult = eta.renderString(template, { agent: 'developer' });
    const qaResult = eta.renderString(template, { agent: 'qa' });

    expect(devResult).toContain('# NAS Caveman Reference');
    expect(qaResult).toContain('# NAS Caveman Reference');
    expect(devResult).toContain('## Preserve exactly');
    expect(qaResult).toContain('## Preserve exactly');
    expect(devResult).toContain('## Auto-clarity');
    expect(qaResult).toContain('## Auto-clarity');
  });
});

describe('nas_developer_shared.eta template', () => {
  it('constraints section: renders developer_mini constraints with extra item 9', async () => {
    const { Eta } = await import('eta');
    const eta = new Eta({ autoTrim: false });
    const template = readFileSync('src/cli/templates/nas_developer_shared.eta', 'utf-8');
    const result = eta.renderString(template, { agent: 'developer_mini', section: 'constraints' });

    // Mini has item 9 about ambiguity escalation
    expect(result).toContain('9. If you encounter ANY ambiguity, unclear requirement, or missing information: ESCALATE with BLOCKED + `question_for_user`.');
    // Mini's item 1 has "Nothing more" appended
    expect(result).toContain('1. ONLY implement what is in the approved apply contract. Nothing more.');
  });

  it('tool_guidance section: renders developer_mini tool guidance', async () => {
    const { Eta } = await import('eta');
    const eta = new Eta({ autoTrim: false });
    const template = readFileSync('src/cli/templates/nas_developer_shared.eta', 'utf-8');
    const result = eta.renderString(template, { agent: 'developer_mini', section: 'tool_guidance' });

    // Mini uses 'bun test' not 'make test'
    expect(result).toContain('`bun test`');
    expect(result).not.toContain('`make test`');
    // Mini has shorter descriptions
    expect(result).toContain('Read existing files to understand structure');
  });

  it('output_format section: renders developer_mini output format with different heading', async () => {
    const { Eta } = await import('eta');
    const eta = new Eta({ autoTrim: false });
    const template = readFileSync('src/cli/templates/nas_developer_shared.eta', 'utf-8');
    const result = eta.renderString(template, { agent: 'developer_mini', section: 'output_format' });

    // Mini has the extra parenthetical in the heading
    expect(result).toContain('## Output format (same contract as full developer for uniform QA validation)');
    expect(result).toContain('<implementation_report>');
  });

  it('handoff section: renders identically for both agents', async () => {
    const { Eta } = await import('eta');
    const eta = new Eta({ autoTrim: false });
    const template = readFileSync('src/cli/templates/nas_developer_shared.eta', 'utf-8');
    const devResult = eta.renderString(template, { agent: 'developer', section: 'handoff' });
    const miniResult = eta.renderString(template, { agent: 'developer_mini', section: 'handoff' });

    expect(devResult.trimEnd()).toBe(miniResult.trimEnd());
    expect(devResult).toContain('## Handoff');
    expect(devResult).toContain('If blocked, at risk, or insufficient progress:');
  });
});
