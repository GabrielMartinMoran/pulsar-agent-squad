import { describe, expect, it, beforeEach } from 'bun:test';
import {
  discoverModels,
  discoverVariants,
  parseModelLine,
  populateVariantsFromModelList,
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

describe('v2 model registry variant discovery', () => {
  const LUNA_VARIANTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  const DEEPSEEK_VARIANTS = ['low', 'high', 'max'];

  function registryJson(data: unknown[]): string {
    return JSON.stringify({ location: 'https://opencode.local', data });
  }

  const happyRegistry = registryJson([
    {
      providerID: 'openai',
      modelID: 'gpt-5.6-luna',
      variants: LUNA_VARIANTS.map((id) => ({ id })),
    },
    {
      providerID: 'opencode-go',
      modelID: 'deepseek-v4.1-flash',
      variants: DEEPSEEK_VARIANTS.map((id) => ({ id })),
    },
    {
      providerID: 'openrouter',
      modelID: 'openai/gpt-5.6-luna',
      variants: LUNA_VARIANTS.map((id) => ({ id })),
    },
  ]);

  /** Install a fake `Bun.spawnSync` returning a fixed registry payload. */
  function spawnOnce(output: string, exitCode = 0) {
    const calls: string[][] = [];
    const originalSpawn = Bun.spawnSync;
    Bun.spawnSync = ((cmd: string[]) => {
      calls.push(cmd);
      return {
        exitCode,
        stdout: Buffer.from(output),
        stderr: Buffer.from(''),
      };
    }) as typeof Bun.spawnSync;
    return {
      calls,
      restore: () => {
        Bun.spawnSync = originalSpawn;
      },
    };
  }

  it('parses provider, model id and variant ids from the v2 model list', async () => {
    const { restore } = spawnOnce(happyRegistry);
    try {
      await populateVariantsFromModelList();

      expect(discoverVariants('openai/gpt-5.6-luna')).toEqual(LUNA_VARIANTS);
      expect(discoverVariants('opencode-go/deepseek-v4.1-flash')).toEqual(DEEPSEEK_VARIANTS);
      // Multi-segment model ids key on the full `providerID/id` pair.
      expect(discoverVariants('openrouter/openai/gpt-5.6-luna')).toEqual(LUNA_VARIANTS);
    } finally {
      restore();
    }
  });

  it('keys variants on the public id when it differs from the upstream modelID', async () => {
    // The OpenAI provider exposes fast/ultrafast entries whose public `id`
    // differs from the `modelID` shared with the base model. `opencode models`
    // prints `providerID/id`, so the registry must key on that public id or the
    // wizard's `discoverVariants(model.id)` lookup misses.
    const { restore } = spawnOnce(
      registryJson([
        {
          providerID: 'openai',
          id: 'gpt-6-luna',
          modelID: 'gpt-6-luna',
          variants: LUNA_VARIANTS.map((id) => ({ id })),
        },
        {
          providerID: 'openai',
          id: 'gpt-6-luna-fast',
          modelID: 'gpt-6-luna',
          variants: LUNA_VARIANTS.map((id) => ({ id })),
        },
        {
          providerID: 'openai',
          id: 'gpt-6-astra-ultrafast',
          modelID: 'gpt-6-astra',
          variants: LUNA_VARIANTS.map((id) => ({ id })),
        },
      ]),
    );
    try {
      await populateVariantsFromModelList();

      expect(discoverVariants('openai/gpt-6-luna-fast')).toEqual(LUNA_VARIANTS);
      expect(discoverVariants('openai/gpt-6-astra-ultrafast')).toEqual(LUNA_VARIANTS);
      expect(discoverVariants('openai/gpt-6-luna')).toEqual(LUNA_VARIANTS);
    } finally {
      restore();
    }
  });

  it('falls back to modelID when the public id is absent or unusable', async () => {
    // Older registry shapes may omit `id`. The lookup must keep working
    // through `providerID/modelID`; empty or non-string ids also fall back.
    const { restore } = spawnOnce(
      registryJson([
        {
          providerID: 'openai',
          modelID: 'gpt-legacy-no-id',
          variants: [{ id: 'high' }],
        },
        {
          providerID: 'openai',
          id: '',
          modelID: 'gpt-legacy-empty-id',
          variants: [{ id: 'low' }],
        },
        {
          providerID: 'openai',
          id: 42,
          modelID: 'gpt-legacy-numeric-id',
          variants: [{ id: 'max' }],
        },
      ]),
    );
    try {
      await populateVariantsFromModelList();

      expect(discoverVariants('openai/gpt-legacy-no-id')).toEqual(['high']);
      expect(discoverVariants('openai/gpt-legacy-empty-id')).toEqual(['low']);
      expect(discoverVariants('openai/gpt-legacy-numeric-id')).toEqual(['max']);
    } finally {
      restore();
    }
  });

  it("spawns exactly ['opencode','api','--standalone','model.list']", async () => {
    const { calls, restore } = spawnOnce(happyRegistry);
    try {
      await populateVariantsFromModelList();

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['opencode', 'api', '--standalone', 'model.list']);
    } finally {
      restore();
    }
  });

  it('models with an empty variants array expose no variant data', async () => {
    const { restore } = spawnOnce(
      registryJson([{ providerID: 'openai', modelID: 'gpt-5-mini', variants: [] }]),
    );
    try {
      await populateVariantsFromModelList();

      expect(discoverVariants('openai/gpt-5-mini')).toEqual([]);
    } finally {
      restore();
    }
  });

  it('skips malformed registry items and keeps parsing the rest', async () => {
    const { restore } = spawnOnce(
      registryJson([
        { modelID: 'no-provider', variants: [{ id: 'high' }] },
        { providerID: 'openai', variants: [{ id: 'high' }] },
        { providerID: 'openai', modelID: '', variants: [{ id: 'high' }] },
        { providerID: 'openai', modelID: 'non-array-variants', variants: 'nope' },
        {
          providerID: 'openai',
          modelID: 'weird-ids',
          variants: [{ id: 'high' }, { id: '' }, { id: 7 }, null, 'x', { name: 'no-id' }],
        },
        {
          providerID: 'openai',
          modelID: 'gpt-5-mini',
          variants: [{ id: 'none' }, { id: 'low' }],
        },
      ]),
    );
    try {
      await populateVariantsFromModelList();

      // The well-formed item still parses.
      expect(discoverVariants('openai/gpt-5-mini')).toEqual(['none', 'low']);
      // Non-string / empty variant ids are dropped; the rest is kept.
      expect(discoverVariants('openai/weird-ids')).toEqual(['high']);
      // Items missing ids or carrying a non-array `variants` are skipped.
      expect(discoverVariants('openai/non-array-variants')).toEqual([]);
      expect(discoverVariants('openai/no-provider')).toEqual([]);
      expect(discoverVariants('no-provider')).toEqual([]);
    } finally {
      restore();
    }
  });

  it('degrades silently and attempts only once when the request fails', async () => {
    const scenarios = ['exit', 'throw', 'invalid-json', 'non-array'] as const;

    for (const scenario of scenarios) {
      resetModelsCache();
      const calls: string[][] = [];
      const originalSpawn = Bun.spawnSync;
      Bun.spawnSync = ((cmd: string[]) => {
        calls.push(cmd);
        if (scenario === 'throw') throw new Error('opencode not found');
        return {
          exitCode: scenario === 'exit' ? 1 : 0,
          stdout: Buffer.from(
            scenario === 'invalid-json'
              ? 'not json'
              : scenario === 'non-array'
                ? JSON.stringify({ data: {} })
                : '',
          ),
          stderr: Buffer.from(''),
        };
      }) as typeof Bun.spawnSync;
      try {
        await populateVariantsFromModelList();
        expect(discoverVariants('openai/gpt-5.6-luna')).toEqual([]);

        // Deliberate change vs the old contract: the failed attempt is
        // marked done, so a second call in the same run does NOT re-spawn.
        await populateVariantsFromModelList();
        expect(calls).toHaveLength(1);
      } finally {
        Bun.spawnSync = originalSpawn;
      }
    }
  });

  it('caches a successful registry once and resetModelsCache clears it plus the attempt flag', async () => {
    let calls = 0;
    const originalSpawn = Bun.spawnSync;
    Bun.spawnSync = (() => {
      calls += 1;
      return {
        exitCode: 0,
        stdout: Buffer.from(happyRegistry),
        stderr: Buffer.from(''),
      };
    }) as typeof Bun.spawnSync;

    try {
      await populateVariantsFromModelList();
      await populateVariantsFromModelList();
      expect(calls).toBe(1);

      resetModelsCache();
      await populateVariantsFromModelList();
      expect(calls).toBe(2);
      expect(discoverVariants('openai/gpt-5.6-luna')).toEqual(LUNA_VARIANTS);
    } finally {
      Bun.spawnSync = originalSpawn;
    }
  });

  it('returns defensive copies so callers cannot mutate cached variants', async () => {
    const { restore } = spawnOnce(happyRegistry);
    try {
      await populateVariantsFromModelList();
      const first = discoverVariants('openai/gpt-5.6-luna');
      first.push('invalid');

      expect(discoverVariants('openai/gpt-5.6-luna')).not.toContain('invalid');
    } finally {
      restore();
    }
  });

  it('FEAT-001 — registry request fails or is unsupported → no variants', async () => {
    const { restore } = spawnOnce('', 1);
    try {
      await populateVariantsFromModelList();

      expect(discoverVariants('openai/gpt-5.6-luna')).toEqual([]);
      expect(discoverVariants('openrouter/anthropic/claude-sonnet-4-5')).toEqual([]);
    } finally {
      restore();
    }
  });
});
