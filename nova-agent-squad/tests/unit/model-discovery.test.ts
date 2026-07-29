import { describe, expect, it, beforeEach } from 'bun:test';
import {
  discoverModels,
  discoverVariants,
  parseModelLine,
  parseVerboseModelsOutput,
  populateVariantsFromVerbose,
  resetModelsCache,
} from '../../src/cli/lib/model-discovery';

// Reset the cache before every test in this file. discoverModels is
// process-scoped, so without isolation a successful spawn in one test
// would leak into subsequent tests that expect different behaviour.
beforeEach(() => {
  resetModelsCache();
});

describe('discoverModels', () => {
  describe('parses valid opencode models output', () => {
    it('should discover models from mock spawn output', async () => {
      const fakeOutput = [
        'opencode/deepseek-v4-pro',
        'anthropic/claude-sonnet-4-6',
        'openrouter/anthropic/claude-opus-4.1',
        '',
        '  ',
        'invalid',
      ].join('\n');

      const origSpawn = Bun.spawnSync;
      Bun.spawnSync = (() => ({
        exitCode: 0,
        stdout: Buffer.from(fakeOutput),
        stderr: Buffer.from(''),
      })) as typeof Bun.spawnSync;

      try {
        const models = await discoverModels();
        expect(models).toHaveLength(3);
        expect(models[0]).toEqual({
          id: 'opencode/deepseek-v4-pro',
          provider: 'opencode',
          name: 'deepseek-v4-pro',
        });
        expect(models[1]).toEqual({
          id: 'anthropic/claude-sonnet-4-6',
          provider: 'anthropic',
          name: 'claude-sonnet-4-6',
        });
        expect(models[2]).toEqual({
          id: 'openrouter/anthropic/claude-opus-4.1',
          provider: 'openrouter',
          name: 'anthropic/claude-opus-4.1',
        });
      } finally {
        Bun.spawnSync = origSpawn;
      }
    });
  });

  describe('parseModelLine', () => {
    it('should extract provider and model name from single-segment', () => {
      const result = parseModelLine('anthropic/claude-sonnet-4-6');
      expect(result).toEqual({
        id: 'anthropic/claude-sonnet-4-6',
        provider: 'anthropic',
        name: 'claude-sonnet-4-6',
      });
    });

    it('should handle simple provider/model-id format', () => {
      const result = parseModelLine('opencode/deepseek-v4-pro');
      expect(result).toEqual({
        id: 'opencode/deepseek-v4-pro',
        provider: 'opencode',
        name: 'deepseek-v4-pro',
      });
    });

    it('should handle multi-segment model names', () => {
      const result = parseModelLine('openrouter/anthropic/claude-sonnet-4.6');
      expect(result).toEqual({
        id: 'openrouter/anthropic/claude-sonnet-4.6',
        provider: 'openrouter',
        name: 'anthropic/claude-sonnet-4.6',
      });
    });

    it('should skip lines with no slash', () => {
      expect(parseModelLine('invalidmodel')).toBeNull();
    });

    it('should skip empty lines', () => {
      expect(parseModelLine('')).toBeNull();
    });

    it('should skip whitespace-only lines', () => {
      expect(parseModelLine('   ')).toBeNull();
    });

    it('should skip lines with empty provider', () => {
      expect(parseModelLine('/onlyname')).toBeNull();
    });

    it('should skip lines with empty name', () => {
      expect(parseModelLine('provider/')).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should return empty list when opencode exits non-zero', async () => {
      const origSpawn = Bun.spawnSync;
      Bun.spawnSync = (() => ({
        exitCode: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('error'),
      })) as typeof Bun.spawnSync;

      try {
        const models = await discoverModels();
        expect(models).toEqual([]);
      } finally {
        Bun.spawnSync = origSpawn;
      }
    });
  });
});

describe('discoverModels — in-memory cache', () => {
  beforeEach(() => {
    resetModelsCache();
  });

  it('should cache the result after a successful spawn and skip the second spawn', async () => {
    const fakeOutput = ['opencode/deepseek-v4-pro', 'anthropic/claude-sonnet-4-6'].join('\n');

    let spawnCallCount = 0;
    const origSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => {
      spawnCallCount += 1;
      return {
        exitCode: 0,
        stdout: Buffer.from(fakeOutput),
        stderr: Buffer.from(''),
      };
    }) as typeof Bun.spawnSync;

    try {
      const first = await discoverModels();
      const second = await discoverModels();

      expect(spawnCallCount).toBe(1);
      expect(second).toEqual(first);
    } finally {
      Bun.spawnSync = origSpawn;
    }
  });

  it('should return the same array reference on subsequent calls (cached object)', async () => {
    const fakeOutput = 'opencode/deepseek-v4-pro';

    const origSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => ({
      exitCode: 0,
      stdout: Buffer.from(fakeOutput),
      stderr: Buffer.from(''),
    })) as typeof Bun.spawnSync;

    try {
      const first = await discoverModels();
      const second = await discoverModels();

      expect(second).toBe(first);
    } finally {
      Bun.spawnSync = origSpawn;
    }
  });

  it('should not cache when opencode exits with non-zero code', async () => {
    let spawnCallCount = 0;
    const origSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => {
      spawnCallCount += 1;
      return {
        exitCode: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('error'),
      };
    }) as typeof Bun.spawnSync;

    try {
      const first = await discoverModels();
      const second = await discoverModels();

      expect(first).toEqual([]);
      expect(second).toEqual([]);
      expect(spawnCallCount).toBe(2);
    } finally {
      Bun.spawnSync = origSpawn;
    }
  });

  it('should re-invoke spawn after resetModelsCache()', async () => {
    let currentOutput = 'opencode/first';
    let spawnCallCount = 0;

    const origSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => {
      spawnCallCount += 1;
      return {
        exitCode: 0,
        stdout: Buffer.from(currentOutput),
        stderr: Buffer.from(''),
      };
    }) as typeof Bun.spawnSync;

    try {
      const first = await discoverModels();
      expect(first[0]?.id).toBe('opencode/first');
      expect(spawnCallCount).toBe(1);

      currentOutput = 'opencode/second';
      const cached = await discoverModels();
      expect(cached[0]?.id).toBe('opencode/first');
      expect(spawnCallCount).toBe(1);

      resetModelsCache();

      const fresh = await discoverModels();
      expect(fresh[0]?.id).toBe('opencode/second');
      expect(spawnCallCount).toBe(2);
    } finally {
      Bun.spawnSync = origSpawn;
    }
  });

  it('should NOT cache an empty result so the next read re-invokes opencode', async () => {
    // First spawn returns exitCode=0 with no parseable models (empty stdout).
    // Second spawn returns a non-empty list. The cache must not retain the
    // empty result, so the second discoverModels() call re-spawns and
    // returns the populated list.
    let spawnCallCount = 0;
    const outputs = ['', 'opencode/recovered-model'];
    const origSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => {
      const out = outputs[spawnCallCount] ?? '';
      spawnCallCount += 1;
      return {
        exitCode: 0,
        stdout: Buffer.from(out),
        stderr: Buffer.from(''),
      };
    }) as typeof Bun.spawnSync;

    try {
      const first = await discoverModels();
      expect(first).toEqual([]);
      expect(spawnCallCount).toBe(1);

      // Next read must NOT use a cached empty list — it must re-spawn.
      const second = await discoverModels();
      expect(spawnCallCount).toBe(2);
      expect(second).toHaveLength(1);
      expect(second[0]?.id).toBe('opencode/recovered-model');
    } finally {
      Bun.spawnSync = origSpawn;
    }
  });

  it('should NOT cache an empty result that contains only blank/whitespace lines', async () => {
    // exitCode=0 with parseable-empty output (whitespace, empty lines).
    // Same contract as above: empty parse → do not poison the cache.
    let spawnCallCount = 0;
    const outputs = ['\n   \n  \n', 'opencode/late-model'];
    const origSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => {
      const out = outputs[spawnCallCount] ?? '';
      spawnCallCount += 1;
      return {
        exitCode: 0,
        stdout: Buffer.from(out),
        stderr: Buffer.from(''),
      };
    }) as typeof Bun.spawnSync;

    try {
      const first = await discoverModels();
      expect(first).toEqual([]);
      expect(spawnCallCount).toBe(1);

      const second = await discoverModels();
      expect(spawnCallCount).toBe(2);
      expect(second[0]?.id).toBe('opencode/late-model');
    } finally {
      Bun.spawnSync = origSpawn;
    }
  });
});

describe('verbose model variant discovery', () => {
  const lunaOutput = [
    'openai/gpt-5.6-luna',
    '{',
    '  "id": "gpt-5.6-luna",',
    '  "metadata": {',
    '    "nested": { "label": "openai/not-a-model-boundary" }',
    '  },',
    '  "variants": {',
    '    "none": {},',
    '    "low": {},',
    '    "medium": {},',
    '    "high": {},',
    '    "xhigh": {},',
    '    "max": {}',
    '  }',
    '}',
  ].join('\n');

  it('FEAT-001 — Luna model shows all six reasoning-effort variants', () => {
    expect(parseVerboseModelsOutput(lunaOutput)).toEqual({
      'openai/gpt-5.6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
  });

  it('FEAT-001 — model with fewer variants does not show unavailable options', () => {
    const output = [
      'openai/gpt-5-mini',
      '{',
      '  "nested": {',
      '    "provider/model-looking-value": { "enabled": true }',
      '  },',
      '  "variants": ["none", "low", "medium", "high"]',
      '}',
    ].join('\n');

    expect(parseVerboseModelsOutput(output)).toEqual({
      'openai/gpt-5-mini': ['none', 'low', 'medium', 'high'],
    });
  });

  it('skips a balanced malformed JSON block and resumes at the next model id', () => {
    const output = [
      'openai/broken',
      '{ "variants": ["high",], "nested": {} }',
      'openai/gpt-5-mini',
      '{ "variants": ["none", "low", "medium", "high"] }',
    ].join('\n');

    expect(parseVerboseModelsOutput(output)).toEqual({
      'openai/gpt-5-mini': ['none', 'low', 'medium', 'high'],
    });
  });

  it('tolerates trivial one-line JSON and keeps only string variants', () => {
    const output = [
      'provider/model',
      '{"variants":["low",7,"high",null]}',
    ].join('\n');

    expect(parseVerboseModelsOutput(output)).toEqual({
      'provider/model': ['low', 'high'],
    });
  });

  it('FEAT-001 — model with no variants skips the variant step', () => {
    const output = ['opencode/deepseek-v4-pro', '{', '  "variants": []', '}'].join('\n');

    expect(parseVerboseModelsOutput(output)).toEqual({
      'opencode/deepseek-v4-pro': [],
    });
  });

  it('populates Luna variants and the smaller gpt-5-mini subset without static fallback', async () => {
    const output = [
      lunaOutput,
      'openai/gpt-5-mini',
      '{ "variants": ["none", "low", "medium", "high"] }',
      'openrouter/anthropic/claude-sonnet-4-5',
      '{ "variants": [] }',
    ].join('\n');
    const originalSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => ({
      exitCode: 0,
      stdout: Buffer.from(output),
      stderr: Buffer.from(''),
    })) as typeof Bun.spawnSync;

    try {
      await populateVariantsFromVerbose();

      expect(discoverVariants('openai/gpt-5.6-luna')).toEqual([
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]);
      expect(discoverVariants('openai/gpt-5-mini')).toEqual([
        'none',
        'low',
        'medium',
        'high',
      ]);
      expect(discoverVariants('openrouter/anthropic/claude-sonnet-4-5')).toEqual([]);
    } finally {
      Bun.spawnSync = originalSpawn;
    }
  });

  it('returns defensive copies so callers cannot mutate cached variants', async () => {
    const originalSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => ({
      exitCode: 0,
      stdout: Buffer.from(lunaOutput),
      stderr: Buffer.from(''),
    })) as typeof Bun.spawnSync;

    try {
      await populateVariantsFromVerbose();
      const first = discoverVariants('openai/gpt-5.6-luna');
      first.push('invalid');

      expect(discoverVariants('openai/gpt-5.6-luna')).not.toContain('invalid');
    } finally {
      Bun.spawnSync = originalSpawn;
    }
  });

  it('caches verbose discovery and resetModelsCache clears that cache', async () => {
    let calls = 0;
    const originalSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => {
      calls += 1;
      return {
        exitCode: 0,
        stdout: Buffer.from(lunaOutput),
        stderr: Buffer.from(''),
      };
    }) as typeof Bun.spawnSync;

    try {
      await populateVariantsFromVerbose();
      await populateVariantsFromVerbose();
      expect(calls).toBe(1);

      resetModelsCache();
      await populateVariantsFromVerbose();
      expect(calls).toBe(2);
    } finally {
      Bun.spawnSync = originalSpawn;
    }
  });

  it('FEAT-001 — opencode models --verbose fails or is not supported', async () => {
    const originalSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => ({
      exitCode: 1,
      stdout: Buffer.from(''),
      stderr: Buffer.from('unsupported flag'),
    })) as typeof Bun.spawnSync;

    try {
      await populateVariantsFromVerbose();
      expect(discoverVariants('openai/gpt-5.6-luna')).toEqual([]);
      expect(discoverVariants('openrouter/anthropic/claude-sonnet-4-5')).toEqual([]);
    } finally {
      Bun.spawnSync = originalSpawn;
    }
  });

  it('FEAT-001 — known-static-variant model is skipped without verbose data', () => {
    expect(discoverVariants('openrouter/anthropic/claude-sonnet-4-5')).toEqual([]);
  });

  it('degrades safely when spawning verbose throws', async () => {
    const originalSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => {
      throw new Error('opencode not found');
    }) as typeof Bun.spawnSync;

    try {
      await populateVariantsFromVerbose();
      expect(discoverVariants('openai/gpt-5.6-luna')).toEqual([]);
    } finally {
      Bun.spawnSync = originalSpawn;
    }
  });

  it('degrades safely when verbose output has no parseable variant blocks', async () => {
    const originalSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => ({
      exitCode: 0,
      stdout: Buffer.from('openai/gpt-5.6-luna\nnot-json'),
      stderr: Buffer.from(''),
    })) as typeof Bun.spawnSync;

    try {
      await populateVariantsFromVerbose();
      expect(discoverVariants('openai/gpt-5.6-luna')).toEqual([]);
    } finally {
      Bun.spawnSync = originalSpawn;
    }
  });
});
