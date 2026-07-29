import { describe, expect, it } from 'bun:test';
import { format_caveman_progress } from '../../src/probe';

describe('format_caveman_progress', () => {
  it('renders the v3 marker lines', () => {
    const body = 'RED. Need test for X.';
    const result = format_caveman_progress(body);

    // result starts with "RED."
    expect(result.startsWith('RED.')).toBe(true);

    // result is at most 5 lines long
    const lines = result.split('\n');
    expect(lines.length).toBeLessThanOrEqual(5);

    // result contains the body verbatim
    expect(result).toContain(body);
  });
});
