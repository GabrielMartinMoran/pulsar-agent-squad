import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { internals } from '../../src/tools/pas-toolkit';

const roots: string[] = [];
const scenarios = ['targeted install', 'all targets', 'dry run', 'Pi preflight'];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pas-audit-only-'));
  roots.push(root);
  await internals.openRoom(root, 'lead', 'lead', {
    goal: 'verify the existing implementation without source changes',
    scope: scenarios, authorized_paths: [],
  });
  await internals.joinRoom(root, 'lead', 'driver', { role: 'driver' });
  await internals.joinRoom(root, 'lead', 'peer', { role: 'peer' });
  return root;
}

async function open(root: string, unit = scenarios[0]!) {
  await internals.sendMessage(root, 'lead', 'driver', {
    to: 'peer', unit, type: 'open', body: 'existing implementation ready for review',
  });
}

async function audit(root: string, unit = scenarios[0]!, exitCode = 0, resolves: string[] = []) {
  return internals.auditUnit(root, 'lead', 'peer', {
    unit, command: 'bun test tests/integration/install.test.ts', exit_code: exitCode,
    output_excerpt: exitCode === 0 ? '21 pass, 0 fail' : '1 failing assertion', resolves,
    findings: [{ category: 'test', severity: exitCode === 0 ? 'info' : 'blocking',
      detail: exitCode === 0 ? 'scenario, error paths and relevant edge cases independently covered' : 'required behavior is not covered' }],
  });
}

describe('acceptance auditing without implementation RED', () => {
  it('closes a clean audit without inventing a finding', async () => {
    const root = await fixture();
    await open(root);
    const review = await internals.auditUnit(root, 'lead', 'peer', {
      unit: scenarios[0]!, findings: [], command: 'bun test tests/integration/install.test.ts',
      exit_code: 0, output_excerpt: '21 pass, 0 fail',
    });
    expect(review.findings).toEqual([]);
    const transcript = internals.renderTranscript([review]);
    expect(transcript).toContain('exit code: 0');
    expect(transcript).toContain('output: 21 pass, 0 fail');
    expect((await internals.closeUnit(root, 'lead', 'driver', {
      unit: scenarios[0]!, resolution: 'independently verified',
    })).status).toBe('closed');
  });

  it('reviews related open scenarios using the same independent check', async () => {
    const root = await fixture();
    await open(root, scenarios[0]);
    await open(root, scenarios[1]);
    for (const unit of scenarios.slice(0, 2)) {
      await internals.auditUnit(root, 'lead', 'peer', {
        unit, findings: [], command: 'bun test tests/integration/install.test.ts',
        exit_code: 0, output_excerpt: '21 pass, 0 fail',
      });
    }
    for (const unit of scenarios.slice(0, 2).reverse()) {
      expect((await internals.closeUnit(root, 'lead', 'driver', {
        unit, resolution: 'covered by independent shared check',
      })).status).toBe('closed');
    }
  });
  it('audits and closes all four existing scenarios without driver TDD evidence', async () => {
    const root = await fixture();
    for (const unit of scenarios) {
      await open(root, unit);
      await audit(root, unit);
      expect((await internals.closeUnit(root, 'lead', 'driver', {
        unit, resolution: 'independently covered and passing',
      })).status).toBe('closed');
    }
    expect(internals.transcript(root, 'lead').filter(m => m.evidence)).toEqual([]);
    await internals.sendMessage(root, 'lead', 'driver', {
      to: 'peer', unit: scenarios.at(-1)!, type: 'ready_for_final_audit', body: 'existing tree unchanged',
    });
    await internals.recordEvidence(root, 'lead', 'peer', {
      unit: scenarios.at(-1)!, stage: 'suite', command: 'bun run test',
      exit_code: 0, output_excerpt: 'all required tests pass',
    });
    await internals.reconcileFiles(root, 'lead', 'driver', { files: [] });
    await internals.reconcileFiles(root, 'lead', 'peer', { files: [] });
    expect((await internals.endRoom(root, 'lead', 'driver', { wait_s: 0 })).status).toBe('awaiting_ack');
    expect((await internals.ackRoom(root, 'lead', 'peer')).status).toBe('closed');
  });

  it('records ordinary verification without demanding an invented RED', async () => {
    const root = await fixture(); await open(root);
    await internals.recordEvidence(root, 'lead', 'driver', {
      unit: scenarios[0]!, stage: 'verification', command: 'bun test tests/integration/install.test.ts',
      exit_code: 0, output_excerpt: '21 pass, 0 fail',
    });
    await audit(root);
    expect((await internals.closeUnit(root, 'lead', 'driver', {
      unit: scenarios[0]!, resolution: 'existing behavior verified',
    })).status).toBe('closed');
    expect(internals.transcript(root, 'lead').some(m => m.evidence?.stage === 'red')).toBe(false);
  });

  it('still refuses missing or failing independent acceptance checks', async () => {
    const root = await fixture(); await open(root);
    await expect(internals.closeUnit(root, 'lead', 'driver', {
      unit: scenarios[0]!, resolution: 'assumed done',
    })).rejects.toThrow(/peer audit/);
    await audit(root, scenarios[0]!, 1);
    await expect(internals.closeUnit(root, 'lead', 'driver', {
      unit: scenarios[0]!, resolution: 'not actually passing',
    })).rejects.toThrow(/blocking|failed/);
  });

  it('can resolve a verification-only finding after a successful independent recheck', async () => {
    const root = await fixture(); await open(root);
    const failing = await audit(root, scenarios[0]!, 1);
    await audit(root, scenarios[0]!, 0, [failing.findings![0]!.id]);
    expect((await internals.closeUnit(root, 'lead', 'driver', {
      unit: scenarios[0]!, resolution: 'recheck confirms coverage and passing tests',
    })).status).toBe('closed');
  });

  it('requires another audit after reopening even if no source change is needed', async () => {
    const root = await fixture(); await open(root); await audit(root);
    await internals.closeUnit(root, 'lead', 'driver', { unit: scenarios[0]!, resolution: 'verified' });
    await internals.sendMessage(root, 'lead', 'driver', {
      to: 'peer', unit: scenarios[0]!, type: 'reopen', body: 'repeat validation on the current environment',
    });
    await expect(internals.closeUnit(root, 'lead', 'driver', {
      unit: scenarios[0]!, resolution: 'old audit is enough',
    })).rejects.toThrow(/fresh executable peer audit/);
    await audit(root);
    expect((await internals.closeUnit(root, 'lead', 'driver', {
      unit: scenarios[0]!, resolution: 'fresh verification only',
    })).status).toBe('closed');
  });
});

describe('auditor responsibility in the prompts', () => {
  it('does not make the peer reconstruct TDD or require a RED per scenario', () => {
    const peer = readFileSync('src/agents/pas_copilot.md', 'utf-8').replace(/\s+/g, ' ');
    expect(peer).toContain('Do not reconstruct or re-execute the engineer');
    expect(peer).toContain('Audit-only delegations do not require RED');
    expect(peer).not.toContain('evidence precedes green');
    const driver = readFileSync('src/agents/pas_engineer.md', 'utf-8').replace(/\s+/g, ' ');
    expect(driver).toContain('An acceptance scenario is not a unit test or a separate TDD cycle');
    expect(driver).toContain('stage: verification');
  });
});
