import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { buildManifestEntry } from '../../src/cli/lib/build-target';
import { parseManifest } from '../../src/cli/lib/manifest';
import { parsePiPackages } from '../../src/cli/lib/pi-packages';
import { isPiPackageListed } from '../../src/cli/commands/install';
import { isPiPackageListed as isPiPackageListedFromModule } from '../../src/cli/lib/pi-plugins';
import pasToolkitExtension from '../../src/tools/pi/pas-toolkit/index.ts';

type AgentFile = {
  frontmatter: Record<string, string>;
  body: string;
  raw: string;
};

function readAgent(file: string): AgentFile {
  const raw = readFileSync(`src/agents/pi/${file}`, 'utf-8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`${file} is not frontmatter plus body`);
  }
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf(':');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    frontmatter[key] = value;
  }
  return { frontmatter, body: match[2], raw };
}

function toolList(agent: AgentFile): string[] {
  const tools = agent.frontmatter.tools ?? '';
  return tools
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function readSkill(name: string): AgentFile {
  const raw = readFileSync(`src/skills/pi/${name}/SKILL.md`, 'utf-8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`${name}/SKILL.md is not frontmatter plus body`);
  }
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf(':');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    frontmatter[key] = value;
  }
  return { frontmatter, body: match[2], raw };
}

describe('parsePiPackages', () => {
  it('returns only active package sources in input order', () => {
    const text = [
      '# Pi packages for PAS',
      '',
      'npm:pi-subagents',
      'npm:pi-web-access',
      '',
      '# optional',
      '# npm:diffing',
    ].join('\n');

    expect(parsePiPackages(text)).toEqual(['npm:pi-subagents', 'npm:pi-web-access']);
  });

  it('ignores blank lines and comment lines', () => {
    const text = '\n# comment\n   \n  # indented comment\nnpm:pi-subagents\n';
    expect(parsePiPackages(text)).toEqual(['npm:pi-subagents']);
  });

  it('trims surrounding whitespace from active entries', () => {
    const text = '  npm:pi-subagents  \n\t npm:pi-web-access\t\n';
    expect(parsePiPackages(text)).toEqual(['npm:pi-subagents', 'npm:pi-web-access']);
  });

  it('drops duplicates while keeping the first occurrence', () => {
    const text = ['npm:pi-subagents', 'npm:pi-web-access', 'npm:pi-subagents'].join('\n');
    expect(parsePiPackages(text)).toEqual(['npm:pi-subagents', 'npm:pi-web-access']);
  });

  it('handles CRLF line endings', () => {
    const text = 'npm:pi-subagents\r\n# npm:diffing\r\nnpm:pi-web-access\r\n';
    expect(parsePiPackages(text)).toEqual(['npm:pi-subagents', 'npm:pi-web-access']);
  });

  it('returns an empty list for empty or comment-only input', () => {
    expect(parsePiPackages('')).toEqual([]);
    expect(parsePiPackages('# only a comment\n\n# another')).toEqual([]);
  });
});

describe('@unit isPiPackageListed', () => {
  // Captured from the real, read-only `pi list` command in this environment.
  const REAL_PI_LIST_OUTPUT = `User packages:
  npm:pi-subagents
    /home/gabrielmoran/.pi/agent/npm/node_modules/pi-subagents
  npm:@juicesharp/rpiv-ask-user-question
    /home/gabrielmoran/.pi/agent/npm/node_modules/@juicesharp/rpiv-ask-user-question
  npm:pi-workspace-history
    /home/gabrielmoran/.pi/agent/npm/node_modules/pi-workspace-history
`;

  it('matches the exact configured source on a real pi list line', () => {
    expect(isPiPackageListed('npm:pi-subagents', REAL_PI_LIST_OUTPUT)).toBe(true);
    expect(isPiPackageListed('npm:pi-workspace-history', REAL_PI_LIST_OUTPUT)).toBe(true);
  });

  it('does not match a package that is not configured', () => {
    expect(isPiPackageListed('npm:pi-web-access', REAL_PI_LIST_OUTPUT)).toBe(false);
  });

  it('does not match a longer package name that merely starts with the source', () => {
    const output = 'User packages:\n  npm:pi-subagents-extra\n';
    expect(isPiPackageListed('npm:pi-subagents', output)).toBe(false);
  });

  it('does not match a filesystem path line that contains the package name', () => {
    const output = 'User packages:\n    /home/user/.pi/agent/npm/node_modules/pi-subagents\n';
    expect(isPiPackageListed('npm:pi-subagents', output)).toBe(false);
  });

  it('matches a bare package-name line when it clearly names the configured package', () => {
    expect(isPiPackageListed('npm:pi-subagents', 'User packages:\n  pi-subagents\n')).toBe(true);
  });

  it('matches bullet-prefixed lines and scoped package names', () => {
    expect(isPiPackageListed('npm:pi-subagents', '- npm:pi-subagents\n')).toBe(true);
    expect(
      isPiPackageListed(
        'npm:@juicesharp/rpiv-ask-user-question',
        REAL_PI_LIST_OUTPUT,
      ),
    ).toBe(true);
  });

  it('returns false for empty output or an empty source', () => {
    expect(isPiPackageListed('npm:pi-subagents', '')).toBe(false);
    expect(isPiPackageListed('', REAL_PI_LIST_OUTPUT)).toBe(false);
  });
});

describe('@unit pi-plugins module', () => {
  it('exports the same matching helper that install.ts re-exports', () => {
    expect(isPiPackageListedFromModule).toBe(isPiPackageListed);
    expect(
      isPiPackageListedFromModule('npm:pi-subagents', 'User packages:\n  npm:pi-subagents\n'),
    ).toBe(true);
  });
});

describe('Pi target manifest entries', () => {
  it('declares Pi entries for agents, skills, settings, and the toolkit extension', () => {
    const entries = parseManifest();
    const piEntries = entries.filter((e) => e.target === 'pi');

    expect(piEntries).toHaveLength(4);

    const agents = piEntries.find((e) => e.kind === 'dir' && e.installPath === '.pi/agent/agents');
    expect(agents).toBeDefined();
    expect(agents!.source).toBe('src/agents/pi');
    expect(agents!.distPath).toBe('platforms/pi/agents');

    const skills = piEntries.find((e) => e.kind === 'dir' && e.installPath === '.pi/agent/skills');
    expect(skills).toBeDefined();
    expect(skills!.source).toBe('src/skills/pi');
    expect(skills!.distPath).toBe('platforms/pi/skills');

    const settings = piEntries.find((e) => e.kind === 'file');
    expect(settings).toBeDefined();
    expect(settings!.source).toBe('src/templates/platforms/pi/settings.snippet.json');
    expect(settings!.distPath).toBe('platforms/pi/settings.snippet.json');
    expect(settings!.installPath).toBe('.pi/agent/pas-settings.snippet.json');

    const toolkit = piEntries.find(
      (e) => e.kind === 'dir' && e.installPath === '.pi/agent/extensions/pas-toolkit',
    );
    expect(toolkit).toBeDefined();
    expect(toolkit!.source).toBe('src/tools/pi/pas-toolkit');
    expect(toolkit!.distPath).toBe('platforms/pi/extensions/pas-toolkit');
  });

  it('keeps every Pi install path under the home Pi agent directory', () => {
    const piEntries = parseManifest().filter((e) => e.target === 'pi');
    piEntries.forEach((e) => {
      expect(e.installPath.startsWith('.pi/agent/')).toBe(true);
    });
  });

  it('keeps existing targets unchanged', () => {
    const entries = parseManifest();
    expect(entries).toHaveLength(13);

    const opencode = entries.find((e) => e.target === 'opencode' && e.kind === 'dir');
    expect(opencode).toBeDefined();
    expect(opencode!.source).toBe('src/agents');
    expect(opencode!.installPath).toBe('.config/opencode/agents');

    const cursor = entries.find((e) => e.target === 'cursor');
    expect(cursor).toBeDefined();
    expect(cursor!.kind).toBe('file');
    expect(cursor!.installPath).toBe('.cursor/agents');
  });
});

describe('@unit Pi agents keep their native frontmatter', () => {
  it('builds byte-identical agents without injected permission rules into a temporary output directory', () => {
    const agentsEntry = parseManifest().find(
      (entry) =>
        entry.target === 'pi' &&
        entry.kind === 'dir' &&
        entry.installPath === '.pi/agent/agents',
    );
    expect(agentsEntry).toBeDefined();

    const outputRoot = mkdtempSync(join(tmpdir(), 'pas-pi-unit-build-'));
    try {
      const distRoot = join(process.cwd(), 'dist');
      const relativeDistPath = relative(distRoot, join(outputRoot, 'agents'));
      buildManifestEntry({ ...agentsEntry!, distPath: relativeDistPath });

      for (const name of ['pas_researcher.md', 'pas_developer.md', 'pas_qa.md']) {
        const built = readFileSync(join(outputRoot, 'agents', name));
        const source = readFileSync(join(process.cwd(), 'src/agents/pi', name));

        // The Pi target must copy agent prompts byte-for-byte: no OpenCode
        // skill-policy injection and no native frontmatter rewrite.
        expect(built.equals(source)).toBe(true);

        const raw = built.toString('utf-8');
        expect(raw).not.toContain('permission:');
        expect(raw).not.toContain('permission.skill');
      }
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});

describe('@unit Toolkit extension registers the five operations', () => {
  it('registers one pas_toolkit tool whose schema accepts all five operations', () => {
    type CapturedTool = {
      name: string;
      description: string;
      parameters: {
        properties: { operation: { enum: readonly string[] } };
        required: readonly string[];
        additionalProperties: boolean;
      };
    };
    const registered: CapturedTool[] = [];
    const stubPi = {
      registerTool(definition: CapturedTool) {
        registered.push(definition);
      },
    };

    pasToolkitExtension(stubPi);

    expect(registered).toHaveLength(1);
    const [tool] = registered;
    expect(tool.name).toBe('pas_toolkit');
    expect(tool.description.length).toBeGreaterThan(0);

    const operations = tool.parameters.properties.operation.enum;
    expect(operations).toEqual(['init', 'list', 'check', 'new', 'archive']);
    expect(tool.parameters.required).toContain('operation');
    expect(tool.parameters.additionalProperties).toBe(false);

    const accepts = (operation: string) => operations.includes(operation);
    for (const operation of ['init', 'list', 'check', 'new', 'archive']) {
      expect(accepts(operation)).toBe(true);
    }
    expect(accepts('unknown')).toBe(false);
  });

  it('declares the pi toolkit extension entry with kind dir and expected paths', () => {
    const toolkit = parseManifest().find(
      (entry) => entry.target === 'pi' && entry.source === 'src/tools/pi/pas-toolkit',
    );
    expect(toolkit).toBeDefined();
    expect(toolkit!.kind).toBe('dir');
    expect(toolkit!.distPath).toBe('platforms/pi/extensions/pas-toolkit');
    expect(toolkit!.installPath).toBe('.pi/agent/extensions/pas-toolkit');
  });
});

describe('@contract Worker tool allowlists match each role', () => {
  const agents = ['pas_researcher', 'pas_developer', 'pas_qa'] as const;

  it('parses every agent as frontmatter plus a non-empty body', () => {
    for (const name of agents) {
      const agent = readAgent(`${name}.md`);
      expect(agent.frontmatter.name).toBe(name);
      expect(agent.frontmatter.description?.length).toBeGreaterThan(0);
      expect(agent.body.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps researcher read-only: no write, edit, or bash tools', () => {
    const tools = toolList(readAgent('pas_researcher.md'));
    expect(tools).not.toContain('write');
    expect(tools).not.toContain('edit');
    expect(tools).not.toContain('bash');
  });

  it('keeps QA without write or edit but allows bash for read-only verification', () => {
    const tools = toolList(readAgent('pas_qa.md'));
    expect(tools).not.toContain('write');
    expect(tools).not.toContain('edit');
    expect(tools).toContain('bash');
  });

  it('gives the developer edit, write, and bash', () => {
    const tools = toolList(readAgent('pas_developer.md'));
    expect(tools).toContain('edit');
    expect(tools).toContain('write');
    expect(tools).toContain('bash');
  });

  it('declares acceptanceRole and a positive timeoutMs on every agent', () => {
    for (const name of agents) {
      const { frontmatter } = readAgent(`${name}.md`);
      expect(frontmatter.acceptanceRole?.length).toBeGreaterThan(0);
      const timeout = Number(frontmatter.timeoutMs);
      expect(Number.isFinite(timeout)).toBe(true);
      expect(timeout).toBeGreaterThan(0);
    }
  });

  it('removes OpenCode permission blocks and todowrite', () => {
    for (const name of agents) {
      const { raw } = readAgent(`${name}.md`);
      expect(raw).not.toContain('permission:');
      expect(raw).not.toContain('todowrite');
    }
  });

  it('preserves each XML report root element in the body', () => {
    const roots = {
      pas_researcher: '<research_report>',
      pas_developer: '<implementation_report>',
      pas_qa: '<qa_verdict>',
    } as const;
    for (const name of agents) {
      expect(readAgent(`${name}.md`).body).toContain(roots[name]);
    }
  });
});

describe('@unit Settings snippet is valid and scoped', () => {
  const settings = JSON.parse(
    readFileSync('src/templates/platforms/pi/settings.snippet.json', 'utf-8'),
  ) as Record<string, unknown>;

  // Documented settings-level `subagents` keys from pi-subagents@0.83.1.
  const DOCUMENTED_SUBAGENTS_KEYS = new Set([
    'projectRootResolution',
    'agentScanDirs',
    'agentExcludeDirs',
    'defaultModel',
    'defaultProvider',
    'defaultThinking',
    'defaultExtensions',
    'defaultSubagentOnlyExtensions',
    'agentOverrides',
    'machines',
    'modelScope',
    'disableThinking',
    'disableBuiltins',
    'watchdog',
  ]);

  it('parses as a JSON object with exactly one top-level key', () => {
    expect(settings).not.toBeNull();
    expect(typeof settings).toBe('object');
    expect(Array.isArray(settings)).toBe(false);
    expect(Object.keys(settings)).toEqual(['subagents']);
  });

  it('keeps every subagents key documented and copy-safe', () => {
    const subagents = settings.subagents;
    expect(subagents).not.toBeNull();
    expect(typeof subagents).toBe('object');
    expect(Array.isArray(subagents)).toBe(false);
    expect(Object.keys(subagents as Record<string, unknown>)).toEqual([]);
    for (const key of Object.keys(subagents as Record<string, unknown>)) {
      expect(DOCUMENTED_SUBAGENTS_KEYS.has(key)).toBe(true);
    }
  });
});

describe('@contract Primary-mode skills preserve PAS invariants', () => {
  const skills = ['pas-lead', 'pas-turbo'] as const;
  const approvalSentence =
    'Implementation plan is ready. Do you want me to apply it now?';
  const workerNames = ['pas_researcher', 'pas_developer', 'pas_qa'];

  it('keeps the approval sentence verbatim in both Pi skills and both OpenCode prompt sources', () => {
    const openCodeSources = [
      'src/agents/Pulsar Agent Squad.md',
      'src/agents/Pulsar Agent Turbo.md',
    ];
    for (const name of skills) {
      expect(readSkill(name).body).toContain(approvalSentence);
    }
    for (const source of openCodeSources) {
      expect(readFileSync(source, 'utf-8')).toContain(approvalSentence);
    }
  });

  for (const name of skills) {
    describe(name, () => {
      const skill = readSkill(name);

      it('parses as Agent Skills frontmatter plus a non-empty body', () => {
        expect(skill.frontmatter.name).toBe(name);
        expect(skill.frontmatter.description?.length).toBeGreaterThan(0);
        expect(skill.frontmatter.description?.length).toBeLessThanOrEqual(1024);
        expect(skill.frontmatter['disable-model-invocation']).toBe('true');
        expect(skill.body.trim().length).toBeGreaterThan(0);
      });

      it('contains the exact approval sentence verbatim', () => {
        expect(skill.body).toContain(approvalSentence);
      });

      it('names only the three PAS workers as delegation targets', () => {
        for (const worker of workerNames) {
          expect(skill.body).toContain(worker);
        }
        const referenced = new Set(skill.body.match(/pas_(?!toolkit)[a-z_]+/g) ?? []);
        expect([...referenced].sort()).toEqual([...workerNames].sort());
      });

      it('marks the approval gate, TDD, single verdict, and state discipline', () => {
        expect(skill.body.toLowerCase()).toContain('approval');
        expect(skill.body).toMatch(/TDD|Red → Green → Refactor|Red, Green, Refactor/);
        expect(skill.body.toLowerCase()).toContain('verdict');
        expect(skill.body).toContain('.pas/state');
        expect(skill.body).toContain('pas_toolkit');
      });

      it('replaces OpenCode mechanics with Pi mechanics', () => {
        expect(skill.raw).not.toContain('OpenCode');
        expect(skill.raw).not.toContain('permission.skill');
        expect(skill.body).toContain('/skill:');
        expect(skill.body).toContain('subagent');
      });
    });
  }
});
