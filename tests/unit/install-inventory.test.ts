import { describe, expect, it } from 'bun:test';
import {
  INSTALL_INVENTORY_FILENAME,
  classifyRetiredFiles,
  hashBytes,
  isValidDirectChildBasename,
  mergeProtectedInventoryRecords,
  parseInstallInventory,
  type InstallInventory,
} from '../../src/cli/lib/install-inventory';

const UNMODIFIED = hashBytes('unmodified');
const EDITED = hashBytes('edited');

describe('hashBytes', () => {
  it('returns the SHA-256 digest of the content', () => {
    expect(hashBytes('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});

describe('isValidDirectChildBasename', () => {
  it('accepts plain direct child names, including spaces and dots', () => {
    for (const name of [
      'pas_developer.md',
      'Pulsar Agent Squad.md',
      'agent.v2.md',
      'ünïcode.md',
    ]) {
      expect(isValidDirectChildBasename(name)).toBe(true);
    }
  });

  it('rejects empty, dot, traversal, separator, and reserved inventory names', () => {
    for (const name of [
      '',
      '.',
      '..',
      '../pas_developer.md',
      'nested/pas_qa.md',
      '/tmp/pas_qa.md',
      'windows\\agent.md',
      'nul\0byte.md',
      INSTALL_INVENTORY_FILENAME,
    ]) {
      expect(isValidDirectChildBasename(name)).toBe(false);
    }
  });
});

describe('parseInstallInventory', () => {
  it('accepts a versioned inventory of valid direct child entries', () => {
    const inventory = parseInstallInventory(
      JSON.stringify({
        version: 1,
        files: [
          { name: 'Pulsar Agent Squad.md', sha256: UNMODIFIED },
          { name: 'pas_developer.md', sha256: EDITED },
        ],
      }),
    );

    expect(inventory.version).toBe(1);
    expect(inventory.files).toEqual([
      { name: 'Pulsar Agent Squad.md', sha256: UNMODIFIED },
      { name: 'pas_developer.md', sha256: EDITED },
    ]);
  });

  it('rejects malformed JSON, versions, shapes, names, digests, and duplicates', () => {
    const validEntry = { name: 'pas_qa.md', sha256: UNMODIFIED };
    const invalidDocuments: unknown[] = [
      'not json',
      [],
      {},
      { version: 2, files: [validEntry] },
      { version: '1', files: [validEntry] },
      { version: 1, files: validEntry },
      { version: 1, files: [{ name: 'pas_qa.md' }] },
      { version: 1, files: [{ name: 'pas_qa.md', sha256: 'abc' }] },
      { version: 1, files: [{ name: '../pas_qa.md', sha256: UNMODIFIED }] },
      { version: 1, files: [{ name: 'nested/pas_qa.md', sha256: UNMODIFIED }] },
      { version: 1, files: [{ name: '', sha256: UNMODIFIED }] },
      { version: 1, files: [{ name: INSTALL_INVENTORY_FILENAME, sha256: UNMODIFIED }] },
      { version: 1, files: [validEntry, validEntry] },
    ];

    for (const document of invalidDocuments) {
      const raw =
        typeof document === 'string' ? document : JSON.stringify(document);
      expect(() => parseInstallInventory(raw)).toThrow(/inventory/i);
    }
  });
});

describe('classifyRetiredFiles — scenario D4', () => {
  const inventory: InstallInventory = {
    version: 1,
    files: [
      { name: 'pas_retired.md', sha256: UNMODIFIED },
      { name: 'pas_shipped.md', sha256: UNMODIFIED },
      { name: 'pas_edited.md', sha256: UNMODIFIED },
      { name: 'pas_linked.md', sha256: UNMODIFIED },
      { name: 'pas_missing.md', sha256: UNMODIFIED },
    ],
  };

  it('makes only the recorded unmodified retired regular file eligible', () => {
    const result = classifyRetiredFiles(
      inventory,
      ['pas_shipped.md', 'pas_new.md'],
      [
        { name: 'pas_retired.md', kind: 'file', sha256: UNMODIFIED },
        { name: 'pas_shipped.md', kind: 'file', sha256: UNMODIFIED },
        { name: 'pas_edited.md', kind: 'file', sha256: EDITED },
        { name: 'pas_linked.md', kind: 'symlink' },
        { name: 'pas_unowned.md', kind: 'file', sha256: UNMODIFIED },
      ],
    );

    expect(result.eligible.map((entry) => entry.name)).toEqual([
      'pas_retired.md',
    ]);
    expect(
      result.preserved.map(({ entry, reason }) => [entry.name, reason]),
    ).toEqual([
      ['pas_edited.md', 'modified'],
      ['pas_linked.md', 'not-regular-file'],
      ['pas_missing.md', 'missing'],
    ]);
  });

  it('never considers a still-shipped file obsolete', () => {
    const result = classifyRetiredFiles(
      { version: 1, files: [{ name: 'pas_shipped.md', sha256: UNMODIFIED }] },
      ['pas_shipped.md'],
      [{ name: 'pas_shipped.md', kind: 'file', sha256: UNMODIFIED }],
    );

    expect(result.eligible).toEqual([]);
    expect(result.preserved).toEqual([]);
  });

  it('treats a regular candidate without a digest as modified', () => {
    const result = classifyRetiredFiles(
      { version: 1, files: [{ name: 'pas_retired.md', sha256: UNMODIFIED }] },
      [],
      [{ name: 'pas_retired.md', kind: 'file' }],
    );

    expect(result.eligible).toEqual([]);
    expect(result.preserved).toEqual([
      {
        entry: { name: 'pas_retired.md', sha256: UNMODIFIED },
        reason: 'modified',
      },
    ]);
  });
});

describe('mergeProtectedInventoryRecords', () => {
  it('keeps the original digest of edited and non-regular protected records', () => {
    const result = mergeProtectedInventoryRecords(
      [{ name: 'pas_new.md', sha256: hashBytes('new') }],
      [
        {
          entry: { name: 'pas_edited.md', sha256: hashBytes('original edited') },
          reason: 'modified',
        },
        {
          entry: { name: 'pas_linked.md', sha256: hashBytes('original linked') },
          reason: 'not-regular-file',
        },
      ],
    );

    expect(result).toEqual([
      { name: 'pas_edited.md', sha256: hashBytes('original edited') },
      { name: 'pas_linked.md', sha256: hashBytes('original linked') },
      { name: 'pas_new.md', sha256: hashBytes('new') },
    ]);
  });

  it('drops missing records and lets a shipped file replace its prior digest', () => {
    const result = mergeProtectedInventoryRecords(
      [{ name: 'pas_shipped.md', sha256: hashBytes('reinstalled') }],
      [
        {
          entry: { name: 'pas_shipped.md', sha256: hashBytes('old') },
          reason: 'modified',
        },
        {
          entry: { name: 'pas_missing.md', sha256: hashBytes('gone') },
          reason: 'missing',
        },
      ],
    );

    expect(result).toEqual([
      { name: 'pas_shipped.md', sha256: hashBytes('reinstalled') },
    ]);
  });

  it('returns only the shipped records when nothing is protected', () => {
    expect(
      mergeProtectedInventoryRecords(
        [
          { name: 'pas_b.md', sha256: hashBytes('b') },
          { name: 'pas_a.md', sha256: hashBytes('a') },
        ],
        [],
      ),
    ).toEqual([
      { name: 'pas_a.md', sha256: hashBytes('a') },
      { name: 'pas_b.md', sha256: hashBytes('b') },
    ]);
  });
});
