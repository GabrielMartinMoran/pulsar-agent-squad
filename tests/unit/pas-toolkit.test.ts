import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import pasToolkit, {
  TOOL_DESCRIPTION,
  TOOL_INPUT_SCHEMA,
  TOOL_NAME,
  allocateNextId,
  archiveFeatureState,
  checkState,
  createFeatureState,
  initProjectConfig,
  renderProjectConfig,
  defaultStateConfig,
  listState,
  loadStateConfig,
  parseFeatureName,
  parseStateConfig,
  readFeatureStatus,
  renderCheck,
  scanStateDir,
} from '../../src/tools/pas-toolkit';

const BASE_CONFIG = [
  'version: "0.1"',
  'state:',
  '  active_path: ".pas/state/active"',
  '  archived_path: ".pas/state/archived"',
  '',
].join('\n');

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pas-toolkit-'));
  roots.push(root);
  return root;
}

function writeConfig(root: string, yaml: string): void {
  mkdirSync(join(root, '.pas'), { recursive: true });
  writeFileSync(join(root, '.pas', 'pas.config.yaml'), yaml);
}

function storeDir(root: string, area: 'active' | 'archived'): string {
  return join(root, '.pas/state', area);
}

function featureDir(root: string, area: 'active' | 'archived', name: string): string {
  return join(storeDir(root, area), name);
}

function addFeature(root: string, area: 'active' | 'archived', name: string, stateFile?: string): string {
  const dir = featureDir(root, area, name);
  mkdirSync(dir, { recursive: true });
  if (stateFile !== undefined) writeFileSync(join(dir, 'state.md'), stateFile);
  return dir;
}

function touchFile(path: string, content = ''): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function stateMd(id: string, slug: string, status: string): string {
  return [
    `# Feature state (${slug})`,
    '',
    `- Feature ID: ${id}`,
    `- Slug: ${slug}`,
    `- Status: ${status}`,
    '- Created: 2026-01-01',
    '',
  ].join('\n');
}

interface CapturedTool {
  name: string;
  description: string;
  input: unknown;
  execute: (input: unknown, context?: unknown) => Promise<{ content: string }>;
}

async function captureTool(locationDirectory?: string): Promise<CapturedTool> {
  let registered: CapturedTool | undefined;
  const ctx = {
    location: locationDirectory === undefined ? undefined : { directory: locationDirectory },
    tool: {
      transform: async (callback: (editor: { add(tool: CapturedTool): void }) => void) => {
        callback({
          add: (tool) => {
            registered = tool;
          },
        });
      },
    },
  };
  await pasToolkit.setup(ctx);
  if (!registered) throw new Error('setup did not register a tool');
  return registered;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('portable PAS project configuration bootstrap', () => {
  it('keeps the distributed generic example byte-identical to the plugin template', () => {
    const example = readFileSync('src/templates/pas.config.example.yaml', 'utf-8');
    expect(renderProjectConfig('example-project')).toBe(example);
    expect(example).toContain('product: example-project');
    expect(example).toContain('name: "projects/example-project"');
    expect(example).not.toContain('product: pulsar-agent-squad');
  });

  it('previews the inferred project without creating config or state directories', () => {
    const root = makeRoot();
    const result = initProjectConfig(root);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('NO FILES WRITTEN');
    expect(result.text).toContain('Destination:');
    expect(result.text).toContain('explicit approval');
    expect(result.text).toContain('confirm: true');
    expect(existsSync(join(root, '.pas'))).toBe(false);
  });

  it('creates a working workspace-scoped config only after confirmation', () => {
    const root = makeRoot();
    const preview = initProjectConfig(root, { project: 'my-service' });
    expect(preview.text).toContain('product: my-service');
    expect(existsSync(join(root, '.pas/pas.config.yaml'))).toBe(false);

    const created = initProjectConfig(root, { project: 'my-service', confirm: true });
    expect(created.ok).toBe(true);
    const contents = readFileSync(join(root, '.pas/pas.config.yaml'), 'utf-8');
    expect(contents).toBe(renderProjectConfig('my-service'));
    expect(contents).toContain('name: "projects/my-service"');
    expect(checkState(root).ok).toBe(true);
    expect(createFeatureState(root, 'first-feature').ok).toBe(true);
    expect(existsSync(join(root, '.pas/state/active/00001-first-feature/state.md'))).toBe(true);
  });

  it('never overwrites an existing config, including when confirmed', () => {
    const root = makeRoot();
    writeConfig(root, 'product: user-customized\\n');
    const original = readFileSync(join(root, '.pas/pas.config.yaml'), 'utf-8');
    for (const confirm of [undefined, true]) {
      const result = initProjectConfig(root, { project: 'different', confirm });
      expect(result.ok).toBe(false);
      expect(result.text).toContain('refusing to overwrite');
    }
    expect(readFileSync(join(root, '.pas/pas.config.yaml'), 'utf-8')).toBe(original);
  });

  it('refuses invalid project names and does not accept a truthy non-boolean confirmation', () => {
    const root = makeRoot();
    for (const project of ['../../escape', 'Not a slug', 'evil: value', '']) {
      const result = initProjectConfig(root, { project, confirm: true });
      expect(result.ok).toBe(false);
    }
    const fakeConfirmation = initProjectConfig(root, { project: 'valid', confirm: 'yes' as unknown as boolean });
    expect(fakeConfirmation.text).toContain('NO FILES WRITTEN');
    expect(existsSync(join(root, '.pas'))).toBe(false);
  });
});

describe('parseStateConfig', () => {
  it('defines the documented defaults', () => {
    expect(defaultStateConfig()).toEqual({
      activePath: '.pas/state/active',
      archivedPath: '.pas/state/archived',
      maxActive: 1,
      width: 5,
      start: 1,
    });
  });

  it('returns defaults when the document has no state block', () => {
    expect(parseStateConfig('version: "0.1"\nmemory:\n  enabled: true\n')).toEqual(defaultStateConfig());
  });

  it('reads overrides from the state block and ignores unrelated blocks', () => {
    const document = [
      'version: "0.1"',
      'state:',
      '  root: ".pas/state"',
      '  active_path: "state/active" # workspace relative',
      '  archive_path: state/archive',
      '  max_active: 3',
      '  numbering:',
      '    start: 2',
      '    width: 4',
      '    source: archived',
      'memory:',
      '  enabled: true',
      '',
    ].join('\n');

    expect(parseStateConfig(document)).toEqual({
      activePath: 'state/active',
      archivedPath: 'state/archive',
      maxActive: 3,
      width: 4,
      start: 2,
    });
  });

  it('prefers archived_path over its archive_path alias in any order', () => {
    const primaryFirst = 'state:\n  archived_path: primary\n  archive_path: alias\n';
    const aliasFirst = 'state:\n  archive_path: alias\n  archived_path: primary\n';

    expect(parseStateConfig(primaryFirst).archivedPath).toBe('primary');
    expect(parseStateConfig(aliasFirst).archivedPath).toBe('primary');
  });

  it('falls back to defaults for invalid numbers', () => {
    const document = 'state:\n  max_active: banana\n  numbering:\n    width: 0\n    start: -2\n';
    const config = parseStateConfig(document);

    expect(config.maxActive).toBe(1);
    expect(config.width).toBe(5);
    expect(config.start).toBe(1);
  });
});

describe('loadStateConfig', () => {
  it('reports missing config and returns defaults', () => {
    const root = makeRoot();
    const loaded = loadStateConfig(root);

    expect(loaded.present).toBe(false);
    expect(loaded.config).toEqual(defaultStateConfig());
    expect(loaded.sourcePath).toBe(join(root, '.pas', 'pas.config.yaml'));
  });

  it('reports unreadable config when the config path is not a file', () => {
    const root = makeRoot();
    mkdirSync(join(root, '.pas', 'pas.config.yaml'), { recursive: true });

    expect(loadStateConfig(root).present).toBe(false);
  });

  it('parses a readable config file', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    const loaded = loadStateConfig(root);

    expect(loaded.present).toBe(true);
    expect(loaded.config.activePath).toBe('.pas/state/active');
    expect(loaded.config.archivedPath).toBe('.pas/state/archived');
  });
});

describe('parseFeatureName', () => {
  it('parses a five-digit feature directory', () => {
    expect(parseFeatureName('00001-pulsar-agent-squad', 5)).toEqual({
      id: 1,
      idText: '00001',
      slug: 'pulsar-agent-squad',
    });
  });

  it('rejects names that do not match NNNNN-slug', () => {
    const invalid = [
      '0001-four-digits',
      '000001-six-digits',
      '1-no-padding',
      '00001',
      '00001-',
      '00001-Uppercase',
      '00001-under_score',
      '00001-dot.slug',
      '-00001-leading-dash',
      'legacy-dir',
      '.gitkeep',
    ];

    for (const name of invalid) {
      expect(parseFeatureName(name, 5)).toBeNull();
    }
  });

  it('honors a custom width', () => {
    expect(parseFeatureName('0042-answer', 4)).toEqual({ id: 42, idText: '0042', slug: 'answer' });
    expect(parseFeatureName('042-answer', 4)).toBeNull();
  });
});

describe('scanStateDir', () => {
  it('returns empty results for a missing directory', () => {
    expect(scanStateDir(join(makeRoot(), 'nope'), 5)).toEqual({ features: [], unexpected: [] });
  });

  it('sorts features, flags unexpected entries, and ignores .gitkeep', () => {
    const root = makeRoot();
    addFeature(root, 'active', '00002-second');
    addFeature(root, 'active', '00001-first');
    touchFile(join(storeDir(root, 'active'), '.gitkeep'));
    touchFile(join(storeDir(root, 'active'), 'loose.md'));
    touchFile(join(storeDir(root, 'active'), '00003-trap'));

    const scan = scanStateDir(storeDir(root, 'active'), 5);

    expect(scan.features.map((feature) => feature.name)).toEqual(['00001-first', '00002-second']);
    expect(scan.features[0].id).toBe(1);
    expect(scan.features[0].slug).toBe('first');
    expect(scan.unexpected.map((entry) => entry.name)).toEqual(['00003-trap', 'loose.md']);
    expect(scan.unexpected.find((entry) => entry.name === '00003-trap')?.reason).toBe('not a directory');
    expect(scan.unexpected.find((entry) => entry.name === 'loose.md')?.reason).toBe('does not match NNNNN-slug');
  });
});

describe('allocateNextId', () => {
  it('returns the configured start when no ids exist', () => {
    expect(allocateNextId([], 1)).toBe(1);
  });

  it('returns max id + 1', () => {
    expect(allocateNextId([1, 2, 5], 1)).toBe(6);
  });

  it('never returns less than the configured start', () => {
    expect(allocateNextId([2, 3], 10)).toBe(10);
    expect(allocateNextId([], 7)).toBe(7);
  });
});

describe('readFeatureStatus', () => {
  it('reads the status bullet from state.md', () => {
    const dir = addFeature(makeRoot(), 'active', '00001-x', stateMd('00001', 'x', '**Completed**.'));

    expect(readFeatureStatus(dir)).toBe('completed');
  });

  it('falls back to a yaml state file', () => {
    const root = makeRoot();
    const dir = addFeature(root, 'active', '00002-y');
    touchFile(join(dir, 'state.yaml'), 'status: in-progress\n');

    expect(readFeatureStatus(dir)).toBe('in-progress');
  });

  it('returns null when no status is present', () => {
    const dir = addFeature(makeRoot(), 'active', '00003-z');

    expect(readFeatureStatus(dir)).toBeNull();
  });
});

describe('listState', () => {
  it('summarizes an empty workspace', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    const output = listState(root);

    expect(output).toContain('State: active=.pas/state/active archive=.pas/state/archived max_active=1');
    expect(output).toContain('Active (0/1):');
    expect(output).toContain('Archive (0):');
    expect(output).toContain('(none)');
  });

  it('lists active features with best-effort statuses', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00001-first', stateMd('00001', 'first', 'active'));
    const second = addFeature(root, 'active', '00002-second');
    touchFile(join(second, 'state.yaml'), 'status: completed\n');
    addFeature(root, 'active', '00003-third');
    const output = listState(root);

    expect(output).toContain('- 00001-first [active]');
    expect(output).toContain('- 00002-second [completed]');
    expect(output).toContain('- 00003-third [unknown]');
  });

  it('caps the archive listing and reports the remainder', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    for (let index = 1; index <= 7; index += 1) {
      const id = String(index).padStart(5, '0');
      addFeature(root, 'archived', `${id}-item`, stateMd(id, 'item', 'completed'));
    }
    const output = listState(root);

    expect(output).toContain('Archive (7):');
    expect(output).toContain('- 00005-item [completed]');
    expect(output).not.toContain('- 00006-item');
    expect(output).toContain('(+2 more)');
  });

  it('notes a missing config and keeps going with defaults', () => {
    const root = makeRoot();
    const output = listState(root);

    expect(output).toContain('Config: unreadable');
    expect(output).toContain('using defaults');
    expect(output).toContain('Active (0/1):');
  });
});

describe('checkState', () => {
  it('reports ok for a clean workspace', () => {
    const root = makeRoot();
    writeConfig(
      root,
      ['state:', '  active_path: ".pas/state/active"', '  archived_path: ".pas/state/archived"', '  max_active: 2', ''].join('\n'),
    );
    addFeature(root, 'active', '00001-one', stateMd('00001', 'one', 'active'));
    const second = addFeature(root, 'active', '00002-two');
    touchFile(join(second, 'state.yaml'), 'status: active\n');
    addFeature(root, 'archived', '00003-old', stateMd('00003', 'old', 'completed'));
    touchFile(join(storeDir(root, 'active'), '.gitkeep'));

    const check = checkState(root);

    expect(check.ok).toBe(true);
    expect(check.violations).toEqual([]);
  });

  it('reports missing-config and blocks mutations', () => {
    const root = makeRoot();
    const check = checkState(root);

    expect(check.ok).toBe(false);
    expect(check.violations.map((violation) => violation.kind)).toEqual(['missing-config']);
    expect(check.violations[0].message).toContain('mutations are blocked');
  });

  it('reports unexpected entries with paths and ignores .gitkeep', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', 'legacy-dir');
    touchFile(join(storeDir(root, 'active'), '.gitkeep'));
    touchFile(join(storeDir(root, 'active'), '00007-trap'));
    touchFile(join(storeDir(root, 'archived'), 'loose.md'));

    const check = checkState(root);
    const unexpected = check.violations.filter((violation) => violation.kind === 'unexpected-entry');
    const paths = unexpected.map((violation) => violation.path);

    expect(check.ok).toBe(false);
    expect(unexpected).toHaveLength(3);
    expect(paths).toContain(join(root, '.pas/state/active/legacy-dir'));
    expect(paths).toContain(join(root, '.pas/state/active/00007-trap'));
    expect(paths).toContain(join(root, '.pas/state/archived/loose.md'));
    expect(check.violations.some((violation) => violation.path.includes('.gitkeep'))).toBe(false);
  });

  it('reports cardinality when active exceeds max_active', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00001-one', stateMd('00001', 'one', 'active'));
    addFeature(root, 'active', '00002-two', stateMd('00002', 'two', 'active'));

    const check = checkState(root);
    const cardinality = check.violations.filter((violation) => violation.kind === 'cardinality');

    expect(cardinality).toHaveLength(1);
    expect(cardinality[0].path).toBe(storeDir(root, 'active'));
    expect(cardinality[0].message).toContain('max_active is 1');
  });

  it('reports duplicate ids across active and archive', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00004-alpha', stateMd('00004', 'alpha', 'active'));
    addFeature(root, 'archived', '00004-beta', stateMd('00004', 'beta', 'completed'));
    addFeature(root, 'active', '00005-one', stateMd('00005', 'one', 'active'));
    addFeature(root, 'active', '00005-two', stateMd('00005', 'two', 'active'));

    const check = checkState(root);

    expect(check.violations.filter((violation) => violation.kind === 'duplicate-id')).toHaveLength(2);
  });

  it('reports terminal statuses in active and ignores archived features', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    const statuses = ['completed', 'complete', 'done', 'cancelled', 'archived'];
    statuses.forEach((status, index) => {
      const id = String(index + 1).padStart(5, '0');
      addFeature(root, 'active', `${id}-${status}`, stateMd(id, status, status));
    });
    addFeature(root, 'archived', '00006-old', stateMd('00006', 'old', 'completed'));

    const check = checkState(root);
    const terminal = check.violations.filter((violation) => violation.kind === 'terminal-in-active');

    expect(terminal).toHaveLength(5);
    expect(check.violations.some((violation) => violation.path.includes('00006-old'))).toBe(false);
  });

  it('reports numbered directories without a state file', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00001-nostate');
    const withYaml = addFeature(root, 'archived', '00002-has-yaml');
    touchFile(join(withYaml, 'state.yaml'), 'status: completed\n');
    addFeature(root, 'archived', '00003-nostate');

    const check = checkState(root);
    const missing = check.violations.filter((violation) => violation.kind === 'missing-state');

    expect(missing).toHaveLength(2);
    expect(missing.map((violation) => violation.path)).toContain(join(root, '.pas/state/active/00001-nostate'));
    expect(missing.map((violation) => violation.path)).toContain(join(root, '.pas/state/archived/00003-nostate'));
  });

  it('renders ok and violation reports with the cleanup guide', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);

    const okReport = renderCheck(checkState(root));
    expect(okReport).toContain('ok: true');
    expect(okReport).toContain('violations: 0');
    expect(okReport).toContain('offer a cleanup');
    expect(okReport).toContain('separately authorized work');

    touchFile(join(storeDir(root, 'active'), 'loose.md'));
    const badReport = renderCheck(checkState(root));
    expect(badReport).toContain('ok: false');
    expect(badReport).toContain('[unexpected-entry]');
    expect(badReport).toContain('loose.md');
  });
});

describe('createFeatureState', () => {
  it('creates the numbered directory and a state skeleton', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);

    const result = createFeatureState(root, 'my-feature', { now: new Date('2026-02-03T12:00:00Z') });

    expect(result.ok).toBe(true);
    expect(result.text).toContain('Created 00001-my-feature');
    const statePath = join(featureDir(root, 'active', '00001-my-feature'), 'state.md');
    expect(existsSync(statePath)).toBe(true);
    const content = readFileSync(statePath, 'utf-8');
    expect(content).toContain('- Feature ID: 00001');
    expect(content).toContain('- Slug: my-feature');
    expect(content).toContain('- Status: active');
    expect(content).toContain('- Created: 2026-02-03');
  });

  it('allocates max(active, archive) + 1', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00002-active-x', stateMd('00002', 'active-x', 'active'));
    addFeature(root, 'archived', '00005-archived-y', stateMd('00005', 'archived-y', 'completed'));

    const result = createFeatureState(root, 'next');

    expect(result.ok).toBe(true);
    expect(existsSync(featureDir(root, 'active', '00006-next'))).toBe(true);
  });

  it('honors numbering.start and numbering.width', () => {
    const root = makeRoot();
    writeConfig(
      root,
      ['state:', '  active_path: ".pas/state/active"', '  archived_path: ".pas/state/archived"', '  numbering:', '    start: 10', '    width: 5', ''].join('\n'),
    );

    expect(createFeatureState(root, 'first').ok).toBe(true);
    expect(existsSync(featureDir(root, 'active', '00010-first'))).toBe(true);

    const narrow = makeRoot();
    writeConfig(
      narrow,
      ['state:', '  active_path: ".pas/state/active"', '  archived_path: ".pas/state/archived"', '  numbering:', '    width: 4', ''].join('\n'),
    );

    expect(createFeatureState(narrow, 'first').ok).toBe(true);
    expect(existsSync(featureDir(narrow, 'active', '0001-first'))).toBe(true);
  });

  it('rejects malformed slugs without touching the state store', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);

    for (const slug of ['', 'Bad Slug', 'Bad', '-leading', 'under_score', 'dot.slug', 'trailing space ']) {
      const result = createFeatureState(root, slug);
      expect(result.ok).toBe(false);
      expect(result.text).toContain('Blocked');
    }

    expect(listState(root)).toContain('Active (0/1):');
  });

  it('blocks creation while duplicate ids exist', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00002-a');
    addFeature(root, 'archived', '00002-b');

    const result = createFeatureState(root, 'fresh');

    expect(result.ok).toBe(false);
    expect(result.text).toContain('duplicate');
  });

  it('blocks creation while malformed entries exist', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', 'legacy-dir');

    const result = createFeatureState(root, 'fresh');

    expect(result.ok).toBe(false);
    expect(result.text).toContain('malformed');
  });

  it('blocks creation when the config is missing', () => {
    const root = makeRoot();

    const result = createFeatureState(root, 'fresh');

    expect(result.ok).toBe(false);
    expect(result.text).toContain('config');
  });

  it('blocks creation when the next id overflows numbering.width', () => {
    const root = makeRoot();
    writeConfig(
      root,
      ['state:', '  active_path: ".pas/state/active"', '  archived_path: ".pas/state/archived"', '  numbering:', '    width: 1', ''].join('\n'),
    );
    addFeature(root, 'archived', '9-old', stateMd('9', 'old', 'completed'));

    const result = createFeatureState(root, 'overflow');

    expect(result.ok).toBe(false);
    expect(result.text).toContain('width');
  });
});

describe('archiveFeatureState', () => {
  it('moves the complete directory to the archive without renumbering or deleting', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    const dir = addFeature(root, 'active', '00002-my-feature', stateMd('00002', 'my-feature', 'completed'));
    touchFile(join(dir, 'notes.md'), 'keep me');
    const before = readFileSync(join(dir, 'state.md'), 'utf-8');

    const result = archiveFeatureState(root, '00002-my-feature');

    expect(result.ok).toBe(true);
    const destination = featureDir(root, 'archived', '00002-my-feature');
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(readFileSync(join(destination, 'state.md'), 'utf-8')).toBe(before);
    expect(readFileSync(join(destination, 'notes.md'), 'utf-8')).toBe('keep me');
    expect(result.text).toContain(`To: ${destination}`);
  });

  it('accepts an unambiguous numeric reference', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00003-numeric-ref', stateMd('00003', 'numeric-ref', 'active'));

    const result = archiveFeatureState(root, '00003');

    expect(result.ok).toBe(true);
    expect(existsSync(featureDir(root, 'archived', '00003-numeric-ref'))).toBe(true);
  });

  it('blocks references that are not in active', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'archived', '00004-already', stateMd('00004', 'already', 'completed'));

    const byName = archiveFeatureState(root, '00004-already');
    const byId = archiveFeatureState(root, '00009-missing');

    expect(byName.ok).toBe(false);
    expect(byName.text).toContain('not found in active');
    expect(byId.ok).toBe(false);
    expect(byId.text).toContain('not found in active');
  });

  it('blocks malformed and ambiguous references', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00005-alpha', stateMd('00005', 'alpha', 'active'));
    addFeature(root, 'active', '00005-beta', stateMd('00005', 'beta', 'active'));

    const malformed = archiveFeatureState(root, 'not-a-feature');
    const ambiguous = archiveFeatureState(root, '00005');

    expect(malformed.ok).toBe(false);
    expect(malformed.text).toContain('invalid feature reference');
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.text).toContain('ambiguous');
    expect(existsSync(featureDir(root, 'active', '00005-alpha'))).toBe(true);
  });

  it('blocks when the destination already exists in the archive', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00006-twin', stateMd('00006', 'twin', 'active'));
    addFeature(root, 'archived', '00006-twin', stateMd('00006', 'twin', 'completed'));

    const result = archiveFeatureState(root, '00006-twin');

    expect(result.ok).toBe(false);
    expect(result.text).toContain('already exists');
    expect(existsSync(featureDir(root, 'active', '00006-twin'))).toBe(true);
  });

  it('blocks when the id already exists in the archive under another slug', () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    addFeature(root, 'active', '00007-mine', stateMd('00007', 'mine', 'active'));
    addFeature(root, 'archived', '00007-other', stateMd('00007', 'other', 'completed'));

    const result = archiveFeatureState(root, '00007-mine');

    expect(result.ok).toBe(false);
    expect(result.text).toContain('archive');
    expect(existsSync(featureDir(root, 'active', '00007-mine'))).toBe(true);
  });

  it('blocks when the config is missing and leaves state untouched', () => {
    const root = makeRoot();
    addFeature(root, 'active', '00008-kept', stateMd('00008', 'kept', 'active'));

    const result = archiveFeatureState(root, '00008-kept');

    expect(result.ok).toBe(false);
    expect(result.text).toContain('config');
    expect(existsSync(featureDir(root, 'active', '00008-kept'))).toBe(true);
  });
});

describe('pas_toolkit plugin surface', () => {
  it('exposes the harness-only tool definition', async () => {
    const tool = await captureTool();

    expect(pasToolkit.id).toBe('pas-toolkit');
    expect(tool.name).toBe(TOOL_NAME);
    expect(tool.name).toBe('pas_toolkit');
    expect(tool.description).toBe(TOOL_DESCRIPTION);
    expect(tool.description).toContain('For PAS harness agents only.');
    expect(tool.input).toEqual({
      type: 'object',
      properties: {
        operation: { enum: ['init', 'list', 'check', 'new', 'archive'] },
        project: { type: 'string' },
        confirm: { type: 'boolean' },
        slug: { type: 'string' },
        feature: { type: 'string' },
        root: { type: 'string' },
      },
      required: ['operation'],
      additionalProperties: false,
    });
    expect(TOOL_INPUT_SCHEMA).toEqual(tool.input);
    expect(typeof tool.execute).toBe('function');
  });

  it('defaults the workspace to ctx.location.directory', async () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    const tool = await captureTool(root);

    const result = await tool.execute({ operation: 'list' });

    expect(result.content).toContain(`Workspace: ${root}`);
    expect(result.content).toContain('Active (0/1):');
  });

  it('supports preview and confirmed init through the registered tool', async () => {
    const root = makeRoot();
    const tool = await captureTool(root);

    const preview = await tool.execute({ operation: 'init', project: 'sample-app' });
    expect(preview.content).toContain('NO FILES WRITTEN');
    expect(preview.content).toContain(`Workspace: ${root}`);
    expect(existsSync(join(root, '.pas/pas.config.yaml'))).toBe(false);

    const created = await tool.execute({ operation: 'init', project: 'sample-app', confirm: true });
    expect(created.content).toContain('Created PAS project config:');
    expect(created.content).toContain(`Workspace: ${root}`);
    expect(readFileSync(join(root, '.pas/pas.config.yaml'), 'utf-8')).toContain('product: sample-app');

    const second = await tool.execute({ operation: 'init', confirm: true });
    expect(second.content).toContain('refusing to overwrite');
  });

  it('lets input.root override the workspace', async () => {
    const ctxRoot = makeRoot();
    const otherRoot = makeRoot();
    writeConfig(otherRoot, BASE_CONFIG);
    const tool = await captureTool(ctxRoot);

    const result = await tool.execute({ operation: 'list', root: otherRoot });

    expect(result.content).toContain(`Workspace: ${otherRoot}`);
    expect(result.content).not.toContain(`Workspace: ${ctxRoot}`);
  });

  it('includes the workspace on every successful operation', async () => {
    const root = makeRoot();
    writeConfig(root, BASE_CONFIG);
    const tool = await captureTool(root);

    const check = await tool.execute({ operation: 'check' });
    expect(check.content).toContain('ok: true');
    expect(check.content).toContain(`Workspace: ${root}`);

    const created = await tool.execute({ operation: 'new', slug: 'flow' });
    expect(created.content).toContain('Created 00001-flow');
    expect(created.content).toContain(`Workspace: ${root}`);

    const archived = await tool.execute({ operation: 'archive', feature: '00001' });
    expect(archived.content).toContain('Archived 00001-flow');
    expect(archived.content).toContain(`Workspace: ${root}`);
  });

  it('never throws: unknown operations return an ERROR line with the workspace', async () => {
    const root = makeRoot();
    const tool = await captureTool(root);

    const result = await tool.execute({ operation: 'bogus' });

    expect(result.content).toContain('ERROR:');
    expect(result.content).toContain(`Workspace: ${root}`);
  });

  it('never throws on missing or malformed input', async () => {
    const root = makeRoot();
    const tool = await captureTool(root);

    const missing = await tool.execute(undefined);
    const malformed = await tool.execute({ operation: 42 });

    expect(missing.content).toContain('ERROR:');
    expect(malformed.content).toContain('ERROR:');
    expect(missing.content).toContain('Workspace: ');
    expect(malformed.content).toContain('Workspace: ');
  });

  it('stays graceful when the workspace path is not a directory', async () => {
    const root = makeRoot();
    const filePath = join(root, 'plain.txt');
    writeFileSync(filePath, 'not a directory');
    const tool = await captureTool();

    const result = await tool.execute({ operation: 'list', root: filePath });

    expect(result.content).toContain(`Workspace: ${filePath}`);
    expect(result.content).toContain('Active (0/1):');
  });
});
