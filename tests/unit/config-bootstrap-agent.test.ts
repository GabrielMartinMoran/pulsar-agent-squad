import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const turbo = readFileSync('src/agents/Pulsar Agent Turbo.md', 'utf-8');
const lead = readFileSync('src/agents/Pulsar Agent Squad.md', 'utf-8');

describe('PAS first-run config bootstrapping agent contract', () => {
  for (const [name, prompt] of [['Turbo', turbo], ['Lead', lead]] as const) {
    it(`${name} previews the portable configuration and requires explicit approval`, () => {
      expect(prompt).toContain('pas_toolkit');
      expect(prompt).toContain('operation: init');
      expect(prompt).toContain('confirm: true');
      expect(prompt).toContain('approval');
      expect(prompt).toContain('overwrite');
      expect(prompt).toContain('harness');
    });
  }
});
