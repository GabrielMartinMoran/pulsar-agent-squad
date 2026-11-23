import { describe, expect, it } from 'bun:test';
import { AbortPromptError } from '@inquirer/core';
import { runToolsSetup, type ToolsPrompts } from '../../src/cli/commands/tools/setup-core';
import { blockTool, unblockTool } from '../../src/cli/lib/tool-policies';

describe('tools setup core', () => {
  it('applies block and unblock immediately, then cancel preserves the last state', async () => {
    const actions = ['block', 'unblock', 'cancel']; const saved: string[][] = [];
    const prompts: ToolsPrompts = {
      action: async () => actions.shift() as 'block' | 'unblock' | 'cancel', scope: async () => 'all-pas', agent: async () => '',
      tool: async (_signal, choices) => choices.includes('shell') ? 'shell' : '', confirm: async () => true,
    };
    const result = await runToolsSetup({ initial: { version: 1, agents: {} }, prompts,
      mutate: (store, action, scope, agent, tool) => action === 'block' ? blockTool(store, tool!, scope, agent) : action === 'unblock' ? unblockTool(store, tool!, scope, agent) : { version: 1, agents: {} },
      save: (store) => saved.push(Object.values(store.agents).flatMap((agent) => agent.tools)),
    });
    expect(saved[0]).toHaveLength(5); expect(saved[0]?.every((tool) => tool === 'shell')).toBe(true);
    expect(saved[1]).toEqual([]); expect(result.applied).toBe(2); expect(result.store.agents).toEqual({});
  });

  it('exits cleanly when the main menu is escaped', async () => {
    const prompts: ToolsPrompts = { action: async () => { throw new AbortPromptError(); }, scope: async () => 'all-pas', agent: async () => '', tool: async () => '', confirm: async () => true };
    const result = await runToolsSetup({ initial: { version: 1, agents: {} }, prompts, mutate: (store) => store, save: () => {} });
    expect(result.applied).toBe(0); expect(result.store.agents).toEqual({});
  });
});
