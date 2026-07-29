/**
 * Unit tests for the Escape-key controller.
 *
 * The escape controller wires the keyboard Escape key to an AbortSignal
 * so @inquirer/prompts can be aborted cleanly when the user presses
 * Escape. The production wiring lives in src/cli/lib/prompt-escape.ts.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createEscapeController, type EscapeController } from '../../src/cli/lib/prompt-escape';

/**
 * Synthesise a keypress event on stdin. Matches the shape readline
 * uses when a real key arrives: (str, key) where key.name is the
 * canonical key name.
 */
function emitKeypress(key: { name: string; sequence?: string }): void {
  const sequence = key.sequence ?? '';
  process.stdin.emit('keypress', sequence, key);
}

describe('createEscapeController', () => {
  let ctrl: EscapeController;

  beforeEach(() => {
    ctrl = createEscapeController();
  });

  afterEach(() => {
    ctrl.dispose();
  });

  it('should return an object exposing an AbortSignal', () => {
    expect(ctrl.signal).toBeInstanceOf(AbortSignal);
    expect(ctrl.signal.aborted).toBe(false);
  });

  it('should abort the signal when an Escape keypress is emitted', () => {
    expect(ctrl.signal.aborted).toBe(false);
    emitKeypress({ name: 'escape', sequence: '\u001b' });
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('should NOT abort on other keys (e.g. Enter, arrows, letters)', () => {
    emitKeypress({ name: 'return', sequence: '\r' });
    emitKeypress({ name: 'up', sequence: '\u001b[A' });
    emitKeypress({ name: 'a', sequence: 'a' });
    emitKeypress({ name: 'tab', sequence: '\t' });
    expect(ctrl.signal.aborted).toBe(false);
  });

  it('should only fire abort once (subsequent Escape presses are no-ops)', () => {
    let abortCount = 0;
    ctrl.signal.addEventListener('abort', () => {
      abortCount += 1;
    });

    emitKeypress({ name: 'escape' });
    emitKeypress({ name: 'escape' });
    emitKeypress({ name: 'escape' });

    expect(ctrl.signal.aborted).toBe(true);
    expect(abortCount).toBe(1);
  });

  it('should remove the keypress listener on dispose', () => {
    ctrl.dispose();
    // After dispose, a subsequent Escape keypress should NOT abort
    // this controller's signal (the listener is gone).
    emitKeypress({ name: 'escape' });
    expect(ctrl.signal.aborted).toBe(false);
  });
});

describe('EscapeController.dispose', () => {
  it('should be safe to call multiple times', () => {
    const ctrl = createEscapeController();
    ctrl.dispose();
    ctrl.dispose();
    // No assertion needed; just verifying no throw / hang.
  });

  it('should leave the signal in its post-abort state if already aborted', () => {
    const ctrl = createEscapeController();
    emitKeypress({ name: 'escape' });
    expect(ctrl.signal.aborted).toBe(true);
    ctrl.dispose();
    expect(ctrl.signal.aborted).toBe(true);
  });
});
