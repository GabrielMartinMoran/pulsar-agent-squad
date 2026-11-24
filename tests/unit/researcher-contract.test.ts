import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

const researcher = readFileSync('src/agents/pas_researcher.md', 'utf-8');
const flatResearcher = researcher.replace(/\s+/g, ' ');
const frontmatter = researcher.split('---')[1] ?? '';
const squad = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');
const report =
  researcher.split('<research_report>')[1]?.split('</research_report>')[0] ?? '';

const FILE_MUTATIONS = [
  'rm',
  'mv',
  'cp',
  'rmdir',
  'mkdir',
  'touch',
  'tee',
  'chmod',
  'chown',
  'patch',
  'sed -i',
  'ln',
  'truncate',
];

const GIT_MUTATIONS = [
  'git apply',
  'git add',
  'git commit',
  'git push',
  'git pull',
  'git fetch',
  'git checkout',
  'git switch',
  'git reset',
  'git restore',
  'git clean',
  'git stash',
  'git merge',
  'git rebase',
  'git cherry-pick',
  'git revert',
];

const DEPENDENCY_MUTATIONS = [
  'bun install',
  'npm install',
  'pnpm install',
  'yarn install',
  'pip install',
  'npm ci',
  'bun add',
  'pnpm add',
  'yarn add',
];

const EXPECTED_DENY_PATTERNS = [
  ...FILE_MUTATIONS,
  ...GIT_MUTATIONS,
  ...DEPENDENCY_MUTATIONS,
].map((command) => `${command} *`);

function bashRules(): Array<{ pattern: string; effect: string }> {
  const lines = frontmatter.split('\n');
  const start = lines.indexOf('  bash:');
  if (start < 0) return [];

  const rules: Array<{ pattern: string; effect: string }> = [];
  for (let i = start + 1; i < lines.length; i++) {
    const match = /^ {4}"([^"]+)":\s*(allow|deny|ask)$/.exec(lines[i]);
    if (!match) break;
    rules.push({ pattern: match[1], effect: match[2] });
  }
  return rules;
}

const rules = bashRules();

describe('A2: researcher answer, coverage, limits and closure', () => {
  it('leads with a direct grounded answer instead of only raw findings', () => {
    expect(report).toContain('<answer>');
    expect(flatResearcher).toContain('Lead with a direct, grounded answer');
    expect(flatResearcher).toContain('A report with abundant facts but no answer is incomplete');
  });

  it('reports coverage and cited evidence', () => {
    expect(report).toContain('<coverage>');
    expect(report).toContain('<facts>');
    expect(report).toContain('<sources_consulted>');
    expect(report).toContain('<source_exhaustion>');
  });

  it('states limits and an explicit closure status', () => {
    expect(report).toContain('<limits>');
    expect(report).toMatch(/<closure>COMPLETE \| PARTIAL \| BLOCKED/);
    expect(flatResearcher).toContain('`COMPLETE`');
    expect(flatResearcher).toContain('`PARTIAL`');
    expect(flatResearcher).toContain('`BLOCKED`');
  });

  it('distinguishes source inspection from commands actually run', () => {
    expect(flatResearcher).toContain('Source inspection is not a live run');
    expect(flatResearcher).toContain('Never claim to have run commands');
    expect(flatResearcher).toContain(
      'Cite each command you ran with its actual result',
    );
    expect(frontmatter).toMatch(/^ {2}edit: deny$/m);
    expect(frontmatter).toMatch(/^ {2}write: deny$/m);
  });
});

describe('A2: researcher shell use is inspection-only', () => {
  it('prefers dedicated inspection tools and narrow shell checks', () => {
    expect(flatResearcher).toContain('Prefer dedicated inspection tools');
    expect(flatResearcher).toContain(
      'Use shell only for narrowly scoped inspection',
    );
  });

  it('forbids writes, state changes, installs, service changes and unclear effects', () => {
    expect(flatResearcher).toContain(
      'Do not write files or caches, change Git state, install dependencies, alter services, or run programs with unclear side effects',
    );
  });

  it('reports denials or uncertainty instead of trying another route', () => {
    expect(flatResearcher).toContain(
      'If a command is denied, its effects are uncertain, or the work needs mutation, report the gap; do not rephrase the command or try another route',
    );
  });
});

describe('A4: researcher hybrid shell policy', () => {
  it('allows shell by default before the explicit deny rules', () => {
    expect(frontmatter).toMatch(/^ {2}bash:$/m);
    expect(rules[0]).toEqual({ pattern: '*', effect: 'allow' });
    expect(rules.slice(1).every((rule) => rule.effect === 'deny')).toBe(true);
    expect(frontmatter).not.toContain('bash: deny');
  });

  it('denies the complete initial file, Git and dependency mutation set in order', () => {
    expect(rules.map((rule) => rule.pattern)).toEqual([
      '*',
      ...EXPECTED_DENY_PATTERNS,
    ]);
  });

  it('adds no ask rule and no whole-command sed ban', () => {
    const patterns = rules.map((rule) => rule.pattern);
    expect(rules.some((rule) => rule.effect === 'ask')).toBe(false);
    expect(patterns).not.toContain('sed');
    expect(patterns).not.toContain('sed *');
    expect(patterns).toContain('sed -i *');
  });

  it('keeps the legacy permission map and unrelated entries intact', () => {
    expect(frontmatter).not.toContain('permissions:');
    expect(frontmatter).not.toContain('shell: allow');
    const permissionLines = frontmatter.split('\n');
    for (const entry of [
      '"*": allow',
      'edit: deny',
      'write: deny',
      'task: deny',
      'question: deny',
      'todowrite: deny',
      'skill: allow',
      'read: allow',
      'glob: allow',
      'grep: allow',
      'list: allow',
      'websearch: allow',
      'webfetch: allow',
    ]) {
      expect(permissionLines).toContain(`  ${entry}`);
    }
  });
});

describe('A4: Squad routing permits inspection without authorizing mutation', () => {
  const flatSquad = squad.replace(/\s+/g, ' ');

  it('routes bounded shell inspection to the researcher', () => {
    expect(flatSquad).toContain('bounded shell inspection');
    expect(flatSquad).toContain(
      'Its shell profile allows commands by default but denies common file, Git, and dependency mutations',
    );
    expect(flatSquad).toContain('its prompt limits it to inspection');
  });

  it('routes side effects and mutation to the developer instead', () => {
    expect(flatSquad).toContain(
      'route any command with side effects or unclear effects to `pas_developer`',
    );
    expect(flatSquad).toContain('It never authorizes mutating work');
    expect(flatSquad).not.toContain('It is read-only and has no shell');
  });

  it('keeps Squad permissions unchanged', () => {
    const squadFrontmatter = squad.split('---')[1] ?? '';
    expect(squadFrontmatter).toMatch(/^ {2}bash:$/m);
    expect(squadFrontmatter).toContain('    "./pas *": allow');
    expect(squadFrontmatter).toContain('    "pas_researcher": allow');
  });
});
