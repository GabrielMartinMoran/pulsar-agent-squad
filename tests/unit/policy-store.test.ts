import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getPolicyPath, loadPolicyStore, savePolicyStore, type PolicyStore } from '../../src/cli/lib/policy-store';

describe('policy store contract', () => {
  it('stores per-agent skill rules and blocked tools in stable versioned JSON', () => {
    const home = mkdtempSync(join(tmpdir(), 'pas-policy-'));
    try {
      const store: PolicyStore = { version: 1, agents: { beta: { skills: { 'z*': 'deny', 'a*': 'ask' }, tools: ['shell'] } } };
      const path = savePolicyStore(home, store);
      expect(path).toBe(getPolicyPath(home));
      expect(readFileSync(path, 'utf8')).toBe('{\n  "version": 1,\n  "agents": {\n    "beta": {\n      "skills": {\n        "a*": "ask",\n        "z*": "deny"\n      },\n      "tools": [\n        "shell"\n      ]\n    }\n  }\n}\n');
      expect(loadPolicyStore(home)).toEqual(store);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('fails loudly with path and cause for malformed JSON or unsupported versions', () => {
    const home = mkdtempSync(join(tmpdir(), 'pas-policy-'));
    try {
      const path = getPolicyPath(home);
      saveRaw(path, '{bad');
      expect(() => loadPolicyStore(home)).toThrow(path);
      saveRaw(path, '{"version":2,"agents":{}}');
      expect(() => loadPolicyStore(home)).toThrow(/version 2/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('omits agents with no skills or blocked tools while keeping an empty valid store', () => {
    const home = mkdtempSync(join(tmpdir(), 'pas-policy-'));
    try {
      savePolicyStore(home, { version: 1, agents: { empty: { skills: {}, tools: [] } } });
      expect(loadPolicyStore(home)).toEqual({ version: 1, agents: {} });
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

function saveRaw(path: string, content: string): void {
  const { mkdirSync, writeFileSync } = require('fs');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}
