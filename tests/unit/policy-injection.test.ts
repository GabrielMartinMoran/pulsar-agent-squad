import { describe, expect, it } from 'bun:test';
import { injectToolDenies } from '../../src/cli/lib/policy-injection';

const v2Agent = [
  '---',
  'description: fixture agent',
  'permissions:',
  '  - action: "*"',
  '    resource: "*"',
  '    effect: allow',
  '  - action: shell',
  '    resource: "*"',
  '    effect: allow',
  '  - action: webfetch',
  '    resource: "*"',
  '    effect: deny',
  '---',
  'body',
  '',
].join('\n');

describe('injectToolDenies', () => {
  it('appends denies after every existing rule, deduplicates, and is stable', () => {
    const out = injectToolDenies(v2Agent, ['shell', 'webfetch', 'edit']);
    expect(out.indexOf('  - action: shell\n    resource: "*"\n    effect: allow')).toBeLessThan(
      out.indexOf('  - action: shell\n    resource: "*"\n    effect: deny'),
    );
    expect(out.indexOf('  - action: edit\n    resource: "*"\n    effect: deny')).toBeGreaterThan(
      out.indexOf('  - action: webfetch\n    resource: "*"\n    effect: deny'),
    );
    expect(out.match(/  - action: webfetch\n/g)).toHaveLength(1);
    expect(out.match(/  - action: shell\n/g)).toHaveLength(2);
    expect(out.match(/  - action: edit\n/g)).toHaveLength(1);
    expect(injectToolDenies(out, ['shell', 'webfetch', 'edit'])).toBe(out);
  });

  it('preserves unrelated rules and their order verbatim', () => {
    const out = injectToolDenies(v2Agent, ['shell']);
    expect(out).toContain('  - action: "*"\n    resource: "*"\n    effect: allow');
    expect(out).toContain('  - action: webfetch\n    resource: "*"\n    effect: deny');
    expect(out.slice(0, out.indexOf('---\nbody'))).toContain(
      '  - action: webfetch\n    resource: "*"\n    effect: deny',
    );
  });

  it('appends a deny when a later allow would otherwise win', () => {
    const laterAllow = [
      '---',
      'permissions:',
      '  - action: shell',
      '    resource: "*"',
      '    effect: deny',
      '  - action: shell',
      '    resource: "git status *"',
      '    effect: allow',
      '---',
      'body',
      '',
    ].join('\n');
    const out = injectToolDenies(laterAllow, ['shell']);
    expect(out.match(/  - action: shell\n/g)).toHaveLength(3);
    expect(out.lastIndexOf('    effect: deny')).toBeGreaterThan(
      out.lastIndexOf('    effect: allow'),
    );
  });

  it('denies tools in a legacy permission map after the wildcard without adding native permissions', () => {
    const legacy = [
      '---',
      'description: fixture agent',
      'permission:',
      '  "*": allow',
      '  webfetch: allow',
      '  edit: deny',
      '  skill:',
      '    "pdf*": allow',
      '---',
      'body',
      '',
    ].join('\n');

    const out = injectToolDenies(legacy, ['webfetch', 'shell']);

    expect(out).toBe(
      [
        '---',
        'description: fixture agent',
        'permission:',
        '  "*": allow',
        '  edit: deny',
        '  skill:',
        '    "pdf*": allow',
        '  bash: deny',
        '  webfetch: deny',
        '---',
        'body',
        '',
      ].join('\n'),
    );
    expect(out).not.toContain('permissions:');
    expect(out.indexOf('  bash: deny')).toBeGreaterThan(
      out.indexOf('    "pdf*": allow'),
    );
    expect(injectToolDenies(out, ['webfetch', 'shell'])).toBe(out);
  });

  it('replaces a nested legacy restriction for the selected tool and keeps other maps', () => {
    const legacy = [
      '---',
      'permission:',
      '  "*": allow',
      '  read:',
      '    "*": deny',
      '    "docs/**": allow',
      '  bash:',
      '    "*": deny',
      '    "git status": allow',
      '  skill: allow',
      '---',
      'body',
      '',
    ].join('\n');

    const out = injectToolDenies(legacy, ['shell']);

    expect(out).toBe(
      [
        '---',
        'permission:',
        '  "*": allow',
        '  read:',
        '    "*": deny',
        '    "docs/**": allow',
        '  skill: allow',
        '  bash: deny',
        '---',
        'body',
        '',
      ].join('\n'),
    );
  });

  it('denies every documented legacy alias of the edit action', () => {
    const legacy = [
      '---',
      'permission:',
      '  "*": allow',
      '  edit: allow',
      '  write:',
      '    "*": allow',
      '  patch: allow',
      '---',
      'body',
      '',
    ].join('\n');

    const out = injectToolDenies(legacy, ['edit']);

    expect(out.match(/^  (edit|write|patch): deny$/gm)).toEqual([
      '  edit: deny',
      '  write: deny',
      '  patch: deny',
    ]);
    expect(out).not.toContain('  edit: allow');
    expect(out).not.toContain('  patch: allow');
  });

  it('skips identifiers that are not documented permission actions in either format', () => {
    const legacy = '---\npermission:\n  "*": allow\n---\nbody\n';
    const warnings: string[] = [];
    expect(
      injectToolDenies(legacy, ['vendor:custom'], (message) =>
        warnings.push(message),
      ),
    ).toBe(legacy);
    expect(
      injectToolDenies(v2Agent, ['vendor:custom'], (message) =>
        warnings.push(message),
      ),
    ).toBe(v2Agent);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/not a documented/);
  });

  it('ignores permission examples outside the frontmatter', () => {
    const bodyOnly = [
      '---',
      'description: fixture',
      '---',
      'permissions:',
      '  - action: shell',
      '    resource: "*"',
      '    effect: allow',
      '',
    ].join('\n');
    expect(injectToolDenies(bodyOnly, ['shell'])).toBe(bodyOnly);
  });

  it('returns the content unchanged when there is nothing to inject', () => {
    expect(injectToolDenies(v2Agent, [])).toBe(v2Agent);
    expect(injectToolDenies('no frontmatter', ['shell'])).toBe('no frontmatter');
  });

  it('rejects an invalid stored identifier instead of widening the deny', () => {
    expect(() => injectToolDenies(v2Agent, ['*'])).toThrow(
      /Invalid tool identifier/,
    );
  });
});
