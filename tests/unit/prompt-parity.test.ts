/**
 * No-loss oracle for the `pas_engineer` prompt (T5).
 *
 * The engineer is a port of `pas_developer`, not a rewrite. These tests pin the
 * normative rules that must survive the port, the negative pins that stop the
 * merge from smuggling in capabilities or keeping rules that moved to the peer,
 * and the structural shape of the output contract.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

const prompt = readFileSync('src/agents/pas_engineer.md', 'utf-8');
const normalized = prompt.replace(/\s+/g, ' ').trim();
const frontmatter = prompt.split('---')[1] ?? '';

/** Rules carried over verbatim from `pas_developer` (whitespace-normalised). */
const PARITY_PINS = [
  'one approved atomic task',
  'CONSERVATIVE POSTURE',
  'When in doubt, escalate instead of guessing',
  'Before any edit, run this checklist',
  'Report degraded memory',
  'critical assigned skill is missing',
  'Do not combine neighboring tasks',
  'Red -> Green -> Refactor',
  "Never edit the Lead's plan",
  'create a strong-worker fallback',
  'cheapest sufficient level',
  'clearly pyramidal',
  'not a fixed ratio',
  'escalate (`test_strategy`) instead of',
  '`@manual` scenarios are not automated',
  'Do not delegate.',
  'Verify authorization metadata before every edit',
  'Use read-only memory operations',
  'Batch independent, side-effect-free calls in one turn',
  'Keep ordered work strictly sequential',
  'Fix lint and format failures in files modified by this task',
];

/** The 18 top-level elements of `<implementation_report>`, in order. */
const REPORT_ELEMENTS = [
  'authorization_check',
  'verdict',
  'units',
  'tdd_phases',
  'scenario_results',
  'skills_applied',
  'test_coverage_explanation',
  'test_strategy_review',
  'test_files_created_modified',
  'scoped_tests_run',
  'full_suite_status',
  'files_changed',
  'docs_updated',
  'escalation',
  'scope_pressure_or_blockers',
  'known_limitations',
  'recommendation',
  'memory_writes',
];

describe('pas_engineer prompt parity', () => {
  it('keeps every normative developer rule (no rule lost)', () => {
    for (const pin of PARITY_PINS) {
      expect(normalized).toContain(pin.replace(/\s+/g, ' '));
    }
  });

  it('does not inherit the copilot licence to run bash concurrently', () => {
    expect(prompt).not.toMatch(/concurrent\s+`?bash`?\s+calls/);
    expect(prompt).toContain('Never run `bash` concurrently');
  });

  it('does not keep the full-suite rule that moved to the peer', () => {
    expect(prompt).not.toContain(
      'Before reporting `PASS`, run the full project test suite',
    );
    expect(prompt).toContain('DEFERRED_TO_PEER');
    expect(prompt).toContain('Do not run the full project test suite');
  });
});

describe('pas_engineer frontmatter', () => {
  it('uses the raised step budget and denies delegation', () => {
    expect(frontmatter).toContain('steps: 120');
    expect(frontmatter).toContain('task: deny');
  });

  it('denies editing the Lead-owned plan and Gherkin files', () => {
    expect(frontmatter).toContain('".pas/**": deny');
    expect(frontmatter).toContain('"specs/*.feature": deny');
    expect(frontmatter).toContain('"specs/**/*.feature": deny');
  });
});

describe('pas_engineer report contract', () => {
  it('uses <verdict> and not the old <task_status>', () => {
    expect(prompt).toContain('<verdict>');
    expect(prompt).toContain('<implementation_report>');
    expect(prompt).not.toContain('<task_status>');
  });

  it('declares all 18 top-level report elements', () => {
    for (const element of REPORT_ELEMENTS) {
      expect(prompt).toContain(`<${element}>`);
    }
  });
});

/**
 * No-loss oracle for the `pas_copilot` prompt (T6).
 *
 * The copilot is a port of `pas_qa`, not a rewrite. These pins hold the QA
 * rules that must survive the peer role, the new review layers, and the
 * structural shape of the audit report.
 */
const copilotPrompt = readFileSync('src/agents/pas_copilot.md', 'utf-8');
const copilotNormalized = copilotPrompt.replace(/\s+/g, ' ').trim();
const copilotFrontmatter = copilotPrompt.split('---')[1] ?? '';

const COPILOT_PARITY_PINS = [
  'lightweight, read-only quality verifier',
  'You never fix or edit anything',
  'Run independent checks concurrently',
  'share mutable state in sequence',
  "Use the formatter's read-only validation mode",
  '`BLOCKED` with the exact command',
  '`PASS` from a model claim',
  'Verify authorization metadata and exact scope against the actual diff',
  'every scenario has a test',
  'non-trivial functions are covered',
  'happy and error paths are covered',
  'portfolio remains clearly pyramidal',
  'record a WARNING and recommend one',
  'Do not trust a claimed result',
  'Return exactly one overall verdict',
  "Verify each scenario's tests against its class tag",
  'unjustified expensive choice as `test_strategy` failure',
  'Do not enforce a fixed numerical ratio',
  'Use no workaround when a required validation tool is denied',
  'Never author or modify `.feature` files',
  '<portfolio_shape>',
  'contract_violation',
  'run the full project test suite',
];

/** The 24 top-level elements of `<audit_report>`, in order. */
const AUDIT_ELEMENTS = [
  'verdict',
  'fail_category',
  'authorization_check',
  'units_audited',
  'full_suite_audit',
  'scenario_results',
  'scope_compliance',
  'evidence',
  'gherkin_alignment',
  'test_sufficiency',
  'test_strategy_review',
  'code_review',
  'cruft_review',
  'skill_compliance',
  'linter_check',
  'ui_ux_review',
  'specs_drift',
  'quality_gates',
  'contract_test_evaluation',
  'issues',
  'discrepancies',
  'escalation',
  'recommendation',
  'memory_writes',
];

/** The eight shared fields, same names and vocabulary as the engineer. */
const COMPARABLE_ELEMENTS = [
  'authorization_check',
  'files_changed',
  'scenario_results',
  'full_suite_status',
  'skills_applied',
  'docs_updated',
  'escalation',
  'verdict',
];

/**
 * The full parity-pin inventory, declared as data. These totals are the
 * contract: deleting a pin from any list, or forgetting to declare a pin,
 * changes the count and fails this oracle.
 */
const PIN_INVENTORY = {
  engineer: { pins: PARITY_PINS, total: 21 },
  copilot: { pins: COPILOT_PARITY_PINS, total: 23 },
  shared: { pins: COMPARABLE_ELEMENTS, total: 8 },
} as const;

describe('parity pin inventory', () => {
  it('Every legacy rule has a destination: each pin is present and the inventory is complete', () => {
    const engineer = PIN_INVENTORY.engineer;
    const copilot = PIN_INVENTORY.copilot;
    const shared = PIN_INVENTORY.shared;

    // The declared totals catch a pin silently dropped from a list.
    expect(engineer.pins).toHaveLength(engineer.total);
    expect(copilot.pins).toHaveLength(copilot.total);
    expect(shared.pins).toHaveLength(shared.total);

    // Every engineer pin lives in the engineer prompt.
    for (const pin of engineer.pins) {
      expect(normalized).toContain(pin.replace(/\s+/g, ' '));
    }

    // Every copilot pin lives in the copilot prompt.
    for (const pin of copilot.pins) {
      expect(copilotNormalized).toContain(pin.replace(/\s+/g, ' '));
    }

    // Every shared-field pin lives in both target prompts.
    for (const field of shared.pins) {
      expect(prompt).toContain(`<${field}>`);
      expect(copilotPrompt).toContain(`<${field}>`);
    }

    // No pin is declared twice across the whole inventory, and the union
    // matches the sum of the declared totals.
    const union = [...engineer.pins, ...copilot.pins, ...shared.pins];
    expect(new Set(union).size).toBe(union.length);
    expect(union).toHaveLength(engineer.total + copilot.total + shared.total);
  });
});

describe('pas_copilot prompt parity', () => {
  it('keeps every normative QA rule (no rule lost)', () => {
    for (const pin of COPILOT_PARITY_PINS) {
      expect(copilotNormalized).toContain(pin.replace(/\s+/g, ' '));
    }
  });

  it('audits each unit and the full suite before the ack', () => {
    expect(copilotPrompt).toContain('A unit is one acceptance scenario');
    expect(copilotPrompt).toContain('before the ack');
    expect(copilotPrompt).toContain('pas_room_reconcile');
  });

  it('reviews the changed code and the no-cruft rule instead of trusting the report', () => {
    expect(copilotPrompt).toContain('Review the code that was written');
    expect(copilotPrompt).toContain('is a claim, not evidence');
    expect(copilotPrompt).toContain('a line that can be deleted without losing behaviour');
    expect(copilotPrompt).toContain('Speculative abstractions');
  });

  it('judges UI/UX across web, TUI and CLI and reports missing guidance', () => {
    expect(copilotPrompt).toContain("Discover the project's guidelines");
    expect(copilotPrompt).toContain('consistency for web');
    expect(copilotPrompt).toContain('layout, keybindings, and feedback for TUI');
    expect(copilotNormalized).toContain(
      'help, flags, exit codes, error messages, and discoverability for CLI',
    );
    expect(copilotPrompt).toContain('report that as a finding');
    expect(copilotPrompt).toContain('never invent criteria');
  });
});

describe('pas_copilot frontmatter', () => {
  it('is read-only, allows bash, denies delegation, and uses the raised budget', () => {
    expect(copilotFrontmatter).toContain('steps: 100');
    expect(copilotFrontmatter).toContain('edit: deny');
    expect(copilotFrontmatter).toContain('write: deny');
    expect(copilotFrontmatter).toContain('task: deny');
    expect(copilotFrontmatter).toContain('bash: allow');
  });

  it('does not smuggle a write allowance for edit', () => {
    expect(copilotPrompt).not.toContain('edit: "*": allow');
    expect(copilotFrontmatter).not.toMatch(/edit:\s*\n\s+"\*":\s*allow/);
  });
});

describe('pas_copilot report contract', () => {
  it('uses <audit_report> with a single <verdict>', () => {
    expect(copilotPrompt).toContain('<audit_report>');
    expect(copilotPrompt).toContain('<verdict>PASS | FAIL | BLOCKED</verdict>');
  });

  it('declares all 24 top-level report elements', () => {
    for (const element of AUDIT_ELEMENTS) {
      expect(copilotPrompt).toContain(`<${element}>`);
    }
  });

  it('declares the eight comparable fields in both reports', () => {
    for (const element of COMPARABLE_ELEMENTS) {
      expect(prompt).toContain(`<${element}>`);
      expect(copilotPrompt).toContain(`<${element}>`);
    }
  });

  it('carries lint and format evidence with its command and exit code', () => {
    expect(copilotPrompt).toContain('<command>');
    expect(copilotPrompt).toContain('<exit_code>');
    expect(copilotPrompt).toContain('<output>');
    expect(copilotNormalized).toContain(
      'without its command and exit code is not evidence',
    );
  });

  it('flags weak or grep-only contract tests', () => {
    expect(copilotPrompt).toContain('<contract_test_evaluation>');
    expect(copilotPrompt).toContain('weak or grep-only');
    expect(copilotPrompt).toContain('is not a contract test');
  });

  it('names the three escalation actions', () => {
    expect(copilotPrompt).toContain('re_delegate');
    expect(copilotPrompt).toContain('fix_brief');
    expect(copilotPrompt).toContain('escalate_to_user');
  });
});

/**
 * Machine-checkable oracle for the canonical rule-migration ledger.
 *
 * The ledger is the one-time claim that none of the 117 normative rules of the
 * retired `pas_developer` and `pas_qa` prompts was lost. This block parses it so
 * that dropping a row, duplicating an id, or editing the summary table by hand
 * cannot stay green. It is an integration-level check of the real tracked file,
 * not a copy of it.
 */

const LEDGER_PATH = '.pas/rule-migration-ledger.md';

/** The only destinations a row may declare. */
const DESTINATIONS = [
  'engineer',
  'copilot',
  'protocol',
  'lead',
  'retired',
] as const;

type Destination = (typeof DESTINATIONS)[number];

interface LedgerRow {
  id: string;
  kind: 'D' | 'Q';
  /** First token of the destination cell, with Markdown emphasis removed. */
  destination: string;
  /** The raw destination cell, for diagnostics. */
  rawDestination: string;
}

interface CountRow {
  destination: string;
  developer: number;
  qa: number;
  total: number;
}

/** Read the canonical ledger, failing with a message that names the path. */
function readLedger(): string {
  try {
    return readFileSync(LEDGER_PATH, 'utf-8');
  } catch {
    throw new Error(
      `Canonical rule-migration ledger not found at ${LEDGER_PATH}. ` +
        'It is tracked; restore it before running this oracle.',
    );
  }
}

/** Expected ids, built programmatically so off-by-one drift is caught. */
function expectedIds(prefix: 'D' | 'Q', count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`,
  );
}

const EXPECTED_IDS = [...expectedIds('D', 61), ...expectedIds('Q', 56)];

/**
 * Split a Markdown table line into trimmed cells, excluding the empty edges.
 * Escaped pipes (`\|`) belong to a cell, not the table structure.
 */
function tableCells(line: string): string[] {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/** Parse the `| id | rule | destination |` rows of the ledger. */
function parseLedgerRows(text: string): LedgerRow[] {
  const rows: LedgerRow[] = [];

  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;

    const cells = tableCells(line);
    const match = /^([DQ])(\d{2})$/.exec(cells[0] ?? '');
    if (!match) continue;

    const rawDestination = cells[2] ?? '';
    const destination = rawDestination
      .replace(/[*`]/g, '')
      .trim()
      .split(/\s+/)[0] ?? '';

    rows.push({
      id: match[0],
      kind: match[1] as 'D' | 'Q',
      destination,
      rawDestination,
    });
  }

  return rows;
}

/** The body of one `## ` section, up to the next `## ` heading. */
function sectionAfter(text: string, heading: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(`Ledger is missing the "${heading}" section.`);
  }

  const nextHeading = lines.findIndex(
    (line, index) => index > start && /^##\s/.test(line),
  );

  return lines
    .slice(start + 1, nextHeading === -1 ? undefined : nextHeading)
    .join('\n');
}

/** Parse the `## Count` table. */
function parseCountTable(text: string): {
  rows: CountRow[];
  grandTotal: number;
} {
  const rows: CountRow[] = [];
  let grandTotal = 0;

  for (const line of sectionAfter(text, '## Count').split('\n')) {
    if (!line.trim().startsWith('|')) continue;

    const cells = tableCells(line);
    const label = (cells[0] ?? '').replace(/[*`]/g, '').trim();
    if (!label || label === 'destination' || /^-+$/.test(label)) continue;

    const developer = Number((cells[1] ?? '').replace(/[*`]/g, ''));
    const qa = Number((cells[2] ?? '').replace(/[*`]/g, ''));
    const total = Number((cells[3] ?? '').replace(/[*`]/g, ''));

    if (label === 'total') {
      grandTotal = total;
      continue;
    }

    rows.push({ destination: label, developer, qa, total });
  }

  return { rows, grandTotal };
}

/** Actual row counts per destination, split by source prompt. */
function countRowsByDestination(
  rows: LedgerRow[],
): Map<string, { developer: number; qa: number; total: number }> {
  const counts = new Map<string, { developer: number; qa: number; total: number }>();
  for (const destination of DESTINATIONS) {
    counts.set(destination, { developer: 0, qa: 0, total: 0 });
  }

  for (const row of rows) {
    const count = counts.get(row.destination);
    if (!count) continue;
    count.total += 1;
    if (row.kind === 'D') count.developer += 1;
    else count.qa += 1;
  }

  return counts;
}

describe('every legacy rule has a destination', () => {
  let ledger = '';

  beforeAll(() => {
    ledger = readLedger();
  });

  it('accounts for each D and Q id exactly once', () => {
    const rows = parseLedgerRows(ledger);
    const idCounts = new Map<string, number>();
    for (const row of rows) {
      idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);
    }

    const expected = new Set(EXPECTED_IDS);
    const missing = EXPECTED_IDS.filter((id) => !idCounts.has(id));
    const duplicated = [...idCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id);
    const unexpected = [...idCounts.keys()].filter((id) => !expected.has(id));

    expect({ missing, duplicated, unexpected }).toEqual({
      missing: [],
      duplicated: [],
      unexpected: [],
    });
  });

  it('maps every row to exactly one known destination', () => {
    const rows = parseLedgerRows(ledger);
    const unknown = rows
      .filter(
        (row) => !DESTINATIONS.includes(row.destination as Destination),
      )
      .map((row) => `${row.id} → ${row.destination || '<empty>'}`);

    expect(unknown).toEqual([]);
  });

  it('retires nothing and transfers only D50 to the copilot', () => {
    const rows = parseLedgerRows(ledger);

    expect(rows.filter((row) => row.destination === 'retired')).toEqual([]);

    // `protocol` is not a transfer to another agent: D20 and D41 live in the
    // room code as the red-before-green and scope gates. Every other developer
    // rule must stay with the engineer; D50 is the sole peer transfer.
    const developerDestinationByRule = new Map(
      rows
        .filter((row) => row.kind === 'D')
        .map((row) => [row.id, row.destination]),
    );

    const transferredDeveloperRules = [...developerDestinationByRule.entries()]
      .filter(([, destination]) => destination !== 'engineer')
      .map(([id, destination]) => `${id}:${destination}`);

    expect(transferredDeveloperRules).toEqual([
      'D20:protocol',
      'D41:protocol',
      'D50:copilot',
    ]);

    const peerTransfers = [...developerDestinationByRule.entries()]
      .filter(([, destination]) => destination === 'copilot' || destination === 'lead')
      .map(([id, destination]) => `${id}:${destination}`);

    expect(peerTransfers).toEqual(['D50:copilot']);
  });

  it('agrees with the count table rather than hardcoded totals', () => {
    const rows = parseLedgerRows(ledger);
    const counts = countRowsByDestination(rows);
    const table = parseCountTable(ledger);

    expect(table.rows.map((row) => row.destination).sort()).toEqual(
      [...DESTINATIONS].sort(),
    );

    for (const row of table.rows) {
      expect({
        destination: row.destination,
        developer: row.developer,
        qa: row.qa,
        total: row.total,
      }).toEqual({ destination: row.destination, ...counts.get(row.destination)! });
    }

    expect(table.grandTotal).toBe(117);
    expect(table.grandTotal).toBe(rows.length);
  });

  it('documents D50 as the sole declared removal', () => {
    const removals = sectionAfter(ledger, '## Declared removals');
    const mentionedIds = new Set(removals.match(/\b[DQ]\d{2}\b/g) ?? []);

    expect([...mentionedIds]).toEqual(['D50']);
  });
});

