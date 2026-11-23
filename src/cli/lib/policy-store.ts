import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { OpenCodeConfig, PermissionAction } from './config-safety';

export interface AgentPolicy { skills: Record<string, PermissionAction>; tools: string[] }
export interface PolicyStore { version: 1; agents: Record<string, AgentPolicy> }
const defaultHome = () => process.env.HOME || process.env.USERPROFILE || '/tmp';
export function getPolicyPath(home = defaultHome()): string { return join(home, '.config', 'opencode', 'pas', 'policies.json'); }

export function validatePolicyStore(value: unknown, path = getPolicyPath()): PolicyStore {
  const invalid = (problem: string): never => { throw new Error(`Invalid policy store at ${path}: ${problem}. Fix or remove this file, then retry.`); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('expected a JSON object');
  const data = value as Record<string, unknown>;
  if (data.version !== 1) invalid(`unsupported version ${String(data.version)} (supported: 1)`);
  if (!data.agents || typeof data.agents !== 'object' || Array.isArray(data.agents)) invalid('agents must be an object');
  for (const [name, raw] of Object.entries(data.agents as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid(`agent ${name} must be an object`);
    const agent = raw as Record<string, unknown>;
    if (!agent.skills || typeof agent.skills !== 'object' || Array.isArray(agent.skills)) invalid(`agent ${name} skills must be an object`);
    for (const [pattern, action] of Object.entries(agent.skills as Record<string, unknown>)) {
      if (!pattern || !['allow', 'deny', 'ask'].includes(String(action))) invalid(`agent ${name} has invalid skill rule ${pattern}`);
    }
    if (!Array.isArray(agent.tools) || agent.tools.some((tool) => typeof tool !== 'string')) invalid(`agent ${name} tools must be a string array`);
  }
  return value as PolicyStore;
}

export function loadPolicyStore(home = defaultHome()): PolicyStore | null {
  const path = getPolicyPath(home);
  if (!existsSync(path)) return null;
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); } catch (error) {
    throw new Error(`Cannot read policy store at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (error) {
    throw new Error(`Malformed JSON in policy store at ${path}: ${error instanceof Error ? error.message : String(error)}. Fix or remove this file, then retry.`);
  }
  return validatePolicyStore(parsed, path);
}

export function savePolicyStore(home: string, value: PolicyStore): string {
  const path = getPolicyPath(home);
  const valid = validatePolicyStore(value, path);
  const agents: Record<string, AgentPolicy> = {};
  for (const name of Object.keys(valid.agents).sort()) {
    const agent = valid.agents[name]!;
    if (Object.keys(agent.skills).length === 0 && agent.tools.length === 0) continue;
    const skills: Record<string, PermissionAction> = {};
    for (const pattern of Object.keys(agent.skills).sort()) skills[pattern] = agent.skills[pattern]!;
    agents[name] = { skills, tools: [...agent.tools].sort() };
  }
  const canonical = { version: 1 as const, agents };
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(canonical, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
  return path;
}

export function policyStoreToConfig(store: PolicyStore): OpenCodeConfig {
  const agent: NonNullable<OpenCodeConfig['agent']> = {};
  for (const [name, policy] of Object.entries(store.agents)) {
    if (Object.keys(policy.skills).length) agent[name] = { permission: { skill: policy.skills } };
  }
  return { agent };
}

export function configToPolicyStore(config: OpenCodeConfig, existing: PolicyStore): PolicyStore {
  const agents = { ...existing.agents };
  for (const name of Object.keys(agents)) {
    const rules = config.agent?.[name]?.permission?.skill;
    agents[name] = { ...agents[name]!, skills: rules ? { ...rules } : {} };
    if (!Object.keys(agents[name]!.skills).length && !agents[name]!.tools.length) delete agents[name];
  }
  for (const [name, entry] of Object.entries(config.agent ?? {})) {
    const skills = entry?.permission?.skill;
    if (!skills || !Object.keys(skills).length) continue;
    agents[name] = { ...(agents[name] ?? { skills: {}, tools: [] }), skills: { ...skills } };
  }
  return { version: 1, agents };
}
