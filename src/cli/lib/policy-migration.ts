import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { OpenCodeConfig, PermissionAction } from './config-safety';
import { configToPolicyStore, getPolicyPath, loadPolicyStore, policyStoreToConfig, savePolicyStore, type PolicyStore } from './policy-store';

export interface MigrationResult { store: PolicyStore | null; migrated: boolean; ignoredLegacyRules: number }
function configPath(home: string): string {
  return process.env.PAS_OPENCODE_CONFIG_PATH || join(home, '.config', 'opencode', 'opencode.json');
}

export function migrateLegacySkillRules(config: OpenCodeConfig): Record<string, Record<string, PermissionAction>> {
  const agents: Record<string, Record<string, PermissionAction>> = {};
  for (const [name, entry] of Object.entries(config.agent ?? {})) {
    const skills = entry?.permission?.skill;
    if (!skills || typeof skills !== 'object' || Array.isArray(skills)) continue;
    for (const [pattern, action] of Object.entries(skills)) {
      if (['allow', 'deny', 'ask'].includes(String(action))) (agents[name] ??= {})[pattern] = action as PermissionAction;
    }
  }
  for (const [name, entry] of Object.entries(config.agents ?? {})) {
    for (const row of entry.permissions ?? []) {
      if (row?.action === 'skill' && typeof row.resource === 'string' && ['allow', 'deny', 'ask'].includes(row.effect)) {
        (agents[name] ??= {})[row.resource] = row.effect;
      }
    }
  }
  return agents;
}

export function countLegacySkillRules(home = process.env.HOME || process.env.USERPROFILE || '/tmp'): number {
  const path = configPath(home);
  if (!existsSync(path)) return 0;
  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as OpenCodeConfig;
    return Object.values(migrateLegacySkillRules(config)).reduce((count, rules) => count + Object.keys(rules).length, 0);
  } catch { return 0; }
}

export function loadOrMigratePolicyStore(home = process.env.HOME || process.env.USERPROFILE || '/tmp'): MigrationResult {
  const existing = loadPolicyStore(home);
  if (existing) return { store: existing, migrated: false, ignoredLegacyRules: countLegacySkillRules(home) };
  const path = configPath(home);
  if (!existsSync(path)) return { store: null, migrated: false, ignoredLegacyRules: 0 };
  let config: OpenCodeConfig;
  try { config = JSON.parse(readFileSync(path, 'utf8')) as OpenCodeConfig; } catch { return { store: null, migrated: false, ignoredLegacyRules: 0 }; }
  const migrated = migrateLegacySkillRules(config);
  if (!Object.values(migrated).some((rules) => Object.keys(rules).length)) return { store: null, migrated: false, ignoredLegacyRules: 0 };
  const agents: PolicyStore['agents'] = {};
  for (const [name, skills] of Object.entries(migrated)) agents[name] = { skills, tools: [] };
  savePolicyStore(home, { version: 1, agents });
  return { store: loadPolicyStore(home), migrated: true, ignoredLegacyRules: 0 };
}

export function policyPath(home?: string): string { return getPolicyPath(home); }

export function readSkillPolicyConfig(home?: string): { config: OpenCodeConfig; store: PolicyStore } {
  const result = loadOrMigratePolicyStore(home);
  const store = result.store ?? { version: 1 as const, agents: {} };
  return { config: policyStoreToConfig(store), store };
}

export function writeSkillPolicyConfig(config: OpenCodeConfig, store: PolicyStore, home = process.env.HOME || process.env.USERPROFILE || '/tmp'): void {
  savePolicyStore(home, configToPolicyStore(config, store));
}
