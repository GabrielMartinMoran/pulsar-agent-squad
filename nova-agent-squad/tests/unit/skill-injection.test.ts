/**
 * Unit tests for the build-time `permission.skill` injection helper.
 *
 * The helper is the runtime fix for the IADEV skill deny precedence bug
 * (memory: permission-skill-precedence-bug-confirmed-20260701): the
 * agent's source frontmatter contains a top-level `*`: allow which, when
 * merged with the user's `opencode.json`, shadows per-agent
 * `permission.skill.IADEV*: deny`. The build step now compiles the
 * user's per-agent `permission.skill` block INTO the agent's frontmatter
 * `permission:` block, placed AFTER the `*`: allow line so OpenCode's
 * "last matching rule wins" semantics make the specific skill rules
 * override the catch-all.
 *
 * Scope (per approved contract, design memory
 * permission-skill-fix-design-20260701):
 *   - Injection is per-NAS-agent only (per-agent block from opencode.json).
 *   - The `*`: allow line is the FIRST child of `permission:`; the
 *     `skill:` block is inserted immediately after it.
 *   - When the per-agent block is empty/missing, no `skill:` line is
 *     added (frontmatter stays byte-identical to source).
 *   - When an existing `skill:` line is present in the source frontmatter
 *     (not expected for canonical NAS agents, but defensive), it is
 *     replaced with the merged rules.
 *   - Non-OpenCode platforms are NOT touched (no `permission:` block in
 *     the source).
 */

import { describe, expect, it } from 'bun:test';
import {
  readAgentSkillBlock,
  findPermissionBlock,
  findStarAllowLine,
  injectSkillBlock,
} from '../../src/cli/lib/skill-injection';
import type { OpenCodeConfig } from '../../src/cli/lib/config-safety';

const SAMPLE_FRONTMATTER = `---
description: "Developer agent"
mode: subagent
hidden: true
temperature: 0.4
permission:
  "*": allow
  edit:
    "*": allow
  task: deny
  question: deny
  todowrite: deny
---

# nas_developer
Body line.
`;

const ORCHESTRATOR_FRONTMATTER = `---
description: "Orchestrator"
mode: primary
temperature: 0.2
permission:
  "*": allow
  edit: deny
  bash: deny
  glob: deny
  grep: deny
  list: deny
  websearch: allow
  todowrite: allow
  read:
    "*": deny
    ".agents/nas.config.yaml": allow
  task:
    "*": deny
    "nas_researcher": allow
    "nas_planner": allow
    "nas_developer": allow
    "nas_developer_mini": allow
    "nas_qa": allow
---

# Nova Agent Squad
Body line.
`;

describe('readAgentSkillBlock', () => {
  it('returns empty object when config has no agent block', () => {
    const config: OpenCodeConfig = {};
    expect(readAgentSkillBlock(config, 'nas_developer')).toEqual({});
  });

  it('returns empty object when agent has no permission.skill block', () => {
    const config: OpenCodeConfig = {
      agent: { nas_developer: { permission: { edit: { '*': 'allow' } } } },
    };
    expect(readAgentSkillBlock(config, 'nas_developer')).toEqual({});
  });

  it('returns the per-agent permission.skill block when present', () => {
    const config: OpenCodeConfig = {
      agent: {
        nas_developer: {
          permission: { skill: { 'IADEV*': 'deny', 'git-*': 'deny' } },
        },
      },
    };
    expect(readAgentSkillBlock(config, 'nas_developer')).toEqual({
      'IADEV*': 'deny',
      'git-*': 'deny',
    });
  });

  it('ignores invalid action values silently', () => {
    const config = {
      agent: {
        nas_developer: {
          permission: {
            skill: {
              'IADEV*': 'deny',
              'broken': 'bogus' as unknown as 'allow',
            },
          },
        },
      },
    } as unknown as OpenCodeConfig;
    expect(readAgentSkillBlock(config, 'nas_developer')).toEqual({
      'IADEV*': 'deny',
    });
  });
});

describe('findPermissionBlock', () => {
  it('locates the permission block bounds in a simple agent file', () => {
    const block = findPermissionBlock(SAMPLE_FRONTMATTER);
    expect(block).not.toBeNull();
    expect(block!.permLine).toBe(5);
    // The `  "*": allow` line is the first child.
    expect(block!.firstChildLine).toBe(6);
    // The last child is the `  todowrite: deny` line at index 11.
    expect(block!.lastChildLine).toBe(11);
    // The block ends just before the closing `---` at line 12.
    expect(block!.endLine).toBe(12);
  });

  it('handles a deeply nested permission block (orchestrator)', () => {
    const block = findPermissionBlock(ORCHESTRATOR_FRONTMATTER);
    expect(block).not.toBeNull();
    expect(block!.permLine).toBe(4);
    // First child is `  "*": allow` at line 5.
    expect(block!.firstChildLine).toBe(5);
    // The deepest child of `task:` is the `  "nas_qa": allow` line at 22.
    expect(block!.lastChildLine).toBe(22);
    expect(block!.endLine).toBe(23);
  });

  it('returns null when no permission block exists', () => {
    const md = `---
description: "no permissions"
mode: subagent
---

# body
`;
    expect(findPermissionBlock(md)).toBeNull();
  });
});

describe('findStarAllowLine', () => {
  it('locates the `*`: allow line as a direct child of permission', () => {
    const block = findPermissionBlock(SAMPLE_FRONTMATTER)!;
    expect(findStarAllowLine(SAMPLE_FRONTMATTER, block)).toBe(6);
  });

  it('returns -1 when no `*`: allow child exists', () => {
    const md = `---
permission:
  edit: deny
  task: deny
---

# body
`;
    const block = findPermissionBlock(md)!;
    expect(findStarAllowLine(md, block)).toBe(-1);
  });
});

describe('injectSkillBlock', () => {
  it('inserts a `skill:` subkey AFTER the `*`: allow line', () => {
    const out = injectSkillBlock(SAMPLE_FRONTMATTER, {
      'IADEV*': 'deny',
      'git-*': 'deny',
    });
    const lines = out.split('\n');
    // The `*`: allow line is at index 6 (sample). skill must come after.
    const starLine = lines.findIndex((l) => l.trim() === '"*": allow');
    const skillLine = lines.findIndex((l) => l.trim() === 'skill:');
    expect(starLine).toBe(6);
    expect(skillLine).toBeGreaterThan(starLine);
    // The two child rules must be present, indented 4 spaces (one level
    // deeper than `skill:`) per OpenCode's nested-permission-block
    // convention.
    expect(lines[skillLine + 1]).toBe('    "IADEV*": deny');
    expect(lines[skillLine + 2]).toBe('    "git-*": deny');
  });

  it('is a no-op when rules object is empty', () => {
    expect(injectSkillBlock(SAMPLE_FRONTMATTER, {})).toBe(SAMPLE_FRONTMATTER);
  });

  it('is a no-op when no permission block exists in the source', () => {
    const md = `---
description: "no permissions"
mode: subagent
---

# body
`;
    expect(injectSkillBlock(md, { 'IADEV*': 'deny' })).toBe(md);
  });

  it('appends skill at end of permission block when no `*`: allow present', () => {
    const md = `---
description: "no star"
mode: subagent
permission:
  edit: deny
  task: deny
---

# body
`;
    const out = injectSkillBlock(md, { 'IADEV*': 'deny' });
    const lines = out.split('\n');
    // The block ends right before the closing `---` on line 7 (0-indexed).
    const skillLine = lines.findIndex((l) => l.trim() === 'skill:');
    expect(skillLine).toBeGreaterThan(0);
    expect(lines[skillLine + 1]).toBe('    "IADEV*": deny');
    // The skill block is the LAST child of permission, just before `---`.
    expect(lines[skillLine + 2].trim()).toBe('---');
  });

  it('replaces an existing `skill:` block in the source frontmatter', () => {
    const md = `---
permission:
  "*": allow
  skill:
    "old-key": allow
---

# body
`;
    const out = injectSkillBlock(md, { 'IADEV*': 'deny' });
    const lines = out.split('\n');
    // No duplicate skill line.
    const skillCount = lines.filter((l) => l.trim() === 'skill:').length;
    expect(skillCount).toBe(1);
    // The new rule is present; the old one is gone.
    expect(out).toContain('"IADEV*": deny');
    expect(out).not.toContain('"old-key": allow');
  });

  it('places skill AFTER `*`: allow but BEFORE the orchestrator nested children', () => {
    const out = injectSkillBlock(ORCHESTRATOR_FRONTMATTER, {
      'IADEV*': 'deny',
    });
    const lines = out.split('\n');
    const starLine = lines.findIndex((l) => l.trim() === '"*": allow');
    const skillLine = lines.findIndex((l) => l.trim() === 'skill:');
    const taskLine = lines.findIndex((l) => l.trim() === 'task:');
    expect(starLine).toBe(5);
    expect(skillLine).toBeGreaterThan(starLine);
    expect(skillLine).toBeLessThan(taskLine);
    expect(lines[skillLine + 1]).toBe('    "IADEV*": deny');
  });

  it('preserves the body content below the frontmatter', () => {
    const out = injectSkillBlock(SAMPLE_FRONTMATTER, { 'IADEV*': 'deny' });
    expect(out).toContain('\n---\n\n# nas_developer\nBody line.\n');
  });

  it('handles single-rule injection (one pattern)', () => {
    const out = injectSkillBlock(SAMPLE_FRONTMATTER, { 'IADEV*': 'deny' });
    const lines = out.split('\n');
    const skillLine = lines.findIndex((l) => l.trim() === 'skill:');
    expect(skillLine).toBeGreaterThan(0);
    expect(lines[skillLine + 1]).toBe('    "IADEV*": deny');
  });
});
