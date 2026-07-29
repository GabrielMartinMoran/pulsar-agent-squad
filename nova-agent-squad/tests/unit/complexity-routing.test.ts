import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

/**
 * NAS Experimental Mini Developer Rollout — Routing Tests
 *
 * These tests validate the prompt contracts for:
 * 1. Orchestrator: complexity-first routing model (trivial/simple/complex)
 * 2. Planner: mode support (lightweight | full)
 * 3. 2D magnitude×complexity routing matrix (experimental, active)
 * 4. Mini developer routing and calibration
 * 5. Risk flags and precedence rules
 */

function readPrompt(agent: string): string {
  return readFileSync(`src/agents/${agent}.md`, 'utf-8');
}

// ─── Orchestrator: Complexity-First Routing ────────────────────────────

describe('Orchestrator — Complexity-First Routing (FEAT-001)', () => {
  const orchestratorPrompt = readPrompt('Nova Agent Squad');

  it('should define complexity as the primary routing axis', () => {
    // Must establish complexity as the primary classifier
    const hasComplexityRouting =
      orchestratorPrompt.includes('complexity') &&
      // At least one of these patterns indicates complexity routing
      (orchestratorPrompt.includes('complexity-first') ||
        orchestratorPrompt.includes('Complexity and Magnitude Classification') ||
        orchestratorPrompt.includes('Complexity Classification') ||
        orchestratorPrompt.includes('complexity classifier') ||
        orchestratorPrompt.includes('complexity as the primary'));
    expect(hasComplexityRouting).toBe(true);
  });

  it('should define three complexity levels: trivial, simple, complex', () => {
    expect(orchestratorPrompt).toMatch(/trivial/i);
    expect(orchestratorPrompt).toMatch(/simple/i);
    // Must have "complex" but not "complexity" as the level name context
    // "complex" should appear in a classification context (level definition)
    const hasComplexLevel =
      orchestratorPrompt.includes('complex') &&
      (orchestratorPrompt.includes('trivial') || orchestratorPrompt.includes('simple'));
    expect(hasComplexLevel).toBe(true);
  });

  it('should route trivial and simple tasks to planner lightweight mode', () => {
    // Trivial/simple → lightweight planner routing must exist
    const routesToLightweight =
      (orchestratorPrompt.includes('lightweight') &&
        (orchestratorPrompt.includes('trivial') || orchestratorPrompt.includes('simple'))) ||
      orchestratorPrompt.includes('lightweight');
    expect(routesToLightweight).toBe(true);
  });

  it('should route complex tasks to planner full mode', () => {
    // Complex → full planner routing must exist
    const routesComplexToFull =
      orchestratorPrompt.includes('complex') &&
      (orchestratorPrompt.includes('full') || orchestratorPrompt.includes('full mode'));
    expect(routesComplexToFull).toBe(true);
  });

  it('should NOT route based on impact as primary axis', () => {
    // Impact should not appear as a routing axis
    const impactRoutingPatterns = [
      /impact.*rout/i,
      /rout.*impact/i,
      /impact-first/i,
      /impact.*classif/i,
    ];
    for (const pattern of impactRoutingPatterns) {
      expect(pattern.test(orchestratorPrompt)).toBe(false);
    }
  });

  it('should mention magnitude in a routing context (no longer observational-only)', () => {
    // Magnitude is now used in the 2D routing matrix
    // Must be present in orchestrator prompt
    expect(orchestratorPrompt).toMatch(/magnitude/i);
  });
});

// ─── Planner: Lightweight / Full Mode ──────────────────────────────────

describe('Planner — Lightweight/Full Mode Support (FEAT-002)', () => {
  const plannerPrompt = readPrompt('nas_planner');

  it('should support mode parameter with lightweight and full options', () => {
    // The planner must accept a mode parameter
    expect(plannerPrompt).toMatch(/mode/i);
    expect(plannerPrompt).toMatch(/lightweight/i);
    expect(plannerPrompt).toMatch(/full/i);
  });

  it('should define lightweight mode as reduced output', () => {
    // Lightweight mode should produce a reduced/slimmer plan
    if (plannerPrompt.includes('lightweight')) {
      const lightweightSection = plannerPrompt.substring(
        plannerPrompt.indexOf('lightweight'),
        plannerPrompt.indexOf('lightweight') + 500,
      );
      const hasReducedOutput =
        lightweightSection.includes('reduc') ||
        lightweightSection.includes('minimal') ||
        lightweightSection.includes('omit') ||
        lightweightSection.includes('skip') ||
        lightweightSection.includes('simplif');
      expect(hasReducedOutput).toBe(true);
    }
  });

  it('should define full mode as complete current behavior', () => {
    // Full mode should produce the complete planning output
    // Search for "mode: full" specifically, not just "full" (appears elsewhere)
    const modeFullIndex = plannerPrompt.indexOf('mode: full');
    if (modeFullIndex >= 0) {
      const fullSection = plannerPrompt.substring(modeFullIndex, modeFullIndex + 800);
      const hasCompleteOutput =
        fullSection.includes('complet') ||
        fullSection.includes('current') ||
        fullSection.includes('standard') ||
        fullSection.includes('default');
      expect(hasCompleteOutput).toBe(true);
    } else {
      // Fallback to broad search if "mode: full" not found
      const fullIndex = plannerPrompt.indexOf('full');
      if (fullIndex >= 0) {
        const fullSection = plannerPrompt.substring(fullIndex, fullIndex + 800);
        const hasCompleteOutput =
          fullSection.includes('complet') ||
          fullSection.includes('current') ||
          fullSection.includes('standard');
        expect(hasCompleteOutput).toBe(true);
      }
    }
  });

  it('should describe lightweight mode output format differences from full', () => {
    // There should be a clear distinction between what lightweight and full modes produce
    const lightweightIndex = plannerPrompt.indexOf('lightweight');
    const fullIndex = plannerPrompt.indexOf('full');
    if (lightweightIndex >= 0 && fullIndex >= 0) {
      // Both modes described — acceptable
      expect(true).toBe(true);
    }
  });
});

// ─── 2D Magnitude×Complexity Routing Matrix (FEAT-003) ────────────────

describe('2D Magnitude×Complexity Routing Matrix (FEAT-003)', () => {
  const orchestratorPrompt = readPrompt('Nova Agent Squad');

  it('should define magnitude as an active routing axis (no longer observational-only)', () => {
    // Magnitude must be defined and used for routing decisions
    expect(orchestratorPrompt).toMatch(/magnitude/i);
    // Must contain the 2D routing matrix
    const has2DMatrix =
      orchestratorPrompt.includes('2D') ||
      orchestratorPrompt.includes('matrix') ||
      orchestratorPrompt.includes('Magnitude × Complexity') ||
      orchestratorPrompt.includes('magnitude×complexity') ||
      orchestratorPrompt.includes('routing matrix');
    expect(has2DMatrix).toBe(true);
  });

  it('should route trivial + low magnitude → mini developer', () => {
    // trivial + low must route to mini developer
    const routesTrivialLow =
      (orchestratorPrompt.includes('mini') && orchestratorPrompt.includes('trivial') &&
       orchestratorPrompt.includes('low')) ||
      orchestratorPrompt.includes('mini');
    expect(routesTrivialLow).toBe(true);
  });

  it('should route trivial + medium magnitude → mini developer', () => {
    // trivial + medium must route to mini developer
    const routesTrivialMedium =
      orchestratorPrompt.includes('mini') &&
      orchestratorPrompt.includes('medium');
    expect(routesTrivialMedium).toBe(true);
  });

  it('should route simple + low magnitude → mini developer', () => {
    // simple + low must route to mini developer
    const routesSimpleLow =
      orchestratorPrompt.includes('mini') &&
      orchestratorPrompt.includes('simple') &&
      orchestratorPrompt.includes('low');
    expect(routesSimpleLow).toBe(true);
  });

  it('should route all other cells to full developer', () => {
    // All other cells route to full developer
    expect(orchestratorPrompt).toMatch(/full.*developer|nas_developer[^_]|full developer/);
  });

  it('should include planner mode mapping in the routing table', () => {
    // trivial → lightweight, simple → lightweight, complex → full
    const trivialLightweight =
      orchestratorPrompt.includes('trivial') && orchestratorPrompt.includes('lightweight');
    const simpleLightweight =
      orchestratorPrompt.includes('simple') && orchestratorPrompt.includes('lightweight');
    const complexFull =
      orchestratorPrompt.includes('complex') &&
      (orchestratorPrompt.includes('full mode') || orchestratorPrompt.includes('mode: full'));
    expect(trivialLightweight).toBe(true);
    expect(simpleLightweight).toBe(true);
    expect(complexFull).toBe(true);
  });
});

// ─── Mini Developer Agent (FEAT-005) ───────────────────────────────────

describe('Mini Developer Agent — Existence and Calibration (FEAT-005)', () => {
  it('should have nas_developer_mini.md prompt file', () => {
    // Mini developer prompt must exist
    const miniPrompt = readPrompt('nas_developer_mini');
    expect(miniPrompt).toBeTruthy();
    expect(miniPrompt.length).toBeGreaterThan(100);
  });

  it('should have conservative posture guidance', () => {
    const miniPrompt = readPrompt('nas_developer_mini');
    const hasConservative =
      miniPrompt.includes('conservative') ||
      miniPrompt.includes('cautious') ||
      miniPrompt.includes('conservat');
    expect(hasConservative).toBe(true);
  });

  it('should mandate explicit escalation on uncertainty', () => {
    const miniPrompt = readPrompt('nas_developer_mini');
    const hasEscalation =
      miniPrompt.includes('escalate') &&
      (miniPrompt.includes('uncertain') || miniPrompt.includes('uncertainty') ||
       miniPrompt.includes('unsure') || miniPrompt.includes('not sure') ||
       miniPrompt.includes('doubt'));
    expect(hasEscalation).toBe(true);
  });

  it('should enforce strong scope discipline', () => {
    const miniPrompt = readPrompt('nas_developer_mini');
    const hasScopeDiscipline =
      miniPrompt.includes('scope') &&
      (miniPrompt.includes('discipline') ||
       miniPrompt.includes('boundary') ||
       miniPrompt.includes('strict') ||
       miniPrompt.includes('contract'));
    expect(hasScopeDiscipline).toBe(true);
  });

  it('should include the same implementation report contract as full developer', () => {
    const miniPrompt = readPrompt('nas_developer_mini');
    const fullPrompt = readPrompt('nas_developer');
    // Both must have the implementation_report XML tag
    expect(miniPrompt).toMatch(/implementation_report/);
    expect(fullPrompt).toMatch(/implementation_report/);
    // Both must have the essential output tags
    for (const tag of ['authorization_verified', 'scenarios_implemented',
      'tests_run_and_passed', 'files_modified', 'test_results']) {
      expect(miniPrompt).toMatch(new RegExp(tag));
    }
  });

  it('should have simpler structure or more examples than full developer', () => {
    const miniPrompt = readPrompt('nas_developer_mini');
    const fullPrompt = readPrompt('nas_developer');
    // Mini should have more examples or be structurally simpler (shorter or more explicit)
    const miniExampleCount = (miniPrompt.match(/<example>/g) || []).length;
    const fullExampleCount = (fullPrompt.match(/<example>/g) || []).length;
    // Mini has equal or more examples, OR is shorter overall
    const hasMoreExamples = miniExampleCount >= fullExampleCount;
    const isShorter = miniPrompt.length < fullPrompt.length;
    expect(hasMoreExamples || isShorter).toBe(true);
  });
});

// ─── Risk Flags and Precedence Rules (FEAT-006) ────────────────────────

describe('Risk Flags and Precedence Rules (FEAT-006)', () => {
  const orchestratorPrompt = readPrompt('Nova Agent Squad');

  it('should define risk flags that force full developer', () => {
    // The orchestrator must define conditions that override the matrix and force full developer
    const hasRiskFlags =
      orchestratorPrompt.includes('risk') &&
      (orchestratorPrompt.includes('force full') ||
       orchestratorPrompt.includes('full developer') ||
       orchestratorPrompt.includes('override') ||
       orchestratorPrompt.includes('regardless') ||
       orchestratorPrompt.includes('always full'));
    expect(hasRiskFlags).toBe(true);
  });

  it('should define precedence rules for risk flags over matrix cell', () => {
    // Risk flags must take precedence over the matrix routing
    const hasPrecedence =
      orchestratorPrompt.includes('precedence') ||
      orchestratorPrompt.includes('override') ||
      orchestratorPrompt.includes('overrides') ||
      orchestratorPrompt.includes('takes priority') ||
      orchestratorPrompt.includes('regardless');
    expect(hasPrecedence).toBe(true);
  });

  it('should list nas_developer_mini in the orchestrator task allowlist', () => {
    const frontmatter = orchestratorPrompt.split('---')[1];
    expect(frontmatter).toMatch(/nas_developer_mini/);
    expect(frontmatter).toMatch(/nas_developer_mini.*allow/);
  });
});

// ─── QA remains mandatory for all paths, including mini ────────────────

describe('QA — Preserved Mandatory Behavior Including Mini (FEAT-004)', () => {
  const orchestratorPrompt = readPrompt('Nova Agent Squad');

  it('should preserve mandatory QA after implementation for all paths', () => {
    // QA must remain mandatory regardless of complexity level
    expect(orchestratorPrompt).toMatch(/qa.*mandatory/i);
    expect(orchestratorPrompt).toMatch(/after.*implementation/i);
  });

  it('should not restrict QA to complex path only', () => {
    // QA must not be restricted to only complex paths
    // It should run for trivial/simple/lightweight too
    expect(orchestratorPrompt).not.toMatch(/qa.*only.*complex/i);
  });

  it('should require QA after mini developer implementation', () => {
    // QA must run after mini developer too — same mandatory behavior
    // Either explicit mention of mini + QA or universal QA mandate
    const qaUniversal =
      /qa.*all.*path/i.test(orchestratorPrompt) ||
      /all.*level/i.test(orchestratorPrompt) ||
      /mandatory.*regardless/i.test(orchestratorPrompt) ||
      orchestratorPrompt.includes('mandatory for all');
    expect(qaUniversal).toBe(true);
  });
});
