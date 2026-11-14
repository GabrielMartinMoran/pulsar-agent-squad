import { basename, extname, join } from 'path';
import type { ManifestEntry } from './manifest';

/**
 * Resolve an install path against an optional custom base directory, falling
 * back to the user's home directory. Shared by install and uninstall so the
 * two commands cannot drift.
 */
export function resolveDest(installPath: string, destdir?: string): string {
  if (destdir) {
    return `${destdir.replace(/\/+$/, '')}/${installPath.replace(/^\/+/, '')}`;
  }
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return `${home}/${installPath}`;
}

export interface ResolvedArtifactDestination {
  /** Path shown in install/uninstall output lines. */
  reported: string;
  /** Exact path written to or removed from disk. */
  target: string;
}

/**
 * Resolve the destination of one manifest artifact.
 *
 * The manifest `kind` selects the copy path: a `dir` row installs its tree
 * into the reported directory; a `file` row writes one file. A `file` row
 * whose install path already names a file (has an extension) is written to
 * exactly that path; otherwise the install path is the containing directory
 * and the artifact filename is appended. This replaces the old
 * `basename(installPath).includes('.')` heuristic, which misread dot-named
 * directories such as `.claude` as files.
 */
export function resolveArtifactDestination(
  entry: Pick<ManifestEntry, 'kind' | 'distPath' | 'installPath'>,
  destdir?: string,
): ResolvedArtifactDestination {
  const reported = resolveDest(entry.installPath, destdir);
  if (entry.kind === 'dir') {
    return { reported, target: reported };
  }
  if (extname(entry.installPath) !== '') {
    return { reported, target: reported };
  }
  return { reported, target: join(reported, basename(entry.distPath)) };
}
