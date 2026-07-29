/**
 * Interactive `nas skills setup` wizard.
 *
 * Flow (per 2026-06-30 bugfix — broad scope means "all NAS agents",
 * not top-level `permission.skill`):
 *   1. Pick action (Add | Remove | Clear | Cancel)
 *   2a. (Add | Remove) pick scope — "All NAS agents" or "One specific
 *       agent" (only one scope question; no duplicate prompt)
 *   2b. (Clear)       confirm "clear all NAS agent policies"
 *   3a. (Add)   pick / type a pattern, pick action, confirm, apply
 *   3b. (Remove) pick a pattern from the live view, confirm, apply
 *
 * After each successful add / remove / clear, the wizard loops back
 * to the main menu so the user can run another action in the same
 * session. Escape at the main menu exits cleanly; Escape at any inner
 * step goes back exactly one step in the navigation flow.
 *
 * Uses @inquirer/prompts for interactive select/search/confirm
 * prompts. Each prompt receives `signal` (wired to the Escape
 * keypress via `prompt-escape.ts`) and `clearPromptOnDone: true` so
 * the terminal cleans up residual prompt content between prompts.
 *
 * Pure wizard logic (loop, escape, one-step-back) lives in
 * `./setup-core`. This file is the thin I/O shell: it wires the real
 * prompts, real config helpers, and console output to the pure
 * wizard core.
 */

import { defineCommand } from 'citty';
import search from '@inquirer/search';
import select from '@inquirer/select';
import confirm from '@inquirer/confirm';
import {
  readConfig,
  createBackup,
  writeConfig,
} from '../../lib/config-safety';
import {
  readSkillPolicies,
  addSkillPolicy,
  removeSkillPolicy,
  clearSkillPolicies,
  isValidAction,
  type PermissionAction,
  type SkillRule,
  type WriteScope,
} from '../../lib/skill-policies';
import { listAvailableSkills } from '../../lib/skill-discovery';
import { NAS_AGENTS } from '../agents/presenter';
import {
  runSkillsSetupWizard,
  isAbortPromptError,
  type SkillsAction,
  type SkillsPrompts,
} from './setup-core';
import { createEscapeController } from '../../lib/prompt-escape';

function fail(message: string, code = 1): never {
  console.error('Error:', message);
  process.exit(code);
}

/**
 * Format the human-readable scope line used by the Add / Remove
 * confirmation prompts. Mirrors the wording used by the original
 * inline setup wizard so the user experience stays identical.
 */
function describeScope(scope: WriteScope, agentName?: string): string {
  if (scope === 'agent') return `one specific agent${agentName ? ` (${agentName})` : ''}`;
  return 'all NAS agents';
}

/**
 * Build the canonical NAS agent order. Used by the pure wizard for
 * stable `scope=all-nas` rule merging across the per-agent blocks.
 */
function getNasAgentOrder(): readonly string[] {
  return NAS_AGENTS;
}

/**
 * Union of every NAS agent's per-agent rules, in stable NAS_AGENTS
 * order. Used by the Remove wizard at `scope=all-nas` so the user
 * sees one row per pattern (the same pattern may live on multiple
 * agents).
 */
function mergeNasAgentRules(perAgent: Record<string, SkillRule[]>): SkillRule[] {
  const order = getNasAgentOrder();
  const seen = new Set<string>();
  const out: SkillRule[] = [];
  for (const name of order) {
    for (const r of perAgent[name] ?? []) {
      if (seen.has(r.pattern)) continue;
      seen.add(r.pattern);
      out.push(r);
    }
  }
  return out;
}

export default defineCommand({
  meta: {
    name: 'setup',
    description: 'Interactively configure `permission.skill` rules for NAS agents',
  },
  async run() {
    try {
      // Read config first to detect malformed JSON before any interaction.
      const config = readConfig();
      const view = readSkillPolicies(config);

      await runSkillsSetupWizard({
        initialConfig: config,
        initialView: view,
        prompts: {
          // 1. Main menu: Add | Remove | Clear | Cancel
          chooseAction: async (signal) =>
            select<SkillsAction>(
              {
                message: 'What do you want to do?',
                choices: [
                  { value: 'add', name: 'Add a rule', description: 'Append a pattern → action mapping' },
                  { value: 'remove', name: 'Remove a rule', description: 'Delete an existing pattern' },
                  { value: 'clear', name: 'Clear', description: 'Drop all NAS agent skill policies' },
                  { value: 'cancel', name: 'Cancel', description: 'Exit without changes' },
                ],
              },
              { signal, clearPromptOnDone: true },
            ),

          // 2. Scope (Add/Remove): all-nas vs one specific agent
          chooseScope: async (signal) =>
            select<WriteScope>(
              {
                message: 'Scope?',
                choices: [
                  {
                    value: 'all-nas',
                    name: 'All NAS agents',
                    description: 'Fan out the rule to every canonical NAS agent',
                  },
                  {
                    value: 'agent',
                    name: 'One specific agent',
                    description: 'Apply the rule to a single NAS agent',
                  },
                ],
              },
              { signal, clearPromptOnDone: true },
            ),

          // 3. Agent pick (only when scope=agent)
          chooseAgent: async (signal) =>
            select<string>(
              {
                message: 'Which agent?',
                choices: NAS_AGENTS.map((name) => ({ value: name, name })),
              },
              { signal, clearPromptOnDone: true },
            ),

          // 4. Add: pick/type pattern
          searchAddPattern: async (suggestions, signal) =>
            search<string>(
              {
                message: 'Pattern (native OpenCode wildcard, e.g. `docs-*`, `*`, `git?`)',
                source: (term: string | undefined) => {
                  const filtered = term
                    ? suggestions.filter((s) => s.toLowerCase().includes(term.toLowerCase()))
                    : suggestions;
                  const out = filtered.map((value) => ({ value, name: value }));
                  if (term && !filtered.includes(term)) {
                    out.unshift({ value: term, name: `${term}  (new)` });
                  }
                  return out;
                },
              },
              { signal, clearPromptOnDone: true },
            ),

          // 5. Add: pick action (allow / deny / ask)
          chooseRuleAction: async (signal) => {
            const picked = await select<PermissionAction>(
              {
                message: 'Action?',
                choices: [
                  { value: 'allow', name: 'allow' },
                  { value: 'deny', name: 'deny' },
                  { value: 'ask', name: 'ask' },
                ],
              },
              { signal, clearPromptOnDone: true },
            );
            if (!isValidAction(picked)) fail(`Invalid action: ${picked}`);
            return picked;
          },

          // 6. Add: confirm apply
          confirmAdd: async (preview, signal) =>
            confirm(
              {
                message: `Apply this change?\n\n${preview}`,
                default: true,
              },
              { signal, clearPromptOnDone: true },
            ),

          // 7. Remove: pick from existing rules
          searchRemovePattern: async (rules, signal) =>
            search<string>(
              {
                message: 'Which pattern?',
                source: () =>
                  rules.map((r) => ({ value: r.pattern, name: `${r.pattern} (${r.action})` })),
              },
              { signal, clearPromptOnDone: true },
            ),

          // 8. Remove: confirm apply
          confirmRemove: async (preview, signal) =>
            confirm(
              {
                message: `Remove this rule?\n\n${preview}`,
                default: true,
              },
              { signal, clearPromptOnDone: true },
            ),

          // 9. Clear: confirm apply
          confirmClear: async (signal) =>
            confirm(
              {
                message: 'Clear all NAS agent skill policies?',
                default: false,
              },
              { signal, clearPromptOnDone: true },
            ),
        } satisfies SkillsPrompts,

        discoverSkills: () => {
          try {
            return listAvailableSkills();
          } catch {
            // Discovery is best-effort in the wizard; fall through with [].
            return [];
          }
        },

        addSkillPolicy,
        removeSkillPolicy,
        clearSkillPolicies,

        createBackup,
        writeConfig,
        output: (line) => console.log(line),
        isAbortPromptError,

        // Main menu Escape exits cleanly with no error log, no error
        // exit code.
        onEscapeExit: () => {},

        // Wire the Escape key to per-prompt AbortSignals so the wizard
        // can react to Escape at any step (outer → exit, inner → back).
        createPromptSignal: () => {
          const esc = createEscapeController();
          return { signal: esc.signal, dispose: () => esc.dispose() };
        },
      });

      // Wizard returned: clean exit. The pure wizard already handled
      // the loop / escape / apply work; no further I/O needed here.
      return;
    } catch (err) {
      // Outer escape is handled inside runSkillsSetupWizard; anything
      // reaching here is a genuine failure (malformed config, file
      // I/O error, unhandled exception in a prompt). Preserve existing
      // error semantics for those.
      fail(err instanceof Error ? err.message : String(err));
    }
  },
});

// Re-export for downstream consumers (tests, presenters, docs).
export { mergeNasAgentRules, describeScope, getNasAgentOrder, fail };
