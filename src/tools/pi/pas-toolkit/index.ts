/**
 * Pi adapter for the PAS state toolkit.
 *
 * Core-sharing approach: the canonical state rules live only in
 * `src/tools/pas-toolkit.ts`. This adapter imports them through the committed
 * thin `./core.ts` re-export so tests and type-checking resolve without a
 * duplicate copy; the build replaces that shim with a byte copy of the
 * canonical source in the assembled extension directory. No state logic is
 * reimplemented here — argument validation stays at the Pi boundary and every
 * operation delegates to `runToolkitOperation`.
 */
import { resolve } from 'node:path';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  TOOL_INPUT_SCHEMA,
  runToolkitOperation,
  type ToolkitInput,
} from './core.ts';

interface PiTextContent {
  type: 'text';
  text: string;
}

interface PiToolResult {
  content: PiTextContent[];
  details: Record<string, unknown>;
}

interface PiToolContext {
  cwd?: string;
}

interface PiToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters: typeof TOOL_INPUT_SCHEMA;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: unknown,
    onUpdate: unknown,
    ctx: PiToolContext,
  ) => Promise<PiToolResult>;
}

interface PiExtensionAPI {
  registerTool(definition: PiToolDefinition): void;
}

const OPERATIONS: ReadonlyArray<ToolkitInput['operation']> = [
  'init',
  'list',
  'check',
  'new',
  'archive',
];

function isToolkitInput(value: unknown): value is ToolkitInput {
  if (typeof value !== 'object' || value === null) return false;
  const operation = (value as { operation?: unknown }).operation;
  return typeof operation === 'string' && OPERATIONS.includes(operation as ToolkitInput['operation']);
}

function resolveWorkspace(input: ToolkitInput, cwd: string): string {
  if (typeof input.root === 'string' && input.root.trim() !== '') {
    return resolve(input.root.trim());
  }
  return resolve(cwd);
}

export default function pasToolkitExtension(pi: PiExtensionAPI): void {
  pi.registerTool({
    name: TOOL_NAME,
    label: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_INPUT_SCHEMA,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = typeof ctx?.cwd === 'string' && ctx.cwd.trim() !== '' ? ctx.cwd : process.cwd();
      if (!isToolkitInput(params)) {
        const text = `ERROR: invalid pas_toolkit arguments (expected one of: ${OPERATIONS.join(', ')})`;
        return { content: [{ type: 'text', text }], details: { error: true } };
      }

      const workspace = resolveWorkspace(params, cwd);
      try {
        const text = runToolkitOperation(params, workspace);
        return {
          content: [{ type: 'text', text: `${text}\nWorkspace: ${workspace}` }],
          details: { workspace },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `ERROR: ${message}\nWorkspace: ${workspace}` }],
          details: { workspace, error: true },
        };
      }
    },
  });
}
