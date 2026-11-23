import { describe, expect, it } from 'bun:test';
import { blockTool, clearBlockedTools, normalizeTool, unblockTool } from '../../src/cli/lib/tool-policies';
import { PAS_AGENTS } from '../../src/cli/commands/agents/presenter';

const empty = { version: 1 as const, agents: {} };

describe('tool policies', () => {
  it('fans out by default and targets one named agent', () => {
    const all = blockTool(empty, 'webfetch', 'all-pas');
    expect(Object.keys(all.agents)).toEqual(PAS_AGENTS);
    const one = blockTool(empty, 'shell', 'agent', PAS_AGENTS[0]);
    expect(Object.keys(one.agents)).toEqual([PAS_AGENTS[0]]);
  });

  it('normalizes aliases, warns for unknown tools, and rejects non-deny effects', () => {
    expect(normalizeTool('bash')).toEqual({ tool: 'shell', normalizedFrom: 'bash' });
    expect(normalizeTool('vendor:custom')).toEqual({ tool: 'vendor:custom', warning: expect.any(String) });
    expect(() => blockTool(empty, 'shell', 'all-pas', undefined, 'allow')).toThrow(/deny-only.*role prompts/i);
  });

  it('unblocks only the selected tool and clears only the selected agent', () => {
    const seeded = blockTool(blockTool(empty, 'shell', 'all-pas'), 'webfetch', 'all-pas');
    const unblocked = unblockTool(seeded, 'shell', 'all-pas');
    expect(unblocked.agents[PAS_AGENTS[0]]?.tools).toEqual(['webfetch']);
    expect(clearBlockedTools(unblocked, 'agent', PAS_AGENTS[0]).agents[PAS_AGENTS[1]]?.tools).toEqual(['webfetch']);
  });
});
