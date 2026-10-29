/**
 * Parser for the fixed-width table printed by `pi --list-models`.
 *
 * The table is human output, not JSON. Columns are:
 * `provider model context max-out thinking images`.
 * Unparseable output yields an empty list so the wizard can fall back to
 * manual model entry instead of failing.
 */

export interface PiModelRow {
  provider: string;
  model: string;
  context: number;
  maxOut: number;
  thinking: boolean;
  images: boolean;
}

function flag(value: string): boolean {
  return value.trim().toLowerCase() === 'yes';
}

/**
 * Parse a human amount from the table: `128000`, `8.2K`, or `1.0M`.
 * Unknown forms fall through to `Number`, which yields NaN and lets the row
 * be skipped rather than guessed.
 */
function amount(value: string): number {
  const compact = value.trim().replace(/,/g, '');
  const match = /^([0-9]+(?:\.[0-9]+)?)([KkMm])?$/.exec(compact);
  if (!match) return Number(compact);

  const base = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === 'k') return Math.round(base * 1_000);
  if (unit === 'm') return Math.round(base * 1_000_000);
  return base;
}

export function parsePiModelList(output: string): PiModelRow[] {
  const rows: PiModelRow[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('provider')) continue;

    const fields = line.split(/\s{2,}/).map((field) => field.trim()).filter(Boolean);
    if (fields.length < 6) continue;

    const [provider, model, context, maxOut, thinking, images] = fields;
    const parsedContext = amount(context);
    const parsedMaxOut = amount(maxOut);

    if (!provider || !model) continue;
    if (!Number.isFinite(parsedContext) || !Number.isFinite(parsedMaxOut)) continue;

    rows.push({
      provider,
      model,
      context: parsedContext,
      maxOut: parsedMaxOut,
      thinking: flag(thinking),
      images: flag(images),
    });
  }

  return rows;
}

export function formatPiModelLabel(row: PiModelRow): string {
  return `${row.provider}/${row.model}`;
}
