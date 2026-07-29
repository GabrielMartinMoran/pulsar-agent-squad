/**
 * Unit tests for the agent-profile CRUD library.
 *
 * The library is the pure-logic foundation of the `pas agents profile` CLI
 * surface (FEAT-008). It is exercised as pure logic against parsed inputs,
 * with the filesystem layer abstracted through the `home` parameter so the
 * tests stay hermetic and deterministic.
 *
 * Approved contract (see specs/features/product/FEAT-008):
 *   - Profiles live in `~/.config/opencode/pas/profiles/<name>.json` (the
 *     `home` parameter overrides `HOME` for tests).
 *   - `save` snapshots ONLY canonical PAS agents' `model`+`variant` fields.
 *     Non-canonical agents from the live config are dropped; extra fields
 *     beyond `model`/`variant` are dropped from the saved entry.
 *   - `save` rejects duplicate names — the existing file is not overwritten.
 *   - `load` intersects the profile with `PAS_AGENTS`: only canonical agents
 *     from the profile are applied. Non-canonical/orphaned entries are
 *     silently ignored (they are still reported in the result for the CLI
 *     to surface).
 *   - `load` removes live canonical overrides that are absent from the
 *     profile (the canonical PAS agent has no override any more).
 *   - `load` preserves unrelated top-level config fields and unrelated
 *     non-canonical live overrides.
 *   - `rename` operates on profile files only; rejects missing source and
 *     existing target.
 *   - `delete` operates on profile files only; rejects missing source.
 *
 * Scenarios covered:
 *   - profile dir + path resolution (`getProfilesDir`, `getProfilePath`).
 *   - canonical filter + minimal `save` payload (`canonicalizeProfile`).
 *   - profile intersection for `load` (`applyProfileToConfig`).
 *   - save / read / list / rename / delete filesystem behavior.
 *   - strict failure modes for every command.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  applyProfileToConfig,
  canonicalizeProfile,
  type LoadResult,
  deleteProfile,
  getProfilePath,
  getProfilesDir,
  listProfiles,
  readProfile,
  renameProfile,
  saveProfile,
} from '../../src/cli/lib/profile-store';
import { PAS_AGENTS } from '../../src/cli/commands/agents/presenter';
import type { OpenCodeConfig } from '../../src/cli/lib/config-safety';

function makeTempHome(): string {
  const dir = join(
    tmpdir(),
    'pas-profile-store-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.config', 'opencode', 'pas', 'profiles'), { recursive: true });
  return dir;
}

let tempHome = '';

beforeEach(() => {
  tempHome = makeTempHome();
});

afterEach(() => {
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Path resolution
// -----------------------------------------------------------------------------

describe('getProfilesDir', () => {
  it('returns `~/.config/opencode/pas/profiles/` when no home is given', () => {
    // Sanity-check the shape: must end in `.config/opencode/pas/profiles/`
    // and be derived from `HOME` (or the explicit `home` argument).
    const dir = getProfilesDir(tempHome);
    expect(dir).toBe(join(tempHome, '.config', 'opencode', 'pas', 'profiles'));
  });

  it('returns the same directory when called twice for the same home', () => {
    expect(getProfilesDir(tempHome)).toBe(getProfilesDir(tempHome));
  });
});

describe('getProfilePath', () => {
  it('returns the file path `<dir>/<name>.json`', () => {
    const path = getProfilePath(tempHome, 'my-setup');
    expect(path).toBe(
      join(tempHome, '.config', 'opencode', 'pas', 'profiles', 'my-setup.json'),
    );
  });

  it('encodes profile names verbatim (no sanitization in the path layer)', () => {
    const path = getProfilePath(tempHome, 'a-b_c');
    expect(path).toBe(
      join(tempHome, '.config', 'opencode', 'pas', 'profiles', 'a-b_c.json'),
    );
  });
});

// -----------------------------------------------------------------------------
// canonicalizeProfile — pure filter that snapshots the live config to a
// minimal profile payload.
// -----------------------------------------------------------------------------

describe('canonicalizeProfile — pure filter over an OpenCodeConfig', () => {
  it('keeps only canonical NAS agents from the live config', () => {
    const config: OpenCodeConfig = {
      agent: {
         pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
         pas_qa: { model: 'opencode/deepseek-v4-pro' },
        'some-other-agent': { model: 'openai/gpt-5' },
      },
    };
    const profile = canonicalizeProfile(config);
    expect(Object.keys(profile).sort()).toEqual(['pas_developer', 'pas_qa']);
    expect(profile.some_other_agent).toBeUndefined();
  });

  it('drops extra fields beyond `model` and `variant` per agent', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_developer: {
          model: 'anthropic/claude-sonnet-4-6',
          variant: 'high',
          mode: 'subagent',
          permission: { skill: { '*': 'allow' } },
          custom: 42,
        } as OpenCodeConfig['agent'][string],
      },
    };
    const profile = canonicalizeProfile(config);
    expect(profile.pas_developer).toEqual({
      model: 'anthropic/claude-sonnet-4-6',
      variant: 'high',
    });
    expect(profile.pas_developer.mode).toBeUndefined();
    expect(profile.pas_developer.permission).toBeUndefined();
    expect((profile.pas_developer as Record<string, unknown>).custom).toBeUndefined();
  });

  it('accepts an entry without `variant` (model-only override)', () => {
    const config: OpenCodeConfig = {
      agent: { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } },
    };
    const profile = canonicalizeProfile(config);
    expect(profile.pas_developer).toEqual({ model: 'anthropic/claude-sonnet-4-6' });
  });

  it('drops canonical agents with no `model` field (defensive)', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_developer: { mode: 'subagent' } as OpenCodeConfig['agent'][string],
      },
    };
    const profile = canonicalizeProfile(config);
    expect(profile.pas_developer).toBeUndefined();
  });

  it('returns an empty profile when the config has no agents', () => {
    expect(canonicalizeProfile({})).toEqual({});
  });

  it('emits canonical agents in canonical PAS_AGENTS order', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_qa: { model: 'opencode/deepseek-v4-pro' },
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
        pas_researcher: { model: 'anthropic/claude-opus-4-7' },
      },
    };
    const profile = canonicalizeProfile(config);
    expect(Object.keys(profile)).toEqual(['pas_researcher', 'pas_developer', 'pas_qa']);
  });

  it('does not mutate the input config', () => {
    const config: OpenCodeConfig = {
      agent: { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } },
    };
    const snapshot = JSON.stringify(config);
    canonicalizeProfile(config);
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

// -----------------------------------------------------------------------------
// saveProfile — writes a profile file to disk
// -----------------------------------------------------------------------------

describe('saveProfile — filesystem write', () => {
  it('writes the canonical profile payload to `<dir>/<name>.json`', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
        pas_qa: { model: 'opencode/deepseek-v4-pro' },
        'some-other-agent': { model: 'openai/gpt-5' },
      },
    };
    const written = saveProfile(tempHome, 'my-setup', config);
    expect(written).toBe(getProfilePath(tempHome, 'my-setup'));
    expect(existsSync(written)).toBe(true);

    const raw = JSON.parse(readFileSync(written, 'utf-8'));
    expect(raw).toEqual({
      pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
      pas_qa: { model: 'opencode/deepseek-v4-pro' },
    });
  });

  it('rejects a name that already exists (does NOT overwrite)', () => {
    const file = getProfilePath(tempHome, 'my-setup');
    writeFileSync(file, JSON.stringify({ existing: true }, null, 2));
    const original = readFileSync(file, 'utf-8');

    const config: OpenCodeConfig = {
      agent: { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } },
    };
    expect(() => saveProfile(tempHome, 'my-setup', config)).toThrow(/exists/i);
    // The original file content must NOT have been replaced.
    expect(readFileSync(file, 'utf-8')).toBe(original);
  });

  it('creates the profile directory on first save (idempotent)', () => {
    // Tear it down then ensure save re-creates it.
    rmSync(getProfilesDir(tempHome), { recursive: true, force: true });
    expect(existsSync(getProfilesDir(tempHome))).toBe(false);
    const config: OpenCodeConfig = {
      agent: { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } },
    };
    const written = saveProfile(tempHome, 'fresh', config);
    expect(existsSync(written)).toBe(true);
  });

  it('writes canonical agents in canonical order (deterministic JSON)', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_qa: { model: 'opencode/deepseek-v4-pro' },
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
      },
    };
    const written = saveProfile(tempHome, 'orderly', config);
    const raw = JSON.parse(readFileSync(written, 'utf-8'));
    expect(Object.keys(raw)).toEqual(['pas_developer', 'pas_qa']);
  });

  it('serializes with 2-space indentation (matches the opencode.json style)', () => {
    const config: OpenCodeConfig = {
      agent: { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } },
    };
    const written = saveProfile(tempHome, 'indented', config);
    const raw = readFileSync(written, 'utf-8');
    // A snapshot with a 2-space-indented nested object must contain
    // exactly 4 spaces before `model`.
    expect(raw).toContain('  "pas_developer": {\n    "model"');
  });
});

// -----------------------------------------------------------------------------
// listProfiles
// -----------------------------------------------------------------------------

describe('listProfiles — read-only directory listing', () => {
  it('returns an empty array when no profiles exist', () => {
    expect(listProfiles(tempHome)).toEqual([]);
  });

  it('returns every `<name>.json` entry, sorted', () => {
    writeFileSync(getProfilePath(tempHome, 'b-setup'), '{}');
    writeFileSync(getProfilePath(tempHome, 'a-setup'), '{}');
    writeFileSync(getProfilePath(tempHome, 'c-setup'), '{}');
    expect(listProfiles(tempHome)).toEqual(['a-setup', 'b-setup', 'c-setup']);
  });

  it('ignores non-`.json` files in the profile directory', () => {
    writeFileSync(getProfilePath(tempHome, 'real'), '{}');
    // Write a literal non-`.json` artefact directly into the directory
    // so `listProfiles` has something to skip.
    writeFileSync(join(getProfilesDir(tempHome), 'README.md'), 'not-a-profile');
    expect(listProfiles(tempHome)).toEqual(['real']);
  });
});

// -----------------------------------------------------------------------------
// readProfile
// -----------------------------------------------------------------------------

describe('readProfile — parse an existing profile JSON', () => {
  it('returns the parsed payload for an existing profile', () => {
    const payload = { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } };
    writeFileSync(getProfilePath(tempHome, 'demo'), JSON.stringify(payload, null, 2));
    expect(readProfile(tempHome, 'demo')).toEqual(payload);
  });

  it('throws when the profile does not exist', () => {
    expect(() => readProfile(tempHome, 'nope')).toThrow(/not exist/i);
  });

  it('throws on malformed JSON (loud failure — not silent)', () => {
    writeFileSync(getProfilePath(tempHome, 'broken'), '{not-json');
    expect(() => readProfile(tempHome, 'broken')).toThrow();
  });
});

// -----------------------------------------------------------------------------
// applyProfileToConfig — pure intersection / removal logic
// -----------------------------------------------------------------------------

describe('applyProfileToConfig — pure intersection with PAS_AGENTS', () => {
  it('writes the profile entry for every canonical agent in the profile', () => {
    const config: OpenCodeConfig = {};
    const profile = {
      pas_developer: { model: 'anthropic/claude-sonnet-4-6', variant: 'high' },
      pas_qa: { model: 'opencode/deepseek-v4-pro' },
    };
    const next = applyProfileToConfig(config, profile).config;
    expect(next.agent?.pas_developer).toEqual({
      model: 'anthropic/claude-sonnet-4-6',
      variant: 'high',
    });
    expect(next.agent?.pas_qa).toEqual({ model: 'opencode/deepseek-v4-pro' });
  });

  it('removes canonical overrides that are absent from the profile', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
        pas_qa: { model: 'opencode/deepseek-v4-pro' },
      },
    };
    const profile = { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } };
    const next = applyProfileToConfig(config, profile).config;
    expect(next.agent?.pas_developer).toEqual({ model: 'anthropic/claude-sonnet-4-6' });
    expect(next.agent?.pas_qa).toBeUndefined();
  });

  it('silently ignores non-canonical / orphaned profile entries', () => {
    const config: OpenCodeConfig = {};
    const profile = {
      pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
      legacy_agent: { model: 'openai/gpt-5' },
      'random-non-pas': { model: 'claude-foo' },
    };
    const result = applyProfileToConfig(config, profile);
    // The canonical agent is applied.
    expect(result.config.agent?.pas_developer).toEqual({ model: 'anthropic/claude-sonnet-4-6' });
    // The non-canonical entries are NOT applied to the config.
    expect(result.config.agent?.legacy_agent).toBeUndefined();
    expect(result.config.agent?.['random-non-pas']).toBeUndefined();
    // They ARE reported in the result so the CLI can surface them.
    expect(result.ignored).toEqual(['legacy_agent', 'random-non-pas']);
  });

  it('preserves unrelated top-level config fields', () => {
    const config: OpenCodeConfig = {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'Pulsar Agent Squad',
      permission: { edit: { '*': 'allow' } },
      provider: { cursor: { name: 'Cursor' } },
      mcp: { s: { type: 'local', command: ['x'] } } as Record<string, unknown>,
    };
    const profile = { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } };
    const next = applyProfileToConfig(config, profile).config;
    expect(next.$schema).toBe('https://opencode.ai/config.json');
    expect(next.default_agent).toBe('Pulsar Agent Squad');
    expect(next.permission).toEqual({ edit: { '*': 'allow' } });
    expect(next.provider).toEqual({ cursor: { name: 'Cursor' } });
    expect(next.mcp).toBeDefined();
  });

  it('preserves non-canonical agent overrides present in the live config', () => {
    const config: OpenCodeConfig = {
      agent: {
        'user-custom-agent': { model: 'openai/gpt-5' },
        pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
      },
    };
    const profile = { pas_developer: { model: 'anthropic/claude-sonnet-4-7' } };
    const next = applyProfileToConfig(config, profile).config;
    // Non-canonical user override is preserved verbatim.
    expect(next.agent?.['user-custom-agent']).toEqual({ model: 'openai/gpt-5' });
    // Canonical agent is updated to the profile value.
    expect(next.agent?.pas_developer).toEqual({ model: 'anthropic/claude-sonnet-4-7' });
  });

  it('preserves sibling fields on a canonical agent outside `model` / `variant`', () => {
    const config: OpenCodeConfig = {
      agent: {
        pas_developer: {
          model: 'anthropic/claude-sonnet-4-6',
          variant: 'high',
          mode: 'subagent',
        },
      },
    };
    const profile = { pas_developer: { model: 'anthropic/claude-sonnet-4-7' } };
    const next = applyProfileToConfig(config, profile).config;
    expect(next.agent?.pas_developer?.mode).toBe('subagent');
    expect(next.agent?.pas_developer?.model).toBe('anthropic/claude-sonnet-4-7');
  });

  it('returns an applied list of canonical agent names that were updated', () => {
    const config: OpenCodeConfig = {};
    const profile = {
      pas_developer: { model: 'anthropic/claude-sonnet-4-6' },
      pas_qa: { model: 'opencode/deepseek-v4-pro' },
    };
    const result: LoadResult = applyProfileToConfig(config, profile);
    expect(result.applied.sort()).toEqual(['pas_developer', 'pas_qa']);
  });

  it('does not mutate the input config', () => {
    const config: OpenCodeConfig = {
      agent: { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } },
    };
    const snapshot = JSON.stringify(config);
    applyProfileToConfig(config, { pas_qa: { model: 'opencode/deepseek-v4-pro' } });
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

// -----------------------------------------------------------------------------
// renameProfile
// -----------------------------------------------------------------------------

describe('renameProfile — filesystem rename', () => {
  it('renames an existing profile and preserves its content', () => {
    const payload = { pas_developer: { model: 'anthropic/claude-sonnet-4-6' } };
    writeFileSync(getProfilePath(tempHome, 'old-name'), JSON.stringify(payload, null, 2));
    const newPath = renameProfile(tempHome, 'old-name', 'new-name');
    expect(newPath).toBe(getProfilePath(tempHome, 'new-name'));
    expect(existsSync(getProfilePath(tempHome, 'old-name'))).toBe(false);
    expect(existsSync(getProfilePath(tempHome, 'new-name'))).toBe(true);
    expect(JSON.parse(readFileSync(getProfilePath(tempHome, 'new-name'), 'utf-8'))).toEqual(
      payload,
    );
  });

  it('rejects when the source profile does not exist', () => {
    expect(() => renameProfile(tempHome, 'ghost', 'phantom')).toThrow(/not exist/i);
    expect(existsSync(getProfilePath(tempHome, 'phantom'))).toBe(false);
  });

  it('rejects when the target profile already exists', () => {
    writeFileSync(getProfilePath(tempHome, 'alpha'), '{}');
    writeFileSync(getProfilePath(tempHome, 'beta'), '{}');
    const before = readFileSync(getProfilePath(tempHome, 'alpha'), 'utf-8');
    expect(() => renameProfile(tempHome, 'alpha', 'beta')).toThrow(/exists/i);
    // Source content untouched.
    expect(readFileSync(getProfilePath(tempHome, 'alpha'), 'utf-8')).toBe(before);
  });
});

// -----------------------------------------------------------------------------
// deleteProfile
// -----------------------------------------------------------------------------

describe('deleteProfile — filesystem delete', () => {
  it('deletes an existing profile file', () => {
    writeFileSync(getProfilePath(tempHome, 'to-remove'), '{}');
    const removed = deleteProfile(tempHome, 'to-remove');
    expect(removed).toBe(getProfilePath(tempHome, 'to-remove'));
    expect(existsSync(getProfilePath(tempHome, 'to-remove'))).toBe(false);
  });

  it('rejects when the profile does not exist', () => {
    expect(() => deleteProfile(tempHome, 'nope')).toThrow(/not exist/i);
  });
});

// -----------------------------------------------------------------------------
// PAS_AGENTS re-export sanity — keeps profile-store + the agents presenter
// in sync.
// -----------------------------------------------------------------------------

describe('PAS_AGENTS canonical list (re-export sanity)', () => {
  it('covers the agents referenced in the FEAT-008 contract scenarios', () => {
    expect(PAS_AGENTS).toContain('pas_developer');
    expect(PAS_AGENTS).toContain('pas_qa');
  });
});
