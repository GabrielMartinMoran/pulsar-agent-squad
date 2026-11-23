import { AbortPromptError } from '@inquirer/core';
import type { PolicyStore } from '../../lib/policy-store';
import type { ToolScope } from '../../lib/tool-policies';

export interface ToolsPrompts {
  action(signal: AbortSignal): Promise<'block' | 'unblock' | 'clear' | 'cancel'>;
  scope(signal: AbortSignal): Promise<ToolScope>;
  agent(signal: AbortSignal): Promise<string>;
  tool(signal: AbortSignal, choices: string[]): Promise<string>;
  confirm(signal: AbortSignal, message: string): Promise<boolean>;
}
export interface ToolsSetupDeps {
  initial: PolicyStore;
  prompts: ToolsPrompts;
  mutate(store: PolicyStore, action: 'block' | 'unblock' | 'clear', scope: ToolScope, agent?: string, tool?: string): PolicyStore;
  save(store: PolicyStore): void;
  isAbort?(error: unknown): boolean;
  signal?(): { signal: AbortSignal; dispose(): void };
}
const signalSession = () => { const controller = new AbortController(); return { signal: controller.signal, dispose() {} }; };

export async function runToolsSetup(deps: ToolsSetupDeps): Promise<{ store: PolicyStore; applied: number }> {
  let store = deps.initial; let applied = 0;
  const ask = async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<{ value: T } | { escaped: true }> => {
    const session = (deps.signal ?? signalSession)();
    try { return { value: await fn(session.signal) }; }
    catch (error) { if ((deps.isAbort ?? ((value) => value instanceof AbortPromptError))(error)) return { escaped: true }; throw error; }
    finally { session.dispose(); }
  };
  while (true) {
    const chosen = await ask(deps.prompts.action);
    if ('escaped' in chosen || chosen.value === 'cancel') return { store, applied };
    const action = chosen.value;
    const scopeResult = await ask(deps.prompts.scope);
    if ('escaped' in scopeResult) continue;
    const scope = scopeResult.value;
    let agent: string | undefined;
    if (scope === 'agent') {
      const selected = await ask(deps.prompts.agent);
      if ('escaped' in selected) continue;
      agent = selected.value;
    }
    let tool: string | undefined;
    if (action !== 'clear') {
      const choices = Array.from(new Set([...Object.values(store.agents).flatMap((entry) => entry.tools), 'shell', 'subagent', 'edit', 'read', 'glob', 'grep', 'webfetch', 'websearch'])).sort();
      const selected = await ask((signal) => deps.prompts.tool(signal, choices));
      if ('escaped' in selected) continue;
      tool = selected.value;
    }
    const confirmed = await ask((signal) => deps.prompts.confirm(signal, `${action}${tool ? ` ${tool}` : ''}?`));
    if ('escaped' in confirmed) continue;
    if (!confirmed.value) continue;
    store = deps.mutate(store, action, scope, agent, tool);
    deps.save(store); applied++;
  }
}
