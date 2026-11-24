import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'bun';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const TMP_ROOT = '/tmp/opencode';
const CLI_ENTRY = 'src/cli/index.ts';

const PAS_AGENT_FILES = [
  'Pulsar Agent Squad.md',
  'Pulsar Agent Turbo.md',
  'pas_developer.md',
  'pas_qa.md',
  'pas_researcher.md',
];

const V2_AGENT = [
  '---',
  'description: "Fixture primary"',
  'mode: primary',
  'permissions:',
  '  - action: read',
  '    resource: "*"',
  '    effect: allow',
  '  - action: shell',
  '    resource: "*"',
  '    effect: allow',
  '  - action: webfetch',
  '    resource: "*"',
  '    effect: deny',
  '---',
  'fixture body',
  '',
].join('\n');

let home = '';
let storePath = '';

function env(): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    PAS_OPENCODE_CONFIG_PATH: join(home, 'missing-opencode.json'),
  };
}

function run(cwd: string, args: string[]) {
  return spawnSync(['bun', 'run', CLI_ENTRY, ...args], { cwd, env: env() });
}

function makeTmp(prefix: string): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, prefix));
}

function bytes(files: string[]): Buffer[] {
  return files.map((file) => readFileSync(file));
}

beforeAll(() => {
  home = makeTmp('pas-tool-build-home-');
  storePath = join(home, '.config/opencode/pas/policies.json');
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(
    storePath,
    JSON.stringify({
      version: 1,
      agents: {
        'Pulsar Agent Squad': { tools: ['webfetch'] },
        'Pulsar Agent Turbo': { tools: ['shell'] },
        pas_researcher: { tools: ['webfetch'] },
        pas_developer: { tools: ['shell'] },
        pas_qa: { tools: ['edit'] },
      },
    }),
  );
});

afterAll(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('OpenCode tool policy build: the five legacy agents', () => {
  it('injects legacy-map denies into every generated legacy agent', () => {
    const result = run(REPO_ROOT, ['build', '--target=opencode']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toContain('V1 permission block');

    const dist = join(REPO_ROOT, 'dist/platforms/opencode/agents');
    const contents = new Map(
      PAS_AGENT_FILES.map((file) => [
        file,
        readFileSync(join(dist, file), 'utf8'),
      ]),
    );

    // Every real agent uses `permission:` (V1 map); no native list is mixed in.
    for (const file of PAS_AGENT_FILES) {
      const content = contents.get(file)!;
      expect(content).not.toContain('\npermissions:');
      expect(content).not.toContain('  - action:');
    }

    const squad = contents.get('Pulsar Agent Squad.md')!;
    expect(squad).toMatch(/^ {2}webfetch: deny$/m);
    expect(squad).toContain('    "docs/**": allow');
    expect(squad).toContain('    "git status": allow');
    expect(squad).not.toMatch(/^ {2}webfetch: allow$/m);

    const turbo = contents.get('Pulsar Agent Turbo.md')!;
    expect(turbo).toMatch(/^ {2}bash: deny$/m);
    expect(turbo).toContain('    "pas_qa": allow');

    const researcher = contents.get('pas_researcher.md')!;
    expect(researcher).toMatch(/^ {2}webfetch: deny$/m);
    expect(researcher).toMatch(/^ {2}bash:$/m);
    expect(researcher).toContain('    "*": allow');
    expect(researcher).toMatch(/^ {4}"rm \*": deny$/m);
    expect(researcher).toMatch(/^ {2}task: deny$/m);

    const developer = contents.get('pas_developer.md')!;
    expect(developer).toMatch(/^ {2}bash: deny$/m);
    expect(developer).toContain('    "specs/**/*.feature": deny');
    expect(developer).toMatch(/^ {2}skill: allow$/m);

    const qa = contents.get('pas_qa.md')!;
    expect(qa).toMatch(/^ {2}patch: deny$/m);
    expect(qa).toMatch(/^ {2}edit: deny$/m);
    expect(qa).toMatch(/^ {2}write: deny$/m);
    expect(qa).toMatch(/^ {2}task: deny$/m);
  });

  it('is byte-identical across repeated builds', () => {
    const dist = join(REPO_ROOT, 'dist/platforms/opencode/agents');
    const paths = PAS_AGENT_FILES.map((file) => join(dist, file));
    const first = bytes(paths);

    const second = run(REPO_ROOT, ['build', '--target=opencode']);
    expect(second.exitCode).toBe(0);
    expect(bytes(paths)).toEqual(first);
  });

  it('fails with an invalid store before writing output', () => {
    const dist = join(REPO_ROOT, 'dist/platforms/opencode/agents');
    const before = bytes(PAS_AGENT_FILES.map((file) => join(dist, file)));
    const valid = readFileSync(storePath);
    writeFileSync(storePath, '{bad');
    try {
      const result = run(REPO_ROOT, ['build', '--target=opencode']);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain(storePath);
      expect(result.stderr.toString()).toMatch(/Malformed JSON/);
      expect(bytes(PAS_AGENT_FILES.map((file) => join(dist, file)))).toEqual(
        before,
      );
    } finally {
      writeFileSync(storePath, valid);
    }
  });
});

describe('OpenCode tool policy build: native V2 fixture', () => {
  let fixture = '';
  let fixtureHome = '';

  function fixtureEnv(): Record<string, string | undefined> {
    return {
      ...process.env,
      HOME: fixtureHome,
      XDG_CONFIG_HOME: join(fixtureHome, '.config'),
      PAS_OPENCODE_CONFIG_PATH: join(fixtureHome, 'missing-opencode.json'),
    };
  }

  beforeAll(() => {
    fixture = makeTmp('pas-tool-build-v2-repo-');
    fixtureHome = join(fixture, 'home');

    cpSync(join(REPO_ROOT, 'src/cli'), join(fixture, 'src/cli'), {
      recursive: true,
    });
    cpSync(join(REPO_ROOT, 'config'), join(fixture, 'config'), {
      recursive: true,
    });
    cpSync(join(REPO_ROOT, 'package.json'), join(fixture, 'package.json'));
    symlinkSync(
      join(REPO_ROOT, 'node_modules'),
      join(fixture, 'node_modules'),
      'dir',
    );

    mkdirSync(join(fixture, 'src/agents'), { recursive: true });
    mkdirSync(join(fixture, 'src/tools'), { recursive: true });
    writeFileSync(join(fixture, 'src/tools/pas-toolkit.ts'), '// fixture\n');
    writeFileSync(
      join(fixture, 'src/agents/Pulsar Agent Squad.md'),
      V2_AGENT,
    );

    const path = join(fixtureHome, '.config/opencode/pas/policies.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        agents: {
          'Pulsar Agent Squad': { tools: ['shell', 'webfetch', 'edit'] },
        },
      }),
    );
  });

  afterAll(() => {
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  it('appends native denies and preserves existing native rules', () => {
    const result = spawnSync(
      ['bun', 'run', CLI_ENTRY, 'build', '--target=opencode'],
      { cwd: fixture, env: fixtureEnv() },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).not.toContain('V1 permission block');

    const path = join(
      fixture,
      'dist/platforms/opencode/agents/Pulsar Agent Squad.md',
    );
    const built = readFileSync(path, 'utf8');

    expect(built).toContain(
      '  - action: read\n    resource: "*"\n    effect: allow',
    );
    // shell exists with allow, so the deny is appended after it.
    expect(built.match(/  - action: shell\n/g)).toHaveLength(2);
    expect(built).toContain(
      '  - action: shell\n    resource: "*"\n    effect: deny',
    );
    // Already denied: no duplicate rule.
    expect(built.match(/  - action: webfetch\n/g)).toHaveLength(1);
    // No native deny for edit existed, so one is appended.
    expect(built).toContain(
      '  - action: edit\n    resource: "*"\n    effect: deny',
    );
    expect(built.indexOf('  - action: shell\n    resource: "*"\n    effect: allow')).toBeLessThan(
      built.indexOf('  - action: shell\n    resource: "*"\n    effect: deny'),
    );
    expect(built).not.toContain('permission:\n');
  });

  it('is byte-identical across repeated native builds', () => {
    const path = join(
      fixture,
      'dist/platforms/opencode/agents/Pulsar Agent Squad.md',
    );
    const first = readFileSync(path);
    const second = spawnSync(
      ['bun', 'run', CLI_ENTRY, 'build', '--target=opencode'],
      { cwd: fixture, env: fixtureEnv() },
    );
    expect(second.exitCode).toBe(0);
    expect(readFileSync(path)).toEqual(first);
  });
});

describe('OpenCode tool policy build: researcher shell override', () => {
  let fixture = '';
  let fixtureHome = '';

  function fixtureEnv(): Record<string, string | undefined> {
    return {
      ...process.env,
      HOME: fixtureHome,
      XDG_CONFIG_HOME: join(fixtureHome, '.config'),
      PAS_OPENCODE_CONFIG_PATH: join(fixtureHome, 'missing-opencode.json'),
    };
  }

  function build() {
    return spawnSync(['bun', 'run', CLI_ENTRY, 'build', '--target=opencode'], {
      cwd: fixture,
      env: fixtureEnv(),
    });
  }

  beforeAll(() => {
    fixture = makeTmp('pas-tool-build-researcher-repo-');
    fixtureHome = join(fixture, 'home');

    cpSync(join(REPO_ROOT, 'src'), join(fixture, 'src'), { recursive: true });
    cpSync(join(REPO_ROOT, 'config'), join(fixture, 'config'), {
      recursive: true,
    });
    cpSync(join(REPO_ROOT, 'package.json'), join(fixture, 'package.json'));
    symlinkSync(
      join(REPO_ROOT, 'node_modules'),
      join(fixture, 'node_modules'),
      'dir',
    );
    mkdirSync(join(fixtureHome, '.config/opencode/pas'), { recursive: true });
  });

  afterAll(() => {
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  it('replaces the hybrid map with one shell deny and leaves other profiles unchanged', () => {
    const dist = join(fixture, 'dist/platforms/opencode/agents');

    const baseline = build();
    expect(baseline.exitCode).toBe(0);
    expect(baseline.stderr.toString()).not.toContain('V1 permission block');
    const before = new Map(
      PAS_AGENT_FILES.map((file) => [file, readFileSync(join(dist, file))]),
    );

    const baselineResearcher = before.get('pas_researcher.md')!.toString();
    expect(baselineResearcher).toMatch(/^ {2}bash:$/m);
    expect(baselineResearcher).toContain('    "*": allow');
    expect(baselineResearcher).toMatch(/^ {4}"rm \*": deny$/m);

    writeFileSync(
      join(fixtureHome, '.config/opencode/pas/policies.json'),
      JSON.stringify({
        version: 1,
        agents: { pas_researcher: { tools: ['shell'] } },
      }),
    );

    const blocked = build();
    expect(blocked.exitCode).toBe(0);

    const researcher = readFileSync(join(dist, 'pas_researcher.md'), 'utf8');
    expect(researcher.match(/^ {2}bash:/gm)).toHaveLength(1);
    expect(researcher).toMatch(/^ {2}bash: deny$/m);
    expect(researcher).not.toContain('    "*": allow');
    expect(researcher).not.toContain('    "rm *": deny');
    expect(researcher).toMatch(/^ {2}edit: deny$/m);
    expect(researcher).toMatch(/^ {2}write: deny$/m);
    expect(researcher).toMatch(/^ {2}task: deny$/m);

    for (const file of PAS_AGENT_FILES) {
      if (file === 'pas_researcher.md') continue;
      expect(readFileSync(join(dist, file))).toEqual(before.get(file)!);
    }
  });
});
