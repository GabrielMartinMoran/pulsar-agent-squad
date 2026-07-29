/**
 * Unit tests for the `nas skills` read-only summary presenter.
 *
 * The presenter renders the `permission.skill` view (per-NAS-agent only)
 * as a card-per-scope summary. The CLI does not manage the top-level
 * `permission.skill` block (which is OpenCode-wide and would leak past
 * NAS), so the presenter does not surface it as a managed scope.
 *
 * The presenter is the only surface used by the bare `nas skills`
 * command and the explicit `nas skills list` subcommand — both must
 * produce byte-identical output (the same invariant that
 * `nas agents` / `nas agents list` enforce).
 *
 * Color policy mirrors the `nas agents` presenter: `plain` wins, then
 * NO_COLOR, then non-TTY, then the implicit TTY default. There is no
 * external color dependency.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildSkillSummary,
  formatSkillScopeCard,
  type SkillSummaryCard,
  type SkillSummaryOptions,
} from '../../src/cli/commands/skills/presenter';
import { NAS_AGENTS } from '../../src/cli/commands/agents/presenter';
import { readSkillPolicies } from '../../src/cli/lib/skill-policies';
import type { OpenCodeConfig } from '../../src/cli/lib/config-safety';

const PLAIN: SkillSummaryOptions = { plain: true };

describe('formatSkillScopeCard — single-scope card view', () => {
  it('renders a per-agent scope with its rules', () => {
    const card = formatSkillScopeCard({
      scopeLabel: 'nas_developer',
      rules: [{ pattern: 'git-*', action: 'deny' }],
      colorize: false,
    });
    expect(card).toContain('nas_developer');
    expect(card).toMatch(/Pattern:\s+git-\*/);
  });

  it('shows a `(no rules)` placeholder for an empty scope', () => {
    const card = formatSkillScopeCard({
      scopeLabel: 'nas_qa',
      rules: [],
      colorize: false,
    });
    expect(card).toContain('nas_qa');
    expect(card).toMatch(/\(no rules\)/);
  });

  it('does NOT use success/failure glyphs for rule rows', () => {
    const card = formatSkillScopeCard({
      scopeLabel: 'g',
      rules: [
        { pattern: 'a', action: 'allow' },
        { pattern: 'b', action: 'deny' },
        { pattern: 'c', action: 'ask' },
      ],
      colorize: false,
    });
    expect(card).not.toMatch(/[✓✔]/);
    expect(card).not.toMatch(/[✗✘×]/);
  });

  it('emits no ANSI codes when colorize is false', () => {
    const card = formatSkillScopeCard({
      scopeLabel: 'g',
      rules: [{ pattern: '*', action: 'allow' }],
      colorize: false,
    });
    expect(card).not.toContain('\x1b[');
  });

  it('emits ANSI codes when colorize is true', () => {
    const card = formatSkillScopeCard({
      scopeLabel: 'g',
      rules: [{ pattern: '*', action: 'allow' }],
      colorize: true,
    });
    expect(card).toContain('\x1b[');
  });

  it('displays the action label verbatim (allow / deny / ask)', () => {
    const allowCard = formatSkillScopeCard({
      scopeLabel: 'g',
      rules: [{ pattern: 'a', action: 'allow' }],
      colorize: false,
    });
    const denyCard = formatSkillScopeCard({
      scopeLabel: 'g',
      rules: [{ pattern: 'a', action: 'deny' }],
      colorize: false,
    });
    const askCard = formatSkillScopeCard({
      scopeLabel: 'g',
      rules: [{ pattern: 'a', action: 'ask' }],
      colorize: false,
    });
    expect(allowCard).toMatch(/Action:\s+allow/);
    expect(denyCard).toMatch(/Action:\s+deny/);
    expect(askCard).toMatch(/Action:\s+ask/);
  });
});

describe('buildSkillSummary — full read-only view', () => {
  const configEmpty: OpenCodeConfig = {};

  it('renders every NAS agent scope (the only managed scopes)', () => {
    const out = buildSkillSummary(readSkillPolicies(configEmpty), PLAIN);
    // No "Global" card: the CLI does not manage top-level `permission.skill`.
    expect(out).not.toMatch(/^\s*Global\s*$/m);
    for (const name of NAS_AGENTS) {
      expect(out).toContain(name);
    }
  });

  it('places the NAS agents in NAS_AGENTS canonical order', () => {
    const out = buildSkillSummary(readSkillPolicies(configEmpty), PLAIN);
    const positions: number[] = [];
    let cursor = 0;
    for (const name of NAS_AGENTS) {
      const idx = out.indexOf(name, cursor);
      expect(idx).toBeGreaterThanOrEqual(0);
      positions.push(idx);
      cursor = idx + name.length;
    }
    // Strictly non-decreasing (they are in order).
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
  });

  it('shows the configured per-agent rules when present', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: { permission: { skill: { 'git-*': 'deny' } } },
      },
    };
    const out = buildSkillSummary(readSkillPolicies(config), PLAIN);
    // The rule must appear in the nas_developer block, not anywhere else.
    // nas_developer is the THIRD NAS agent (after nas_researcher and
    // nas_planner), so its block ends where the next scope starts.
    const devBlockStart = out.indexOf('nas_developer');
    const nextScope = out.indexOf('nas_developer_mini');
    expect(devBlockStart).toBeGreaterThanOrEqual(0);
    expect(nextScope).toBeGreaterThan(devBlockStart);
    const devBlock = out.slice(devBlockStart, nextScope);
    expect(devBlock).toMatch(/Pattern:\s+git-\*/);
  });

  it('does NOT surface top-level `permission.skill` rules (CLI does not manage them)', () => {
    // Even when top-level rules exist (legacy/manual), the presenter must
    // not show them as a managed scope. They are out of NAS's surface.
    const config: OpenCodeConfig = {
      permission: { skill: { '*': 'allow', 'docs-writer': 'deny' } },
    };
    const out = buildSkillSummary(readSkillPolicies(config), PLAIN);
    // No "Global" card label.
    expect(out).not.toMatch(/^\s*Global\s*$/m);
    // The top-level patterns must not appear in the rendered output.
    expect(out).not.toMatch(/Pattern:\s+\*/);
    expect(out).not.toMatch(/Pattern:\s+docs-writer/);
  });

  it('marks scopes that have rules with an override indicator', () => {
    const config: OpenCodeConfig = {
      agent: { nas_qa: { permission: { skill: { 'foo': 'deny' } } } },
    };
    const out = buildSkillSummary(readSkillPolicies(config), PLAIN);
    // at least one override marker
    expect(out.match(/●/g)?.length).toBeGreaterThanOrEqual(1);
    // the rest should be default markers
    expect(out.match(/○/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('emits no ANSI codes when plain: true', () => {
    const out = buildSkillSummary(readSkillPolicies(configEmpty), { plain: true });
    expect(out).not.toContain('\x1b[');
  });

  it('is safe when no scopes have rules (all NAS agent blocks show "(no rules)")', () => {
    const out = buildSkillSummary(readSkillPolicies(configEmpty), PLAIN);
    const noRulesCount = (out.match(/\(no rules\)/g) ?? []).length;
    // N NAS agent blocks; no top-level block.
    expect(noRulesCount).toBe(NAS_AGENTS.length);
  });

  it('emits a header line referencing the source file', () => {
    const out = buildSkillSummary(readSkillPolicies(configEmpty), PLAIN);
    expect(out).toMatch(/permission\.skill/i);
  });
});

describe('buildSkillSummary — input shape', () => {
  it('accepts a precomputed view (not the raw config) for testability', () => {
    // The function takes SkillPolicyView, not OpenCodeConfig, so callers
    // can compose it with mocked sources. The view's `global` field is
    // intentionally ignored by the presenter (the CLI does not manage
    // top-level rules).
    const out = buildSkillSummary(
      { global: [{ pattern: '*', action: 'allow' }], perAgent: { nas_developer: [{ pattern: 'a', action: 'deny' }] } },
      PLAIN,
    );
    // Only the per-agent rule is rendered.
    expect(out).toMatch(/Pattern:\s+a/);
    expect(out).not.toMatch(/Pattern:\s+\*/);
  });
});

describe('SkillSummaryCard — type shape sanity', () => {
  it('is the input type of formatSkillScopeCard (re-export sanity)', () => {
    const card: SkillSummaryCard = {
      scopeLabel: 'x',
      rules: [],
      colorize: false,
    };
    expect(card.scopeLabel).toBe('x');
  });
});
