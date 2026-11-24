import { describe, expect, it } from 'bun:test';
import { AbortPromptError } from '@inquirer/core';
import {
  runToolsSetup,
  type ToolsPrompts,
} from '../../src/cli/commands/tools/setup-core';
import { blockTool, unblockTool } from '../../src/cli/lib/tool-policies';
import type { ToolPolicyStore } from '../../src/cli/lib/policy-store';

const empty: ToolPolicyStore = { version: 1, agents: {} };

function prompts(overrides: Partial<ToolsPrompts> = {}): ToolsPrompts {
  return {
    action: async () => 'cancel',
    scope: async () => 'all-pas',
    agent: async () => 'pas_qa',
    tool: async (_signal, choices) =>
      choices.includes('shell') ? 'shell' : 'read',
    confirm: async () => true,
    ...overrides,
  };
}

describe('tools setup core', () => {
  it('applies confirmed block and unblock actions immediately', async () => {
    const actions: Array<'block' | 'unblock' | 'cancel'> = [
      'block',
      'unblock',
      'cancel',
    ];
    const saved: string[][] = [];
    const result = await runToolsSetup({
      initial: empty,
      prompts: prompts({
        action: async () => actions.shift() as 'block' | 'unblock' | 'cancel',
      }),
      mutate: (store, action, scope, agent, tool) =>
        action === 'block'
          ? blockTool(store, tool!, scope, agent)
          : unblockTool(store, tool!, scope, agent),
      save: (store) =>
        saved.push(Object.values(store.agents).flatMap((entry) => entry.tools)),
    });

    expect(saved).toHaveLength(2);
    expect(saved[0]).toHaveLength(5);
    expect(saved[0]?.every((tool) => tool === 'shell')).toBe(true);
    expect(saved[1]).toEqual([]);
    expect(result.applied).toBe(2);
    expect(result.store.agents).toEqual({});
  });

  it('does not write when the main menu is escaped', async () => {
    let saves = 0;
    const result = await runToolsSetup({
      initial: empty,
      prompts: prompts({
        action: async () => {
          throw new AbortPromptError();
        },
      }),
      mutate: (store) => store,
      save: () => {
        saves++;
      },
    });

    expect(saves).toBe(0);
    expect(result.applied).toBe(0);
    expect(result.store).toEqual(empty);
  });

  it('returns to the main menu when an inner step is escaped, then cancels', async () => {
    const actions: Array<'block' | 'cancel'> = ['block', 'cancel'];
    let scopeCalls = 0;
    let saves = 0;
    const result = await runToolsSetup({
      initial: empty,
      prompts: prompts({
        action: async () => actions.shift() as 'block' | 'cancel',
        scope: async () => {
          scopeCalls++;
          if (scopeCalls === 1) throw new AbortPromptError();
          return 'all-pas';
        },
      }),
      mutate: (store) => store,
      save: () => {
        saves++;
      },
    });

    expect(scopeCalls).toBe(1);
    expect(saves).toBe(0);
    expect(result.applied).toBe(0);
  });

  it('does not write when the confirmation is declined', async () => {
    const actions: Array<'clear' | 'cancel'> = ['clear', 'cancel'];
    let saves = 0;
    const result = await runToolsSetup({
      initial: empty,
      prompts: prompts({
        action: async () => actions.shift() as 'clear' | 'cancel',
        confirm: async () => false,
      }),
      mutate: (store) => store,
      save: () => {
        saves++;
      },
    });

    expect(saves).toBe(0);
    expect(result.applied).toBe(0);
  });

  it('propagates real prompt errors', async () => {
    await expect(
      runToolsSetup({
        initial: empty,
        prompts: prompts({
          action: async () => {
            throw new Error('prompt unavailable');
          },
        }),
        mutate: (store) => store,
        save: () => {},
      }),
    ).rejects.toThrow('prompt unavailable');
  });
});
