import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  formatPiModelLabel,
  parsePiModelList,
  type PiModelRow,
} from '../../src/cli/lib/pi-model-list';

/**
 * Reduced real sample (12 openai rows). Not the full capture.
 * From `pi --list-models` (Pi 1.4.0), including the `400K` / `8.2K` / `1.0M`
 * compact amounts and trailing column padding.
 */
const FIXTURE = readFileSync(join(import.meta.dir, '..', 'fixtures', 'pi-list-models.txt'), 'utf-8');

const TABLE = `provider            model                          context  max-out  thinking  images
openrouter          ~deepseek/deepseek-flash-latest  128000   8192     yes       no
anthropic           claude-sonnet-4-6                200000   64000    no        yes

google              gemini-2.5-pro                    1000000  65536    yes       yes
broken              only-two-fields
`;

describe('parsePiModelList', () => {
  it('parses the documented fixed-width table and ignores header and blank lines', () => {
    const rows = parsePiModelList(TABLE);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      provider: 'openrouter',
      model: '~deepseek/deepseek-flash-latest',
      context: 128000,
      maxOut: 8192,
      thinking: true,
      images: false,
    } satisfies PiModelRow);
    expect(rows[1]).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      context: 200000,
      maxOut: 64000,
      thinking: false,
      images: true,
    });
    expect(rows[2]).toEqual({
      provider: 'google',
      model: 'gemini-2.5-pro',
      context: 1000000,
      maxOut: 65536,
      thinking: true,
      images: true,
    });
  });

  it('skips rows with fewer than six fields instead of guessing', () => {
    const rows = parsePiModelList('openrouter  short-model  1000\ntoo  few\n');
    expect(rows).toEqual([]);
  });

  it('returns [] for output that matches no model row', () => {
    expect(parsePiModelList('')).toEqual([]);
    expect(parsePiModelList('not a model table\n')).toEqual([]);
    expect(parsePiModelList('provider  model  context  max-out  thinking  images\n')).toEqual([]);
  });

  it('@unit parses a captured real pi --list-models table with compact amounts', () => {
    const rows = parsePiModelList(FIXTURE);

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      provider: 'openai',
      model: 'chat-latest',
      context: 400_000,
      maxOut: 128_000,
      thinking: true,
      images: true,
    });
    expect(rows[1].model).toBe('gpt-4');
    expect(rows[1].context).toBe(8_200);
    expect(rows[1].maxOut).toBe(8_200);
    expect(rows[3].context).toBe(1_000_000);
    expect(rows[3].maxOut).toBe(32_800);
    expect(rows[11]).toMatchObject({ provider: 'openai', model: 'gpt-5', thinking: true });
  });
});

describe('formatPiModelLabel', () => {
  it('formats provider and model as provider/model', () => {
    expect(
      formatPiModelLabel({
        provider: 'openrouter',
        model: '~deepseek/deepseek-flash-latest',
        context: 128000,
        maxOut: 8192,
        thinking: true,
        images: false,
      }),
    ).toBe('openrouter/~deepseek/deepseek-flash-latest');
  });
});
