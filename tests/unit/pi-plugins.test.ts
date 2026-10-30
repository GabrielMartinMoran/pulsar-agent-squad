/**
 * Unit tests for the pure Pi package helpers used by the setup plugin step.
 *
 * These cover version parsing, the minimum-version gate, missing-package
 * computation, and the invariant that a package installed outside
 * `config/pi-packages.txt` is never part of the missing/removal set.
 */

import { describe, expect, it } from 'bun:test';
import {
  isVersionAtLeast,
  missingPackages,
  parsePiInstalledPackages,
  parsePiVersion,
} from '../../src/cli/lib/pi-plugins';

describe('@unit parsePiVersion', () => {
  it('parses a plain SemVer string', () => {
    expect(parsePiVersion('1.4.0')).toEqual([1, 4, 0]);
  });

  it('parses a version embedded in command output', () => {
    expect(parsePiVersion('pi 1.2.0\n')).toEqual([1, 2, 0]);
    expect(parsePiVersion('v2.0.1')).toEqual([2, 0, 1]);
    expect(parsePiVersion('Pi version 10.20.30 (build 7)')).toEqual([10, 20, 30]);
  });

  it('returns null for incomplete or non-version text', () => {
    expect(parsePiVersion('1.2')).toBeNull();
    expect(parsePiVersion('not a version')).toBeNull();
    expect(parsePiVersion('')).toBeNull();
  });
});

describe('@unit isVersionAtLeast', () => {
  it('accepts equal and greater versions', () => {
    expect(isVersionAtLeast([1, 2, 0], [1, 2, 0])).toBe(true);
    expect(isVersionAtLeast([1, 2, 1], [1, 2, 0])).toBe(true);
    expect(isVersionAtLeast([2, 0, 0], [1, 2, 0])).toBe(true);
  });

  it('rejects lower versions', () => {
    expect(isVersionAtLeast([1, 1, 9], [1, 2, 0])).toBe(false);
    expect(isVersionAtLeast([0, 9, 9], [1, 0, 0])).toBe(false);
  });

  it('treats an unparsed version as insufficient', () => {
    expect(isVersionAtLeast(null, [1, 2, 0])).toBe(false);
  });
});

describe('@unit parsePiInstalledPackages', () => {
  it('extracts package specs from real `pi list` output without paths or headers', () => {
    const output = [
      'User packages:',
      '  npm:pi-subagents',
      '    /home/user/.pi/agent/npm/node_modules/pi-subagents',
      '  npm:@juicesharp/rpiv-todo',
      '    /home/user/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo',
      '  npm:pi-workspace-history',
      '    /home/user/.pi/agent/npm/node_modules/pi-workspace-history',
    ].join('\n');

    expect(parsePiInstalledPackages(output)).toEqual([
      'npm:pi-subagents',
      'npm:@juicesharp/rpiv-todo',
      'npm:pi-workspace-history',
    ]);
  });
});

describe('@unit missingPackages', () => {
  const configured = [
    'npm:pi-subagents',
    'npm:pi-web-access',
    'npm:@juicesharp/rpiv-ask-user-question',
    'npm:@juicesharp/rpiv-todo',
  ];

  it('returns configured packages that are not installed, in configured order', () => {
    const installed = ['npm:pi-subagents', 'npm:@juicesharp/rpiv-todo'];

    expect(missingPackages(configured, installed)).toEqual([
      'npm:pi-web-access',
      'npm:@juicesharp/rpiv-ask-user-question',
    ]);
  });

  it('treats a bare package name as the same package as its npm: spec', () => {
    expect(missingPackages(['npm:pi-subagents'], ['pi-subagents'])).toEqual([]);
    expect(missingPackages(['pi-subagents'], ['npm:pi-subagents'])).toEqual([]);
  });

  it('never returns installed packages that are not configured (no removals)', () => {
    const installed = [
      'npm:pi-subagents',
      'npm:pi-web-access',
      'npm:@juicesharp/rpiv-ask-user-question',
      'npm:@juicesharp/rpiv-todo',
      'npm:pi-workspace-history',
    ];

    const missing = missingPackages(configured, installed);

    expect(missing).toEqual([]);
    // The installed-but-unconfigured package can never appear in a set whose
    // only consumer is "install these".
    expect(missing).not.toContain('npm:pi-workspace-history');
  });

  it('does not match a longer package name that merely starts with a configured one', () => {
    expect(missingPackages(['npm:pi-subagents'], ['npm:pi-subagents-extra'])).toEqual([
      'npm:pi-subagents',
    ]);
  });
});
