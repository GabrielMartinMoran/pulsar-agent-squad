import type { RoomChange } from '../../contract';

/** The narrow surface of `EventSource` the client actually uses. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
  close(): void;
}

/** Injected so reconnect delays are testable without real timers. */
export interface LiveScheduler {
  schedule(delayMs: number, task: () => void): () => void;
}

export interface LiveOptions {
  url: string;
  createSource(url: string): EventSourceLike;
  scheduler: LiveScheduler;
  onOpen(): void;
  onError(): void;
  onRoomChange?(change: RoomChange): void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface LiveConnection {
  dispose(): void;
}

export const DEFAULT_BASE_DELAY_MS = 800;
export const DEFAULT_MAX_DELAY_MS = 15_000;

/**
 * Exponential reconnect delay, capped so a long outage retries at a steady
 * cadence instead of giving up or growing without bound.
 */
export function nextBackoff(
  attempt: number,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  maxDelayMs: number = DEFAULT_MAX_DELAY_MS,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(maxDelayMs, baseDelayMs * 2 ** safeAttempt);
}

/**
 * Opens the event stream and reconnects after a failure. One reconnect is
 * pending at a time; `dispose` closes the source and cancels the timer. A
 * malformed frame is ignored so one bad event cannot stop the stream.
 */
export function connectLive(options: LiveOptions): LiveConnection {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let attempt = 0;
  let disposed = false;
  let source: EventSourceLike | null = null;
  let cancelReconnect: (() => void) | null = null;

  const connect = (): void => {
    if (disposed) return;
    cancelReconnect = null;

    const current = options.createSource(options.url);
    source = current;

    current.addEventListener('open', () => {
      if (disposed || source !== current) return;
      attempt = 0;
      options.onOpen();
    });

    current.addEventListener('room', (event) => {
      if (disposed || source !== current) return;
      if (typeof event.data !== 'string') return;
      try {
        const change = JSON.parse(event.data) as RoomChange;
        if (change && typeof change.key === 'string') options.onRoomChange?.(change);
      } catch {
        // A malformed frame is not a reason to tear down a healthy stream.
      }
    });

    current.addEventListener('error', () => {
      if (disposed || source !== current) return;
      if (cancelReconnect) return;
      current.close();
      options.onError();
      const delay = nextBackoff(attempt, baseDelayMs, maxDelayMs);
      attempt += 1;
      cancelReconnect = options.scheduler.schedule(delay, connect);
    });
  };

  connect();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelReconnect?.();
      cancelReconnect = null;
      source?.close();
      source = null;
    },
  };
}
