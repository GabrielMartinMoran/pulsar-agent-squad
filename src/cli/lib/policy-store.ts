import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

/**
 * PAS-owned tool policy store.
 *
 * The document is deliberately closed and deny-only: a supported version, a
 * map of agent names, and one list of blocked tool identifiers per agent.
 * Loading never creates directories or files; only `saveToolPolicyStore`
 * writes, and it replaces the document atomically.
 */
export interface AgentToolPolicy {
  tools: string[];
}

/** A validated tool policy document. `version` is the schema discriminator. */
export interface ToolPolicyStore {
  version: 1;
  agents: Record<string, AgentToolPolicy>;
}

/** Schema version this build reads and writes. */
export const SUPPORTED_POLICY_VERSION = 1;

const TOP_LEVEL_FIELDS = new Set(['version', 'agents']);
const AGENT_FIELDS = new Set(['tools']);

/**
 * A tool identifier is a single documented OpenCode action name. Wildcards,
 * whitespace, quotes, and path separators are rejected so a deny can never
 * broaden into a pattern or escape the schema.
 */
const TOOL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Resolve the canonical tools store inside an OpenCode config directory. */
export function getPolicyPath(configDir: string): string {
  return join(configDir, 'pas', 'policies.json');
}

/**
 * Resolve the store path from the environment. `XDG_CONFIG_HOME` wins over
 * `HOME`, matching OpenCode's own configuration lookup.
 */
export function resolvePolicyPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  const configHome =
    xdgConfigHome ||
    join(env.HOME?.trim() || env.USERPROFILE?.trim() || '/tmp', '.config');
  return getPolicyPath(join(configHome, 'opencode'));
}

/** Throw unless `value` is a scalar tool identifier the schema can store. */
export function assertToolIdentifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !TOOL_IDENTIFIER.test(value)
  ) {
    throw new Error(
      `Invalid tool identifier ${JSON.stringify(
        value,
      )}: expected a non-empty OpenCode tool name without wildcards, whitespace, quotes, or path separators.`,
    );
  }
  return value;
}

function invalidStore(path: string, problem: string): never {
  throw new Error(
    `Invalid tool policy store at ${path}: ${problem}. Fix or remove this file, then retry.`,
  );
}

/**
 * Validate a parsed document and return it typed. The input is not mutated;
 * unknown fields are rejected so a newer or hand-edited schema cannot be
 * silently half-understood.
 */
export function validateToolPolicyStore(
  value: unknown,
  path: string = resolvePolicyPath(),
): ToolPolicyStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidStore(path, 'expected a JSON object');
  }
  const data = value as Record<string, unknown>;
  for (const field of Object.keys(data)) {
    if (!TOP_LEVEL_FIELDS.has(field)) {
      invalidStore(path, `unexpected field "${field}"`);
    }
  }
  if (data.version !== SUPPORTED_POLICY_VERSION) {
    invalidStore(
      path,
      `unsupported version ${String(data.version)} (supported: ${SUPPORTED_POLICY_VERSION})`,
    );
  }
  if (
    !data.agents ||
    typeof data.agents !== 'object' ||
    Array.isArray(data.agents)
  ) {
    invalidStore(path, 'agents must be an object');
  }

  for (const [name, raw] of Object.entries(
    data.agents as Record<string, unknown>,
  )) {
    if (!name.trim()) invalidStore(path, 'agent names must be non-empty');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalidStore(path, `agent "${name}" must be an object`);
    }
    const agent = raw as Record<string, unknown>;
    for (const field of Object.keys(agent)) {
      if (!AGENT_FIELDS.has(field)) {
        invalidStore(path, `agent "${name}" has unexpected field "${field}"`);
      }
    }
    if (!Array.isArray(agent.tools)) {
      invalidStore(path, `agent "${name}" tools must be an array`);
    }
    for (const tool of agent.tools) {
      try {
        assertToolIdentifier(tool);
      } catch (error) {
        invalidStore(
          path,
          `agent "${name}" has ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  return value as ToolPolicyStore;
}

/**
 * Load and validate the store. A missing file is a normal empty state and
 * returns `null` without touching the filesystem.
 */
export function loadToolPolicyStore(path: string): ToolPolicyStore | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read tool policy store at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Malformed JSON in tool policy store at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }. Fix or remove this file, then retry.`,
    );
  }
  return validateToolPolicyStore(parsed, path);
}

/**
 * Validate and atomically write the canonical document: sorted agent names,
 * sorted and deduplicated tool lists, and no agent entry without tools. The
 * temporary file lives beside the destination and is replaced with a rename.
 */
export function saveToolPolicyStore(
  store: ToolPolicyStore,
  path: string,
): string {
  const valid = validateToolPolicyStore(store, path);
  const agents: Record<string, AgentToolPolicy> = {};
  for (const name of Object.keys(valid.agents).sort()) {
    const tools = [...new Set(valid.agents[name]!.tools)].sort();
    if (tools.length === 0) continue;
    agents[name] = { tools };
  }
  const canonical: ToolPolicyStore = { version: SUPPORTED_POLICY_VERSION, agents };
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(canonical, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return path;
}
