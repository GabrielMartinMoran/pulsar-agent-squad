import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import {
  getPolicyPath,
  loadToolPolicyStore,
  resolvePolicyPath,
  saveToolPolicyStore,
  validateToolPolicyStore,
  type ToolPolicyStore,
} from '../../src/cli/lib/policy-store';

const TMP_ROOT = '/tmp/opencode';

function makeTmp(prefix: string): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, prefix));
}

function writeRaw(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('tool policy store', () => {
  it('saves a canonical versioned document and loads it back unchanged', () => {
    const root = makeTmp('pas-policy-store-');
    try {
      const path = getPolicyPath(join(root, 'opencode'));
      const store: ToolPolicyStore = {
        version: 1,
        agents: {
          'Pulsar Agent Squad': { tools: ['shell', 'edit', 'shell'] },
          pas_qa: { tools: ['webfetch'] },
        },
      };

      expect(saveToolPolicyStore(store, path)).toBe(path);
      expect(readFileSync(path, 'utf8')).toBe(
        [
          '{',
          '  "version": 1,',
          '  "agents": {',
          '    "Pulsar Agent Squad": {',
          '      "tools": [',
          '        "edit",',
          '        "shell"',
          '      ]',
          '    },',
          '    "pas_qa": {',
          '      "tools": [',
          '        "webfetch"',
          '      ]',
          '    }',
          '  }',
          '}',
          '',
        ].join('\n'),
      );
      expect(loadToolPolicyStore(path)).toEqual({
        version: 1,
        agents: {
          'Pulsar Agent Squad': { tools: ['edit', 'shell'] },
          pas_qa: { tools: ['webfetch'] },
        },
      });
      expect(readdirSync(dirname(path))).toEqual(['policies.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves the store under XDG_CONFIG_HOME first, then HOME', () => {
    expect(
      resolvePolicyPath({ XDG_CONFIG_HOME: '/xdg', HOME: '/home/alice' }),
    ).toBe('/xdg/opencode/pas/policies.json');
    expect(resolvePolicyPath({ HOME: '/home/alice' })).toBe(
      '/home/alice/.config/opencode/pas/policies.json',
    );
    expect(resolvePolicyPath({})).toBe('/tmp/.config/opencode/pas/policies.json');
  });

  it('does not create files or directories for a missing store', () => {
    const root = makeTmp('pas-policy-missing-');
    try {
      const configDir = join(root, 'opencode');
      expect(loadToolPolicyStore(getPolicyPath(configDir))).toBeNull();
      expect(existsSync(configDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports malformed JSON and unsupported versions with the path and problem', () => {
    const root = makeTmp('pas-policy-invalid-');
    try {
      const configDir = join(root, 'opencode');
      const path = getPolicyPath(configDir);

      writeRaw(path, '{bad');
      expect(() => loadToolPolicyStore(path)).toThrow(path);
      expect(() => loadToolPolicyStore(path)).toThrow(/Malformed JSON/);

      writeRaw(path, '{"version":2,"agents":{}}');
      expect(() => loadToolPolicyStore(path)).toThrow(/version 2/);
      expect(() => loadToolPolicyStore(path)).toThrow(/supported: 1/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid identifiers instead of broadening a deny to a wildcard', () => {
    expect(() =>
      validateToolPolicyStore({
        version: 1,
        agents: { pas_qa: { tools: ['*'] } },
      }),
    ).toThrow(/Invalid tool identifier/);
    expect(() =>
      validateToolPolicyStore({
        version: 1,
        agents: { pas_qa: { tools: ['shell *'] } },
      }),
    ).toThrow(/Invalid tool identifier/);
    expect(() =>
      validateToolPolicyStore({
        version: 1,
        agents: { pas_qa: { tools: [''] } },
      }),
    ).toThrow(/Invalid tool identifier/);
  });

  it('omits empty agents but still writes an empty valid document', () => {
    const root = makeTmp('pas-policy-empty-');
    try {
      const path = getPolicyPath(join(root, 'opencode'));
      saveToolPolicyStore(
        { version: 1, agents: { pas_qa: { tools: [] } } },
        path,
      );
      expect(loadToolPolicyStore(path)).toEqual({ version: 1, agents: {} });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
