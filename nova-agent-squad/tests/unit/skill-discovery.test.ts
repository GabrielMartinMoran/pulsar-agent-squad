/**
 * Unit tests for the skill-discovery wrapper.
 *
 * The `opencode debug skill` integration is exercised by the integration
 * tests, which can spawn the real `opencode` binary. Here we focus on
 * the parser, which is the part we can exercise in isolation and
 * deterministically.
 */

import { describe, expect, it } from 'bun:test';
import {
  parseOpencodeDebugSkill,
  listAvailableSkills,
  SkillDiscoveryError,
} from '../../src/cli/lib/skill-discovery';

describe('parseOpencodeDebugSkill — pure JSON parser', () => {
  it('returns an empty list for an empty array', () => {
    expect(parseOpencodeDebugSkill('[]')).toEqual([]);
  });

  it('extracts names from a well-formed payload', () => {
    const payload = JSON.stringify([
      { name: 'git', description: 'git skill' },
      { name: 'context7', description: 'context7 skill' },
    ]);
    expect(parseOpencodeDebugSkill(payload)).toEqual(['git', 'context7']);
  });

  it('preserves the order in which names appear', () => {
    const payload = JSON.stringify([
      { name: 'zeta' },
      { name: 'alpha' },
      { name: 'beta' },
    ]);
    expect(parseOpencodeDebugSkill(payload)).toEqual(['zeta', 'alpha', 'beta']);
  });

  it('deduplicates names', () => {
    const payload = JSON.stringify([
      { name: 'git' },
      { name: 'context7' },
      { name: 'git' },
    ]);
    expect(parseOpencodeDebugSkill(payload)).toEqual(['git', 'context7']);
  });

  it('skips entries without a name', () => {
    const payload = JSON.stringify([
      { name: 'git' },
      { description: 'orphan' },
      { name: 'context7' },
    ]);
    expect(parseOpencodeDebugSkill(payload)).toEqual(['git', 'context7']);
  });

  it('skips entries with non-string names', () => {
    const payload = JSON.stringify([
      { name: 42 },
      { name: 'git' },
      { name: null },
    ]);
    expect(parseOpencodeDebugSkill(payload)).toEqual(['git']);
  });

  it('skips entries with empty-string names', () => {
    const payload = JSON.stringify([
      { name: '' },
      { name: 'git' },
    ]);
    expect(parseOpencodeDebugSkill(payload)).toEqual(['git']);
  });

  it('throws a SkillDiscoveryError on non-JSON input', () => {
    expect(() => parseOpencodeDebugSkill('not json')).toThrow(SkillDiscoveryError);
  });

  it('throws a SkillDiscoveryError on JSON that is not an array', () => {
    expect(() => parseOpencodeDebugSkill('{"name": "git"}')).toThrow(
      SkillDiscoveryError,
    );
  });
});

describe('listAvailableSkills — injection point', () => {
  it('uses the stub payload when provided (no opencode binary needed)', () => {
    const stub = JSON.stringify([{ name: 'git' }, { name: 'context7' }]);
    const names = listAvailableSkills({ stub });
    expect(names).toEqual(['git', 'context7']);
  });

  it('uses a custom runner when provided (no opencode binary needed)', () => {
    const runner = () => JSON.stringify([{ name: 'foo' }]);
    const names = listAvailableSkills({ runner });
    expect(names).toEqual(['foo']);
  });

  it('throws a SkillDiscoveryError when the runner returns invalid JSON', () => {
    const runner = () => 'oops not json';
    expect(() => listAvailableSkills({ runner })).toThrow(SkillDiscoveryError);
  });
});
