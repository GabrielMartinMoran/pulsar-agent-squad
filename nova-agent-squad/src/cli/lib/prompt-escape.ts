/**
 * Escape-key handling for @inquirer/prompts.
 *
 * Inquirer prompts don't natively handle Escape — pressing Escape on a
 * prompt does nothing. To get clean Escape behaviour, we attach a
 * raw keypress listener that aborts an AbortController, then pass the
 * controller's signal into the prompt via the optional context
 * argument. When the signal is aborted, the prompt throws
 * `AbortPromptError` (from `@inquirer/core`), which the wizard catches
 * to decide whether to exit cleanly or go back one step.
 *
 * Usage:
 *
 * ```ts
 * const escape = createEscapeController();
 * try {
 *   const value = await somePrompt(config, { signal: escape.signal });
 * } finally {
 *   escape.dispose();
 * }
 * ```
 *
 * The controller is intentionally lightweight: it does NOT change stdin
 * raw mode or pipe settings. @inquirer/prompts already sets up the
 * readline interface with `terminal: true`, which is sufficient for
 * `process.stdin` to emit 'keypress' events with a populated `key.name`.
 */

import * as readline from 'node:readline';

/** A controller that turns keyboard Escape into an AbortSignal. */
export interface EscapeController {
  /** Pass to @inquirer/prompts as `context.signal`. */
  signal: AbortSignal;
  /**
   * Detach the keypress listener. Always call this when the prompt
   * completes (success, escape, or error) to avoid leaking listeners
   * across prompts. Idempotent.
   */
  dispose: () => void;
}

/**
 * Create a fresh Escape controller. Each prompt call should use its
 * own controller — once aborted, a signal cannot be un-aborted, so
 * reusing a controller across prompts would silently break the
 * second prompt's Escape behaviour.
 */
export function createEscapeController(): EscapeController {
  const controller = new AbortController();

  // Ensure process.stdin is wired to emit 'keypress' events. This is
  // idempotent and safe to call when @inquirer/prompts has already
  // set it up — we just attach the same one-shot listener pattern.
  readline.emitKeypressEvents(process.stdin);

  const handler = (_str: string, key: readline.Key | undefined): void => {
    if (key?.name === 'escape') {
      controller.abort();
    }
  };

  process.stdin.on('keypress', handler);

  return {
    signal: controller.signal,
    dispose: () => {
      process.stdin.removeListener('keypress', handler);
    },
  };
}
