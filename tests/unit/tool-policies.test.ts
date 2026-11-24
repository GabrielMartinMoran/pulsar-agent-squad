import { describe, expect, it } from 'bun:test';
import {
  blockTool,
  buildToolsSummary,
  canonicalToolIdentifier,
  clearBlockedTools,
  criticalToolWarnings,
  normalizeTool,
  unblockTool,
} from '../../src/cli/lib/tool-policies';
import type { ToolPolicyStore } from '../../src/cli/lib/policy-store';
import { PAS_AGENTS } from '../../src/cli/commands/agents/presenter';

const empty: ToolPolicyStore = { version: 1, agents: {} };

describe('tool policies', () => {
  it('fans out to every PAS agent by default and targets one named agent', () => {
    const all = blockTool(empty, 'webfetch');
    expect(Object.keys(all.agents).sort()).toEqual([...PAS_AGENTS].sort());

    const one = blockTool(empty, 'shell', 'agent', 'pas_qa');
    expect(Object.keys(one.agents)).toEqual(['pas_qa']);
    expect(one.agents.pas_qa?.tools).toEqual(['shell']);
  });

  it('is idempotent and scopes unblock and clear to the selected agent', () => {
    const seeded = blockTool(blockTool(empty, 'shell'), 'webfetch');
    expect(blockTool(seeded, 'shell')).toEqual(seeded);
    expect(blockTool(seeded, 'shell', 'agent', 'pas_qa')).toEqual(seeded);

    const unblocked = unblockTool(seeded, 'shell', 'agent', 'pas_qa');
    expect(unblocked.agents.pas_qa?.tools).toEqual(['webfetch']);
    expect(unblocked.agents.pas_developer?.tools).toEqual([
      'shell',
      'webfetch',
    ]);

    const cleared = clearBlockedTools(seeded, 'agent', 'pas_qa');
    expect(cleared.agents.pas_qa).toBeUndefined();
    expect(cleared.agents.pas_developer?.tools).toEqual([
      'shell',
      'webfetch',
    ]);
  });

  it('never grants: allow and ask effects are rejected', () => {
    expect(() =>
      blockTool(empty, 'shell', 'all-pas', undefined, 'allow'),
    ).toThrow(/deny-only/i);
    expect(() => blockTool(empty, 'shell', 'all-pas', undefined, 'ask')).toThrow(
      /deny-only/i,
    );
  });

  it('statically validates identifiers so a deny cannot become a wildcard', () => {
    expect(canonicalToolIdentifier('bash')).toEqual({
      tool: 'shell',
      normalizedFrom: 'bash',
    });
    expect(canonicalToolIdentifier('task')).toEqual({
      tool: 'subagent',
      normalizedFrom: 'task',
    });
    expect(canonicalToolIdentifier('write')).toEqual({
      tool: 'edit',
      normalizedFrom: 'write',
    });
    expect(canonicalToolIdentifier('patch')).toEqual({
      tool: 'edit',
      normalizedFrom: 'patch',
    });

    for (const invalid of ['', ' ', '*', 'shell *', 'read?', '../x', 'a\nb', '"x"']) {
      expect(() => canonicalToolIdentifier(invalid)).toThrow(
        /Invalid tool identifier|non-empty/,
      );
    }
  });

  it('warns for unknown but syntactically valid identifiers', () => {
    expect(normalizeTool('vendor:custom')).toEqual({
      tool: 'vendor:custom',
      warning: expect.any(String),
    });
    expect(normalizeTool('shell')).toEqual({ tool: 'shell' });
  });

  it('clears only PAS agents and preserves unrelated stored agents', () => {
    const seeded: ToolPolicyStore = {
      version: 1,
      agents: {
        ...blockTool(empty, 'shell').agents,
        legacy_agent: { tools: ['read'] },
      },
    };
    const cleared = clearBlockedTools(seeded, 'all-pas');
    expect(cleared.agents.legacy_agent).toEqual({ tools: ['read'] });
    for (const agent of PAS_AGENTS) {
      expect(cleared.agents[agent]).toBeUndefined();
    }
  });

  it('prints a stable read-only summary without ANSI when plain is set', () => {
    const summary = buildToolsSummary(
      {
        version: 1,
        agents: {
          'Pulsar Agent Squad': { tools: ['shell'] },
        },
      },
      { plain: true },
      { isTTY: false, noColor: undefined },
    );
    for (const agent of PAS_AGENTS) expect(summary).toContain(agent);
    expect(summary).toContain('shell');
    expect(summary).toContain('(none)');
    expect(summary).not.toContain('\x1b[');
  });

  it('warns only about blocks that break a role workflow', () => {
    expect(
      criticalToolWarnings({
        version: 1,
        agents: {
          'Pulsar Agent Squad': { tools: ['subagent'] },
          pas_qa: { tools: ['shell'] },
        },
      }),
    ).toEqual([
      'Warning: Pulsar Agent Squad blocks workflow-critical subagent.',
      'Warning: pas_qa blocks workflow-critical shell.',
    ]);
    expect(
      criticalToolWarnings({
        version: 1,
        agents: { pas_qa: { tools: ['webfetch'] } },
      }),
    ).toEqual([]);
  });
});
