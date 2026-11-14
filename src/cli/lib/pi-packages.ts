import { readFileSync } from 'fs';

/**
 * Parse the configured Pi package list (one source per line).
 * Pure function: no filesystem access.
 *
 * Rules:
 * - split on newlines (LF or CRLF)
 * - trim each line
 * - skip empty lines and lines starting with `#`
 * - preserve input order
 * - drop duplicates, keeping the first occurrence
 */
export function parsePiPackages(text: string): string[] {
  const packages: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (seen.has(line)) continue;

    seen.add(line);
    packages.push(line);
  }

  return packages;
}

/**
 * Read and parse the configured Pi package list. The filesystem boundary
 * lives here so `parsePiPackages` stays pure.
 */
export function readPiPackages(path = 'config/pi-packages.txt'): string[] {
  return parsePiPackages(readFileSync(path, 'utf-8'));
}
