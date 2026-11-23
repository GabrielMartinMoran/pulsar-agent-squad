import { describe, expect, it } from 'bun:test';
import { injectToolDenies } from '../../src/cli/lib/policy-injection';

const agent = `---\npermissions:\n  - action: "*"\n    resource: "*"\n    effect: allow\n  - action: shell\n    resource: "*"\n    effect: allow\n---\nbody\n`;

describe('injectToolDenies', () => {
  it('appends denies after all rules, deduplicates existing denies, and is stable', () => {
    const content = `${agent.replace('---\nbody', '  - action: webfetch\n    resource: "*"\n    effect: deny\n---\nbody')}`;
    const out = injectToolDenies(content, ['shell', 'webfetch', 'edit']);
    expect(out).toContain('  - action: edit\n    resource: "*"\n    effect: deny\n---');
    expect(out.indexOf('  - action: shell\n    resource: "*"\n    effect: allow')).toBeLessThan(out.indexOf('  - action: shell\n    resource: "*"\n    effect: deny'));
    expect(out.match(/  - action: webfetch\n/g)).toHaveLength(1);
    expect(injectToolDenies(out, ['shell', 'webfetch', 'edit'])).toBe(out);
  });

  it('does not alter a V1-shaped agent', () => {
    const legacy = '---\npermission:\n  "*": allow\n---\nbody\n';
    expect(injectToolDenies(legacy, ['shell'])).toBe(legacy);
  });
});
