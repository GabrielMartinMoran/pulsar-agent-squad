/**
 * Unit tests for the ESC redraw fix.
 *
 * Root cause: @inquirer/prompts call-sites in setup.ts pass only
 * `{ signal }` as context. @inquirer/core's screen.done() uses
 * `clearContent: Boolean(context.clearPromptOnDone)` which defaults to
 * `false` → newline-only cleanup → next prompt stacks below the previous.
 *
 * Fix: every prompt context object includes `clearPromptOnDone: true`.
 *
 * The setup wizard now starts with a target-selection prompt when `--target`
 * is omitted, so the mocked prompt answers are per-call queues: a target
 * answer first, then the wizard-driving answers.
 *
 * No internal module is mocked: the OpenCode path uses a temp HOME and stub
 * `opencode`, and the Pi path uses a temp HOME and stub `pi`. This keeps the
 * inquirer mocks from leaking into neighboring test files.
 */

import { describe, expect, it, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { AbortPromptError } from '@inquirer/core';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resetModelsCache } from '../../src/cli/lib/model-discovery';

const contexts: Array<Record<string, unknown>> = [];
let selectAnswers: string[] = [];
let searchAnswers: unknown[] = [];
let confirmAnswers: boolean[] = [];

beforeEach(() => {
  contexts.length = 0;
  selectAnswers = [];
  searchAnswers = [];
  confirmAnswers = [];
  resetModelsCache();
});

afterAll(() => {
  mock.restore();
});

function messageOf(config: unknown): string | undefined {
  const message = (config as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message : undefined;
}

mock.module('@inquirer/search', () => ({
  default: (config: unknown, context: unknown) => {
    contexts.push({
      ...(context as Record<string, unknown>),
      _caller: 'search',
      _message: messageOf(config),
    });
    const next = searchAnswers.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new AbortPromptError();
    return next;
  },
}));

mock.module('@inquirer/select', () => ({
  default: (config: unknown, context: unknown) => {
    contexts.push({
      ...(context as Record<string, unknown>),
      _caller: 'select',
      _message: messageOf(config),
    });
    return selectAnswers.shift();
  },
}));

mock.module('@inquirer/confirm', () => ({
  default: (config: unknown, context: unknown) => {
    contexts.push({
      ...(context as Record<string, unknown>),
      _caller: 'confirm',
      _message: messageOf(config),
    });
    return confirmAnswers.shift() ?? true;
  },
}));

let tempHome: string | undefined;
let tempBin: string | undefined;
let previousHome: string | undefined;
let previousPath: string | undefined;

function writeStub(name: string, body: string): void {
  const stub = join(tempBin!, name);
  writeFileSync(stub, `#!/bin/sh\n${body}\n`);
  chmodSync(stub, 0o755);
}

function setupTempEnvironment(): void {
  previousHome = process.env.HOME;
  previousPath = process.env.PATH;
  tempHome = mkdtempSync(join(tmpdir(), 'pas-esc-home-'));
  tempBin = mkdtempSync(join(tmpdir(), 'pas-esc-bin-'));
  process.env.HOME = tempHome;
  process.env.PATH = `${tempBin}:${previousPath ?? ''}`;
}

function setupOpencode(): void {
  mkdirSync(join(tempHome!, '.config', 'opencode'), { recursive: true });
  writeFileSync(join(tempHome!, '.config', 'opencode', 'opencode.json'), '{}\n');
  writeStub(
    'opencode',
    [
      'case "$1" in',
      '  models) echo "test/model"; exit 0;;',
      `  api) echo '{"data":[]}'; exit 0;;`,
      'esac',
      'exit 1',
    ].join('\n'),
  );
}

function setupPi(): void {
  mkdirSync(join(tempHome!, '.pi', 'agent'), { recursive: true });
  const fixture = join(import.meta.dir, '..', 'fixtures', 'pi-list-models.txt');
  writeStub(
    'pi',
    [
      'case "$1" in',
      '  --version) echo "1.4.0"; exit 0;;',
      `  --list-models) cat "${fixture}"; exit 0;;`,
      'esac',
      'exit 1',
    ].join('\n'),
  );
}

function setupPiWithMissingPackages(): void {
  mkdirSync(join(tempHome!, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(tempHome!, '.pi', 'agent', 'settings.json'), '{}\n');
  const fixture = join(import.meta.dir, '..', 'fixtures', 'pi-list-models.txt');
  writeStub(
    'pi',
    [
      'case "$1" in',
      '  --version) echo "1.4.0"; exit 0;;',
      `  --list-models) cat "${fixture}"; exit 0;;`,
      `  list) printf '%s\\n' "User packages:" "  npm:pi-subagents"; exit 0;;`,
      '  install) exit 0;;',
      'esac',
      'exit 1',
    ].join('\n'),
  );
}

/** Normalise recorded prompt messages into the fixed wizard sequence. */
function promptLabels(): string[] {
  return contexts.map((ctx) => {
    const message = typeof ctx._message === 'string' ? ctx._message : '';
    if (message.startsWith('Which tool do you want to configure?')) return 'target';
    if (message.includes('Install missing Pi packages now?')) return 'packages';
    if (message.startsWith('Select agent to configure')) return 'agent';
    if (message.startsWith('What do you want to do with')) return 'action';
    if (message.startsWith('Search for a model')) return 'model';
    if (message.startsWith('Select thinking level')) return 'thinking';
    if (message.includes('Apply this change?')) return 'confirmation';
    return `unknown:${message}`;
  });
}

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  for (const dir of [tempHome, tempBin]) {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }
  tempHome = undefined;
  tempBin = undefined;
});

function expectEveryContextClears(): void {
  for (const ctx of contexts) {
    expect(ctx.clearPromptOnDone).toBe(true);
  }
}

describe('ESC redraw — clearPromptOnDone', () => {
  it('passes clearPromptOnDone:true for the OpenCode flow including target selection', async () => {
    setupTempEnvironment();
    setupOpencode();
    selectAnswers = ['opencode', 'change_model'];
    searchAnswers = [
      'pas_developer',
      { id: 'test/model', provider: 'test', name: 'test-model' },
      new AbortPromptError(),
    ];
    confirmAnswers = [true];

    const setupModule = await import('../../src/cli/commands/agents/setup');
    await setupModule.default.run();

    // target select + action select = 2 selects
    // agent search + model search + escape search = 3 searches
    // 1 confirm
    expect(contexts.length).toBe(6);
    const callers = contexts.map((c) => c._caller);
    expect(callers.filter((c) => c === 'search')).toHaveLength(3);
    expect(callers.filter((c) => c === 'select')).toHaveLength(2);
    expect(callers.filter((c) => c === 'confirm')).toHaveLength(1);
    expectEveryContextClears();
  });

  it('passes clearPromptOnDone:true for the Pi flow including the thinking step', async () => {
    setupTempEnvironment();
    setupPi();
    selectAnswers = ['change_model', 'high'];
    searchAnswers = [
      'pas_researcher',
      { id: 'chat-latest', provider: 'openai', name: 'chat-latest', thinking: true },
      new AbortPromptError(),
    ];
    confirmAnswers = [true];

    const setupModule = await import('../../src/cli/commands/agents/setup');
    await setupModule.default.run({ args: { target: 'pi' } } as never);

    // action select + thinking select = 2 selects
    // agent search + model search + escape search = 3 searches
    // 1 confirm
    expect(contexts.length).toBe(6);
    const callers = contexts.map((c) => c._caller);
    expect(callers.filter((c) => c === 'search')).toHaveLength(3);
    expect(callers.filter((c) => c === 'select')).toHaveLength(2);
    expect(callers.filter((c) => c === 'confirm')).toHaveLength(1);
    expectEveryContextClears();
  });

  it('@contract Pi wizard prompt order is fixed with an explicit target', async () => {
    setupTempEnvironment();
    setupPiWithMissingPackages();
    selectAnswers = ['change_model', 'high'];
    searchAnswers = [
      'pas_researcher',
      { id: 'chat-latest', provider: 'openai', name: 'chat-latest', thinking: true },
      new AbortPromptError(),
    ];
    confirmAnswers = [true, true];

    const setupModule = await import('../../src/cli/commands/agents/setup');
    await setupModule.default.run({ args: { target: 'pi' } } as never);

    // Packages → agent → action → model → thinking → confirmation. The
    // trailing agent prompt is the outer escape that ends the wizard.
    expect(promptLabels()).toEqual([
      'packages',
      'agent',
      'action',
      'model',
      'thinking',
      'confirmation',
      'agent',
    ]);

    const finalConfirm = contexts.find(
      (ctx) =>
        typeof ctx._message === 'string' && ctx._message.includes('Apply this change?'),
    );
    expect(finalConfirm?._message).toContain('Agent: pas_researcher');
    expect(finalConfirm?._message).toContain('Model: chat-latest');
    expect(finalConfirm?._message).toContain('Provider: openai');
    expect(finalConfirm?._message).toContain('Thinking: high');
  });

  it('@contract Pi wizard prompt order puts target selection first when --target is omitted', async () => {
    setupTempEnvironment();
    setupPiWithMissingPackages();
    selectAnswers = ['pi', 'change_model', 'high'];
    searchAnswers = [
      'pas_researcher',
      { id: 'chat-latest', provider: 'openai', name: 'chat-latest', thinking: true },
      new AbortPromptError(),
    ];
    confirmAnswers = [true, true];

    const setupModule = await import('../../src/cli/commands/agents/setup');
    await setupModule.default.run();

    expect(promptLabels()).toEqual([
      'target',
      'packages',
      'agent',
      'action',
      'model',
      'thinking',
      'confirmation',
      'agent',
    ]);
  });
});
