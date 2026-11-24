import { defineCommand } from 'citty';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  classifyRetiredFiles,
  collectRemovalCandidates,
  readInstallInventory,
  removeVerifiedInventoryFiles,
  writeInstallInventory,
  type InstallInventory,
  type RemovalClassification,
  type PreservedReason,
} from '../lib/install-inventory';

const CANONICAL_AGENTS = [
  'Pulsar Agent Squad.md',
  'Pulsar Agent Turbo.md',
  'pas_researcher.md',
  'pas_developer.md',
  'pas_qa.md',
];

function preserveMessage(reason: PreservedReason): string {
  if (reason === 'missing') return 'Not found (skipped)';
  if (reason === 'modified') return 'Preserved (modified)';
  return 'Preserved (not a regular file)';
}

/**
 * Inventory-aware removal. The destination inventory is authoritative: only a
 * recorded file that is still a regular file with its recorded digest is
 * removed. Edited, symlinked, missing and unrecorded files are preserved. The
 * inventory keeps records for preserved files, and the marker itself always
 * remains (even with zero records), so a later run cannot fall back to the
 * wider pre-inventory behavior.
 */
function uninstallFromInventory(
  dest: string,
  inventory: InstallInventory,
  dryRun: boolean,
): void {
  const classification = classifyRetiredFiles(
    inventory,
    [],
    collectRemovalCandidates(
      dest,
      inventory.files.map((entry) => entry.name),
    ),
  );

  const latePreserved: RemovalClassification['preserved'] = [];

  for (const entry of classification.eligible) {
    const path = join(dest, entry.name);
    if (dryRun) {
      console.log(`DRY-RUN: rm '${path}'`);
      continue;
    }

    // Re-verify immediately before deleting: a file swapped for a symlink or
    // edited since classification is preserved instead of removed.
    const removal = removeVerifiedInventoryFiles(dest, [entry]);
    if (removal.removed.length > 0) {
      console.log(`✓ Removed: ${path}`);
      continue;
    }
    const reason = removal.preserved[0]?.reason ?? 'modified';
    latePreserved.push({ entry, reason });
    console.log(`${preserveMessage(reason)}: ${path}`);
  }

  for (const { entry, reason } of classification.preserved) {
    console.log(`${preserveMessage(reason)}: ${join(dest, entry.name)}`);
  }

  if (dryRun) return;

  const remaining = [
    ...classification.preserved,
    ...latePreserved,
  ]
    .filter((item) => item.reason !== 'missing')
    .map((item) => item.entry);

  // Always keep a valid marker, even when no records remain: the destination
  // stays managed, so a later uninstall never falls back to canonical names.
  writeInstallInventory(dest, remaining);
}

function uninstall(
  dest: string,
  pluginsDest: string,
  dryRun: boolean,
): void {
  // Validate the destination inventory before any deletion. A malformed
  // inventory fails closed and authorizes nothing.
  const inventory = readInstallInventory(dest);

  console.log('Uninstalling Pulsar Agent Squad agents...');

  if (inventory) {
    uninstallFromInventory(dest, inventory, dryRun);
  } else {
    // Pre-inventory fallback: preserve the existing canonical behavior
    // exactly. It is not widened to any other file.
    for (const agent of CANONICAL_AGENTS) {
      const filePath = join(dest, agent);
      if (dryRun) {
        console.log(`DRY-RUN: rm '${filePath}'`);
      } else if (existsSync(filePath)) {
        rmSync(filePath);
        console.log(`✓ Removed: ${filePath}`);
      } else {
        console.log(`Not found (skipped): ${filePath}`);
      }
    }
  }

  // Remove only the installed pas_toolkit plugin FILE. The `plugins/`
  // container directory may hold unrelated plugins, so it is never removed.
  const pluginPath = join(pluginsDest, 'pas-toolkit.ts');
  if (dryRun) {
    console.log(`DRY-RUN: rm '${pluginPath}'`);
  } else if (existsSync(pluginPath)) {
    rmSync(pluginPath);
    console.log(`✓ Removed: ${pluginPath}`);
  } else {
    console.log(`Not found (skipped): ${pluginPath}`);
  }

  if (!dryRun) {
    console.log('');
    console.log('Note: This removes the PAS agent files and the pas_toolkit plugin.');
    console.log('To reset default_agent, edit ~/.config/opencode/opencode.json');
  }
}

export const uninstallCommand = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Remove PAS agent files and the pas_toolkit plugin from their target directories',
  },
  args: {
    'dry-run': {
      type: 'boolean',
      description: 'Show what would be removed without deleting',
    },
    dest: {
      type: 'string',
      description: 'Target directory (default: ~/.config/opencode/agents)',
    },
    'plugins-dest': {
      type: 'string',
      description: 'Plugins directory containing pas-toolkit.ts (default: ~/.config/opencode/plugins)',
    },
  },
  async run({ args }) {
    const dryRun = (args['dry-run'] as boolean) || false;
    const home = process.env.HOME || process.env.USERPROFILE || '~';
    const dest = (args.dest as string) || join(home, '.config', 'opencode', 'agents');
    const pluginsDest = (args['plugins-dest'] as string) || join(home, '.config', 'opencode', 'plugins');

    try {
      uninstall(dest, pluginsDest, dryRun);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`ERROR: ${message}`);
      process.exit(1);
    }
  },
});
