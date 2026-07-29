/**
 * Unit tests for the skill-policies library.
 *
 * The library is the read/edit source of truth for `permission.skill` rules in
 * `~/.config/opencode/opencode.json`. It is the foundation of the `nas skills`
 * CLI surface and is therefore exercised as pure logic against a parsed
 * OpenCodeConfig object (no I/O, no filesystem).
 *
 * The library is intentionally scoped to the approved contract:
 *   - `all-nas` scope → fan out over every canonical NAS agent as a per-agent
 *     `agent.<name>.permission.skill` block. NEVER touches top-level
 *     `permission.skill` (which is OpenCode-wide and would leak past NAS).
 *   - `agent` scope → one specific NAS agent's `agent.<name>.permission.skill`
 *   - `all` scope (clear-only) → every NAS agent's per-agent block
 *   - actions: 'allow' | 'deny' | 'ask'
 *   - patterns: native OpenCode wildcards (`*`, `?`) — stored as-is
 *
 * Scope: the library does NOT compile skill policies into agent frontmatter
 * (excluded), does NOT touch non-OpenCode platforms (excluded), and does NOT
 * filter the Skill Assignment Contract (follow-up). It also does NOT write to
 * the top-level `permission.skill` block — that is OpenCode-wide and outside
 * NAS's surface.
 */

import { describe, expect, it } from 'bun:test';
import {
  readSkillPolicies,
  addSkillPolicy,
  removeSkillPolicy,
  clearSkillPolicies,
  type PermissionAction,
  type SkillRule,
  type SkillScope,
} from '../../src/cli/lib/skill-policies';
import { NAS_AGENTS } from '../../src/cli/commands/agents/presenter';
import type { OpenCodeConfig } from '../../src/cli/lib/config-safety';

describe('readSkillPolicies — pure parser over OpenCodeConfig', () => {
  it('returns an empty global/per-agent view for a config with no permission block', () => {
    const config: OpenCodeConfig = {};
    const view = readSkillPolicies(config);
    expect(view.global).toEqual([]);
    expect(view.perAgent).toEqual({});
  });

  it('returns an empty view when `permission` exists but has no `skill` block', () => {
    const config: OpenCodeConfig = { permission: { edit: { '*': 'allow' } } };
    const view = readSkillPolicies(config);
    expect(view.global).toEqual([]);
    expect(view.perAgent).toEqual({});
  });

  it('parses global `permission.skill` rules preserving declaration order', () => {
    const config: OpenCodeConfig = {
      permission: {
        skill: {
          '*': 'allow',
          'docs-writer': 'deny',
        },
      },
    };
    const view = readSkillPolicies(config);
    expect(view.global).toEqual<SkillRule[]>([
      { pattern: '*', action: 'allow' },
      { pattern: 'docs-writer', action: 'deny' },
    ]);
    expect(view.perAgent).toEqual({});
  });

  it('parses per-agent `agent.<name>.permission.skill` rules preserving declaration order', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: {
          permission: { skill: { 'git-*': 'deny', 'context7': 'ask' } },
        },
        nas_qa: {
          permission: { skill: { 'mind-*': 'allow' } },
        },
      },
    };
    const view = readSkillPolicies(config);
    expect(view.perAgent.nas_developer).toEqual<SkillRule[]>([
      { pattern: 'git-*', action: 'deny' },
      { pattern: 'context7', action: 'ask' },
    ]);
    expect(view.perAgent.nas_qa).toEqual<SkillRule[]>([
      { pattern: 'mind-*', action: 'allow' },
    ]);
  });

  it('parses both global and per-agent rules in a single config', () => {
    const config: OpenCodeConfig = {
      permission: { skill: { '*': 'allow' } },
      agent: {
        nas_developer: { permission: { skill: { 'docs-*': 'deny' } } },
      },
    };
    const view = readSkillPolicies(config);
    expect(view.global).toEqual<SkillRule[]>([{ pattern: '*', action: 'allow' }]);
    expect(view.perAgent.nas_developer).toEqual<SkillRule[]>([
      { pattern: 'docs-*', action: 'deny' },
    ]);
  });

  it('skips per-agent entries with no permission block', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: { model: 'anthropic/claude-sonnet-4-6' },
        nas_qa: { permission: { skill: { 'foo': 'deny' } } },
      },
    };
    const view = readSkillPolicies(config);
    expect(view.perAgent.nas_developer).toBeUndefined();
    expect(view.perAgent.nas_qa).toEqual<SkillRule[]>([{ pattern: 'foo', action: 'deny' }]);
  });

  it('skips per-agent entries whose permission block has no `skill` block', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: { permission: { edit: { '*': 'allow' } } },
      },
    };
    const view = readSkillPolicies(config);
    expect(view.perAgent.nas_developer).toBeUndefined();
  });

  it('does not mutate the input config', () => {
    const config: OpenCodeConfig = {
      permission: { skill: { '*': 'allow' } },
      agent: { nas_developer: { permission: { skill: { 'a': 'deny' } } } },
    };
    const snapshot = JSON.stringify(config);
    readSkillPolicies(config);
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

describe('addSkillPolicy — pure mutator returning a new config', () => {
  it('`all-nas` fans out the rule to every canonical NAS agent as a per-agent block', () => {
    const config: OpenCodeConfig = {};
    const next = addSkillPolicy(config, 'all-nas', 'docs-writer', 'deny');
    // No top-level permission.skill written — the broad scope is fan-out only.
    expect(next.permission?.skill).toBeUndefined();
    // Every NAS agent has the rule on its per-agent block.
    for (const name of NAS_AGENTS) {
      expect(next.agent?.[name]?.permission?.skill).toEqual({
        'docs-writer': 'deny',
      });
    }
    // Original config is not mutated.
    expect(config.permission).toBeUndefined();
    expect(config.agent).toBeUndefined();
  });

  it('`all-nas` preserves existing agent fields (model, mode, ...) when fanning out', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: { model: 'anthropic/claude-sonnet-4-6', mode: 'subagent' },
      },
    };
    const next = addSkillPolicy(config, 'all-nas', 'git-*', 'deny');
    expect(next.agent?.nas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
    expect(next.agent?.nas_developer?.mode).toBe('subagent');
    expect(next.agent?.nas_developer?.permission?.skill).toEqual({ 'git-*': 'deny' });
  });

  it('`all-nas` appends to existing per-agent `permission.skill` blocks instead of overwriting', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { permission: { skill: { 'a': 'deny' } } } },
    };
    const next = addSkillPolicy(config, 'all-nas', 'b', 'ask');
    expect(next.agent?.nas_developer?.permission?.skill).toEqual({
      a: 'deny',
      b: 'ask',
    });
  });

  it('`all-nas` never writes to top-level `permission.skill` (NAS-only semantics)', () => {
    const config: OpenCodeConfig = {
      permission: { edit: { '*': 'allow' } },
    };
    const next = addSkillPolicy(config, 'all-nas', 'git-*', 'deny');
    expect(next.permission?.skill).toBeUndefined();
    expect(next.permission?.edit).toEqual({ '*': 'allow' });
  });

  it('adds a rule to a per-agent scope, creating the agent block when needed', () => {
    const config: OpenCodeConfig = {};
    const next = addSkillPolicy(config, 'agent', 'context7', 'deny', 'nas_developer');
    expect(next.agent?.nas_developer?.permission?.skill).toEqual({ context7: 'deny' });
  });

  it('preserves existing agent fields (model, mode, ...) when adding a skill rule', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: { model: 'anthropic/claude-sonnet-4-6', mode: 'subagent' },
      },
    };
    const next = addSkillPolicy(config, 'agent', 'git-*', 'deny', 'nas_developer');
    expect(next.agent?.nas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
    expect(next.agent?.nas_developer?.mode).toBe('subagent');
    expect(next.agent?.nas_developer?.permission?.skill).toEqual({ 'git-*': 'deny' });
  });

  it('adds a new pattern to an existing per-agent `permission.skill` block', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { permission: { skill: { 'a': 'deny' } } } },
    };
    const next = addSkillPolicy(config, 'agent', 'b', 'ask', 'nas_developer');
    expect(next.agent?.nas_developer?.permission?.skill).toEqual({ a: 'deny', b: 'ask' });
  });

  it('preserves unrelated top-level config keys', () => {
    const config: OpenCodeConfig = {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'Nova Agent Squad',
      mcp: { s: { type: 'local', command: ['x'] } as any },
    };
    const next = addSkillPolicy(config, 'all-nas', 'git-*', 'deny');
    expect(next.$schema).toBe('https://opencode.ai/config.json');
    expect(next.default_agent).toBe('Nova Agent Squad');
    expect(next.mcp).toBeDefined();
  });

  it('rejects an invalid action and does not mutate the config', () => {
    const config: OpenCodeConfig = {};
    expect(() =>
      addSkillPolicy(config, 'all-nas', 'docs-writer', 'bogus' as PermissionAction),
    ).toThrow(/action/i);
    expect(config.permission).toBeUndefined();
  });

  it('rejects an empty pattern and does not mutate the config', () => {
    const config: OpenCodeConfig = {};
    expect(() => addSkillPolicy(config, 'all-nas', '', 'deny')).toThrow(/pattern/i);
    expect(config.permission).toBeUndefined();
  });

  it('requires an agent name when scope is `agent`', () => {
    const config: OpenCodeConfig = {};
    expect(() => addSkillPolicy(config, 'agent', 'docs-writer', 'deny')).toThrow(
      /agent/i,
    );
    expect(config.agent).toBeUndefined();
  });

  it('preserves native OpenCode wildcard patterns as-is (`*`, `?` — do not invent a matcher)', () => {
    const config: OpenCodeConfig = {};
    const next = addSkillPolicy(config, 'all-nas', 'a*?b', 'allow');
    // The pattern is stored verbatim in every NAS agent's per-agent block.
    for (const name of NAS_AGENTS) {
      expect(next.agent?.[name]?.permission?.skill).toEqual({ 'a*?b': 'allow' });
    }
  });
});

describe('removeSkillPolicy — pure mutator returning a new config', () => {
  it('`all-nas` removes the pattern from every NAS agent per-agent block', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: { permission: { skill: { 'a': 'deny' } } },
        nas_qa: { permission: { skill: { 'a': 'deny' } } },
      },
    };
    const next = removeSkillPolicy(config, 'all-nas', 'a');
    expect(next.agent?.nas_developer?.permission?.skill).toBeUndefined();
    expect(next.agent?.nas_qa?.permission?.skill).toBeUndefined();
  });

  it('`all-nas` never touches top-level `permission.skill` (legacy/manual rules are preserved)', () => {
    const config: OpenCodeConfig = {
      permission: { skill: { '*': 'allow' } },
      agent: {
        nas_developer: { permission: { skill: { 'a': 'deny' } } },
      },
    };
    const next = removeSkillPolicy(config, 'all-nas', 'a');
    // Per-agent rule is removed; top-level rule is untouched.
    expect(next.permission?.skill).toEqual({ '*': 'allow' });
    expect(next.agent?.nas_developer?.permission?.skill).toBeUndefined();
  });

  it('`all-nas` is a no-op when no NAS agent has the pattern', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { permission: { skill: { 'a': 'deny' } } } },
    };
    const next = removeSkillPolicy(config, 'all-nas', 'does-not-exist');
    expect(next.agent?.nas_developer?.permission?.skill).toEqual({ a: 'deny' });
  });

  it('removes a per-agent pattern and leaves other rules intact', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: { permission: { skill: { 'a': 'deny', 'b': 'ask' } } },
      },
    };
    const next = removeSkillPolicy(config, 'agent', 'a', 'nas_developer');
    expect(next.agent?.nas_developer?.permission?.skill).toEqual({ b: 'ask' });
  });

  it('cleans up the per-agent `permission` and `agent.<name>` block when emptied', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: {
          permission: { skill: { 'a': 'deny' } },
          model: 'anthropic/claude-sonnet-4-6',
        },
        nas_qa: { model: 'opencode/deepseek-v4-pro' },
      },
    };
    const next = removeSkillPolicy(config, 'agent', 'a', 'nas_developer');
    // The nas_developer block must NOT be removed if it still has sibling fields.
    // In this test the only remaining field is `permission` (now empty) and
    // the agent block keeps `model`, so the block stays.
    expect(next.agent?.nas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
    expect(next.agent?.nas_developer?.permission).toBeUndefined();
    expect(next.agent?.nas_qa?.model).toBe('opencode/deepseek-v4-pro');
  });

  it('drops the per-agent block when the last rule is removed and no sibling fields remain', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: { permission: { skill: { 'a': 'deny' } } },
      },
    };
    const next = removeSkillPolicy(config, 'agent', 'a', 'nas_developer');
    expect(next.agent?.nas_developer).toBeUndefined();
  });

  it('drops the top-level `agent` block when the last per-agent entry is removed', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { permission: { skill: { 'a': 'deny' } } } },
    };
    const next = removeSkillPolicy(config, 'agent', 'a', 'nas_developer');
    expect(next.agent).toBeUndefined();
  });

  it('returns an unchanged config when the per-agent pattern does not exist', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { permission: { skill: { 'a': 'deny' } } } },
    };
    const next = removeSkillPolicy(config, 'agent', 'nope', 'nas_developer');
    expect(next.agent?.nas_developer?.permission?.skill).toEqual({ a: 'deny' });
  });

  it('requires an agent name when scope is `agent`', () => {
    const config: OpenCodeConfig = {};
    expect(() => removeSkillPolicy(config, 'agent', 'docs-writer')).toThrow(/agent/i);
  });
});

describe('clearSkillPolicies — pure mutator returning a new config', () => {
  it('`all-nas` clears per-agent blocks for every NAS agent, never touching top-level', () => {
    const config: OpenCodeConfig = {
      permission: { skill: { '*': 'allow' } },
      agent: {
        nas_developer: {
          permission: { skill: { 'a': 'deny' } },
          model: 'anthropic/claude-sonnet-4-6',
        },
        nas_qa: {
          permission: { skill: { 'b': 'ask' } },
          model: 'opencode/deepseek-v4-pro',
        },
      },
    };
    const next = clearSkillPolicies(config, 'all-nas');
    // Top-level is preserved (the CLI does not manage it).
    expect(next.permission?.skill).toEqual({ '*': 'allow' });
    // Per-agent blocks are cleared.
    expect(next.agent?.nas_developer?.permission?.skill).toBeUndefined();
    expect(next.agent?.nas_qa?.permission?.skill).toBeUndefined();
    // Agents are kept when they have sibling fields.
    expect(next.agent?.nas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
    expect(next.agent?.nas_qa?.model).toBe('opencode/deepseek-v4-pro');
  });

  it('`all` (default for `nas skills clear`) clears per-agent blocks for every NAS agent and never touches top-level', () => {
    const config: OpenCodeConfig = {
      permission: { skill: { '*': 'allow' } },
      agent: {
        nas_developer: {
          permission: { skill: { 'a': 'deny' } },
          model: 'anthropic/claude-sonnet-4-6',
        },
      },
    };
    const next = clearSkillPolicies(config, 'all');
    // Top-level is preserved (the CLI does not manage it).
    expect(next.permission?.skill).toEqual({ '*': 'allow' });
    // Per-agent blocks are cleared.
    expect(next.agent?.nas_developer?.permission?.skill).toBeUndefined();
    expect(next.agent?.nas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('clears a single per-agent `permission.skill` block, keeping the agent entry', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: {
          permission: { skill: { '*': 'allow', 'docs-writer': 'deny' } },
          model: 'anthropic/claude-sonnet-4-6',
        },
      },
    };
    const next = clearSkillPolicies(config, 'agent', 'nas_developer');
    expect(next.agent?.nas_developer?.model).toBe('anthropic/claude-sonnet-4-6');
    expect(next.agent?.nas_developer?.permission?.skill).toBeUndefined();
  });

  it('returns an unchanged config when there is nothing to clear', () => {
    const config: OpenCodeConfig = { permission: { edit: { '*': 'allow' } } };
    const next = clearSkillPolicies(config, 'all-nas');
    expect(next.permission).toEqual({ edit: { '*': 'allow' } });
  });

  it('requires an agent name when scope is `agent`', () => {
    const config: OpenCodeConfig = {};
    expect(() => clearSkillPolicies(config, 'agent')).toThrow(/agent/i);
  });

  it('does not mutate the input config', () => {
    const config: OpenCodeConfig = {
      permission: { skill: { '*': 'allow' } },
      agent: { nas_developer: { permission: { skill: { 'a': 'deny' } } } },
    };
    const snapshot = JSON.stringify(config);
    clearSkillPolicies(config, 'all');
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

describe('scope typing — SkillScope is the exhaustive list', () => {
  it('exposes the same three scopes the CLI uses', () => {
    const scopes: SkillScope[] = ['all-nas', 'agent', 'all'];
    expect(scopes).toContain('all-nas');
    expect(scopes).toContain('agent');
    expect(scopes).toContain('all');
  });
});
