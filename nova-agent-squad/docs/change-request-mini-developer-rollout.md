# Change Request: Mini Developer Experimental Rollout

**Status**: EXPERIMENTAL — authorized for trial deployment
**Date**: 2026-06-29
**Version**: 1.2.0-mini-experimental

## Summary

Introduce an experimental `nas_developer_mini` agent calibrated for smaller models with conservative behavior, and upgrade the orchestrator routing from complexity-only to a 2D magnitude×complexity matrix. The mini developer handles low-risk cells in the matrix while full developer handles everything else. Risk flags and precedence rules force full developer when conditions warrant.

## Motivation

The NAS evolution analysis (nas-evolution-recommendations-final-20260628) identified developer model downgrade as a pilot candidate. Evidence from planner assessment showed that simpler model-driven implementations can succeed with proper calibration. This experimental rollout activates the pilot in a controlled manner:

- Mini developer only handles the top-left L cells of the 2D matrix (trivial/low, trivial/medium, simple/low).
- Full developer remains the default for all other cells.
- Risk flags always escalate to full developer regardless of matrix cell.
- QA remains mandatory for all paths — mini developer paths are not exempt.

## Scope

### In Scope

1. New `nas_developer_mini` agent prompt at `src/agents/nas_developer_mini.md`
2. Orchestrator 2D magnitude×complexity routing matrix in `src/agents/Nova Agent Squad.md`
3. Planner mode mapping in the routing table (trivial→lightweight, simple→lightweight, complex→full)
4. Risk flags and precedence rules that force full developer
5. Orchestrator task allowlist updated to include `nas_developer_mini`
6. Updated contract tests in `tests/unit/complexity-routing.test.ts`
7. CHANGELOG entry
8. This change request document

### Out of Scope

- No mini planner, mini QA, or mini researcher
- No runtime model selection overhaul
- No changes to researcher behavior or permissions
- No changes to QA agent — it validates all paths identically
- No changes to the planner agent — it supports modes (lightweight/full) which are already implemented

## Design

### 2D Magnitude×Complexity Routing Matrix

```
              ┌─────────────────────────────────────────┐
              │           COMPLEXITY                    │
              │  trivial     simple       complex       │
   ┌──────────┼─────────────────────────────────────────┤
   │  low     │   MINI        MINI        FULL          │
 M │          │   (L)         (L)         (F)           │
 A ├──────────┼─────────────────────────────────────────┤
 G │  medium  │   MINI        FULL        FULL          │
 N │          │   (L)         (F)         (F)           │
 I ├──────────┼─────────────────────────────────────────┤
 T │  high    │   FULL        FULL        FULL          │
 U │          │   (F)         (F)         (F)           │
 D └──────────┴─────────────────────────────────────────┘
 E

 (L) = lightweight planner mode
 (F) = full planner mode
```

**Top-left L cells route to mini developer:**
- trivial + low → mini
- trivial + medium → mini
- simple + low → mini

**All other cells route to full developer.**

**Planner mode mapping:**
- trivial → lightweight
- simple → lightweight
- complex → full

### Magnitude Classification

| Magnitude | Criteria |
|-----------|----------|
| **low** | 1-2 files, <20 lines changed, no new files, isolated area |
| **medium** | 2-5 files, 20-100 lines, may create 1-2 new files |
| **high** | 5+ files, 100+ lines, new files/modules, architectural |

### Risk Flags (Force Full Developer)

The following conditions force full developer regardless of matrix cell:

1. **Authorization gate change**: Task modifies permissions, authorization rules, or contract enforcement.
2. **Security/policy**: Task touches authentication, data handling, or security-sensitive code.
3. **Inter-agent communication**: Task changes orchestration, handoff, delegation, or agent interaction contracts.
4. **Architectural change**: Task adds new agent roles, changes the workflow pipeline, or restructures the system.
5. **User explicitly requests full developer**.
6. **Ambiguous complexity**: When complexity classification is uncertain (default to complex → full).

### Precedence Rules

1. Risk flags always override the matrix cell routing.
2. If any risk flag is true → force full developer.
3. User override always takes highest precedence — if user requests full developer, use full.
4. Uncertainty defaults to full developer (safe default).
5. When mini developer is chosen, QA still runs identically after implementation.

### Mini Developer Calibration

The mini developer prompt is calibrated for smaller models:

- **Conservative posture**: Err on the side of escalation rather than assumption.
- **Explicit escalation**: On any uncertainty, return BLOCKED/DO_NOT_CONTINUE with a clear question.
- **Strong scope discipline**: Never expand scope without explicit re-authorization.
- **Same output contract**: Identical `<implementation_report>` format so QA can validate uniformly.
- **Simpler structure**: Shorter prompt with more concrete examples to compensate for reduced reasoning capacity.

### Constraints (Unchanged)

- Researcher stays unchanged; no downgrade.
- QA stays unchanged and mandatory for all paths.
- No mini planner / mini QA / mini researcher.
- No runtime model selection overhaul beyond prompt/config/doc scaffolding.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Mini developer makes scope errors | Medium | Medium | Conservative posture + explicit escalation + mandatory QA |
| Small model hallucinates compliance | Low | High | Same output contract validated by QA; risk flags catch sensitive tasks |
| Routing matrix incorrectly classifies tasks | Low | Medium | Risk flags + user override + uncertainty defaults to full |
| Performance degradation on mini paths | Low | Low | Mini is only for top-left L cells; lightweight planner reduces overhead |

## Rollout Plan

1. Deploy `nas_developer_mini.md` prompt
2. Update orchestrator with 2D matrix + risk flags
3. Update tests to validate routing
4. Monitor 10-15 sessions for:
   - Mini developer QA pass rate
   - Scope creep incidents
   - Escalation frequency
   - User satisfaction with mini path speed vs quality
5. After calibration period, decide: PROMOTE (expand matrix cells), MAINTAIN (keep current), or ROLLBACK (remove mini)

## References

- nas-evolution-recommendations-final-20260628 — pilot recommendation
- nas-vnext-phase1-complexity-routing-20260628 — Phase 1 routing architecture
- empirical-planner-assessment-synthesis-2026-06-28 — evidence for simpler model calibration
