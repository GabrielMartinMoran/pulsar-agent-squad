import { describe, expect, it } from 'bun:test';
import { migrateLegacySkillRules } from '../../src/cli/lib/policy-migration';

describe('legacy policy migration', () => {
  it('collects V1 and V2 skill rules with native permission rows winning per pattern', () => {
    expect(migrateLegacySkillRules({
      agent: { worker: { permission: { skill: { 'docs-*': 'deny', 'old-*': 'ask' } } } },
      agents: { worker: { permissions: [
        { action: 'skill', resource: 'docs-*', effect: 'allow' },
        { action: 'skill', resource: 'native-*', effect: 'deny' },
        { action: 'edit', resource: '*', effect: 'deny' },
      ] } },
    })).toEqual({ worker: { 'docs-*': 'allow', 'old-*': 'ask', 'native-*': 'deny' } });
  });
});
