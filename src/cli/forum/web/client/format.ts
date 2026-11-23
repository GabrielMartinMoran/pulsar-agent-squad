import type { RoomPhase, TopicCounts } from '../../contract';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const ABSOLUTE_AFTER_MS = 7 * DAY_MS;

const PHASE_LABELS: Record<RoomPhase, string> = {
  waiting_for_pair: 'Waiting for pair',
  active: 'Active',
  closing: 'Closing',
  stalled: 'Stalled',
  closed: 'Closed',
  aborted: 'Aborted',
};

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/** A phase is null only when the room document could not be read. */
export function formatPhase(phase: RoomPhase | null): string {
  return phase ? PHASE_LABELS[phase] : 'Unreadable';
}

/** Data attribute used by the stylesheet to tint a phase pill. */
export function phaseTone(phase: RoomPhase | null): string {
  return phase ?? 'unreadable';
}

export function formatRole(role: string): string {
  return capitalize(role.trim()) || 'Unknown';
}

export function roleTone(role: string): 'driver' | 'peer' | 'host' | 'system' {
  if (role === 'driver' || role === 'peer' || role === 'host') return role;
  return 'system';
}

export function formatCategory(category: string): string {
  const label = category.replace(/_/g, ' ').trim();
  return label.length === 0 ? 'Message' : capitalize(label);
}

export function formatRelativeTime(at: string | null, now: number): string {
  if (!at) return 'unknown';
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return 'unknown';

  const delta = now - time;
  if (delta < MINUTE_MS) return 'just now';
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)}m ago`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h ago`;
  if (delta < ABSOLUTE_AFTER_MS) return `${Math.floor(delta / DAY_MS)}d ago`;
  return new Date(time).toISOString().slice(0, 10);
}

export function formatAbsoluteTime(at: string | null): string {
  if (!at) return 'unknown';
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return 'unknown';
  const iso = new Date(time).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function shortFingerprint(value: string | null): string {
  if (!value) return '—';
  return value.length <= 12 ? value : `${value.slice(0, 12)}…`;
}

export function formatExitCode(code: number | null): string {
  return code === null ? 'no exit code' : `exit ${code}`;
}

function pluralForm(singular: string): string {
  if (/[^aeiou]y$/.test(singular)) return `${singular.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(singular)) return `${singular}es`;
  return `${singular}s`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? pluralForm(singular))}`;
}

export function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function formatProgress(approved: number, total: number): string {
  if (total === 0) return 'no topics';
  return `${approved}/${total} approved`;
}

export function formatReviewProgress(counts: TopicCounts): string {
  return formatProgress(counts.approved, counts.total);
}
