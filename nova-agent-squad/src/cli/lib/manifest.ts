export interface ManifestEntry {
  target: string;
  kind: 'dir' | 'file';
  source: string;
  distPath: string;
  installPath: string;
}

/**
 * Parse config/platforms.manifest (pipe-delimited format).
 * Skips comments (#) and empty lines.
 */
export function parseManifest(): ManifestEntry[] {
  const manifestPath = `${import.meta.dir}/../../../config/platforms.manifest`;
  const text = require('fs').readFileSync(manifestPath, 'utf-8');
  const lines = text.split('\n');

  const entries: ManifestEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split('|');
    if (parts.length !== 5) continue;

    const [target, kind, source, distPath, installPath] = parts;

    if (kind !== 'dir' && kind !== 'file') continue;

    entries.push({
      target: target.trim(),
      kind: kind as 'dir' | 'file',
      source: source.trim(),
      distPath: distPath.trim(),
      installPath: installPath.trim(),
    });
  }

  return entries;
}
