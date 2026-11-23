import type { PolicyStore } from './policy-store';
import { PAS_AGENTS } from '../commands/agents/presenter';

export type ToolScope = 'all-pas' | 'agent';
const aliases: Record<string, string> = { bash: 'shell', task: 'subagent', write: 'edit', patch: 'edit' };
const known = new Set(['shell', 'subagent', 'edit', 'read', 'glob', 'grep', 'webfetch', 'websearch', 'question', 'todowrite']);

export function normalizeTool(identifier: string): { tool: string; normalizedFrom?: string; warning?: string } {
  const raw = identifier.trim();
  if (!raw) throw new Error('Tool identifier must be a non-empty string.');
  const tool = aliases[raw] ?? raw;
  if (tool !== raw) return { tool, normalizedFrom: raw };
  if (!known.has(tool)) return { tool, warning: `Unrecognized tool "${tool}"; storing it as provided.` };
  return { tool };
}

function targets(scope: ToolScope, agent?: string): string[] {
  if (scope === 'all-pas') return PAS_AGENTS;
  if (!agent) throw new Error('Scope "agent" requires --agent <name>.');
  if (!PAS_AGENTS.includes(agent as typeof PAS_AGENTS[number])) throw new Error(`Unknown PAS agent "${agent}".`);
  return [agent];
}

function withTools(store: PolicyStore, names: string[], update: (tools: string[]) => string[]): PolicyStore {
  const agents = { ...store.agents };
  for (const name of names) {
    const prior = agents[name] ?? { skills: {}, tools: [] };
    const tools = [...new Set(update([...prior.tools]))].sort();
    if (!Object.keys(prior.skills).length && !tools.length) delete agents[name];
    else agents[name] = { ...prior, tools };
  }
  return { version: 1, agents };
}

export function blockTool(store: PolicyStore, identifier: string, scope: ToolScope = 'all-pas', agent?: string, effect = 'deny'): PolicyStore {
  if (effect !== 'deny') throw new Error(`Tools are deny-only; allow/ask are rejected. Edit the role prompts to change a role's base permissions.`);
  const { tool } = normalizeTool(identifier);
  return withTools(store, targets(scope, agent), (tools) => [...tools, tool]);
}

export function unblockTool(store: PolicyStore, identifier: string, scope: ToolScope = 'all-pas', agent?: string): PolicyStore {
  const { tool } = normalizeTool(identifier);
  return withTools(store, targets(scope, agent), (tools) => tools.filter((entry) => entry !== tool));
}

export function clearBlockedTools(store: PolicyStore, scope: ToolScope | 'all' = 'all', agent?: string): PolicyStore {
  return withTools(store, targets(scope === 'all' ? 'all-pas' : scope, agent), () => []);
}

export function criticalToolWarnings(store: PolicyStore): string[] {
  const primary = ['Pulsar Agent Squad', 'Pulsar Agent Turbo'];
  const workers = PAS_AGENTS.filter((name) => !primary.includes(name));
  return [...primary.filter((name) => store.agents[name]?.tools.includes('subagent')).map((name) => `Warning: ${name} blocks workflow-critical subagent.`), ...workers.flatMap((name) => ['edit', 'shell'].filter((tool) => store.agents[name]?.tools.includes(tool)).map((tool) => `Warning: ${name} blocks workflow-critical ${tool}.`))];
}
