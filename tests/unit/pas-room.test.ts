import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pasToolkit, { internals } from '../../src/tools/pas-toolkit';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pas-room-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

const SCOPE = ['scenario one', 'scenario two'];

async function openWithPair(root: string): Promise<void> {
  await internals.openRoom(root, 'lead', 'lead', {
    goal: 'pair on the feature',
    scope: SCOPE,
    authorized_paths: ['src'],
  });
  await internals.joinRoom(root, 'lead', 'engineer', { role: 'driver' });
  await internals.joinRoom(root, 'lead', 'copilot', { role: 'peer' });
}

async function openUnit(root: string): Promise<void> {
  await internals.sendMessage(root, 'lead', 'engineer', {
    to: '*',
    unit: 'scenario one',
    type: 'open',
    body: 'starting scenario one',
  });
  // T1 close-rule tests predate evidence gating. Seed the minimum Red/Green
  // evidence so those tests keep isolating unread and dissent behavior.
  await internals.recordEvidence(root, 'lead', 'engineer', {
    unit: 'scenario one',
    stage: 'red',
    command: 'bun test scenario-one',
    exit_code: 1,
    output_excerpt: 'expected PASS, received FAIL',
  });
  await internals.recordEvidence(root, 'lead', 'engineer', {
    unit: 'scenario one',
    stage: 'green',
    command: 'bun test scenario-one',
    exit_code: 0,
    output_excerpt: '1 pass',
  });
}

describe('room roles and lifecycle', () => {
  it('The lead hosts, the engineer drives and the copilot audits', async () => {
    const root = makeRoot();
    const room = await internals.openRoom(root, 'lead', 'lead', {
      goal: 'pair on the feature',
      scope: SCOPE,
      authorized_paths: ['src'],
    });

    expect(room.members).toEqual([{ sessionID: 'lead', role: 'host' }]);

    await internals.joinRoom(root, 'lead', 'engineer', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'copilot', { role: 'peer' });
    const state = internals.roomState(root, 'lead');

    expect(state.members.map((member) => member.role)).toEqual(['host', 'driver', 'peer']);

    await expect(
      internals.closeUnit(root, 'lead', 'copilot', { unit: 'scenario one', resolution: 'done' }),
    ).rejects.toThrow(/propose_close/);
    await expect(
      internals.closeUnit(root, 'lead', 'lead', { unit: 'scenario one', resolution: 'done' }),
    ).rejects.toThrow(/only the driver/);

    await openUnit(root);
    expect(await internals.readInbox(root, 'lead', 'lead', {})).toEqual([]);
    const peerInbox = await internals.readInbox(root, 'lead', 'copilot', {});
    expect(peerInbox.map((message) => message.body)).toEqual(['starting scenario one']);
  });

  it('joins idempotently and rejects a second driver or peer', async () => {
    const root = makeRoot();
    await openWithPair(root);

    await internals.joinRoom(root, 'lead', 'engineer', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'copilot', { role: 'peer' });

    await expect(internals.joinRoom(root, 'lead', 'other', { role: 'driver' })).rejects.toThrow(
      /driver already joined/,
    );
    await expect(internals.joinRoom(root, 'lead', 'other', { role: 'peer' })).rejects.toThrow(
      /peer already joined/,
    );
    await expect(internals.joinRoom(root, 'lead', 'engineer', { role: 'peer' })).rejects.toThrow(
      /already joined as driver/,
    );
  });
});

describe('close rules', () => {
  it('The peer cannot close a unit', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);

    await expect(
      internals.closeUnit(root, 'lead', 'copilot', {
        unit: 'scenario one',
        resolution: 'all good',
      }),
    ).rejects.toThrow(/propose_close/);

    expect(internals.roomState(root, 'lead').units['scenario one'].status).toBe('open');
  });

  it('The driver cannot close with unread messages', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);

    await internals.sendMessage(root, 'lead', 'copilot', {
      to: 'driver',
      unit: 'scenario one',
      type: 'reply',
      body: 'please look at this before closing',
    });

    await expect(
      internals.closeUnit(root, 'lead', 'engineer', {
        unit: 'scenario one',
        resolution: 'done',
      }),
    ).rejects.toThrow(/unread/);

    await internals.readInbox(root, 'lead', 'engineer', { unit: 'scenario one' });
    const closed = await internals.closeUnit(root, 'lead', 'engineer', {
      unit: 'scenario one',
      resolution: 'done',
    });
    expect(closed.status).toBe('closed');
  });

  it('Overruling a challenge requires explicit dissent', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);

    await internals.sendMessage(root, 'lead', 'copilot', {
      to: 'driver',
      unit: 'scenario one',
      type: 'challenge',
      body: 'this test does not prove the behavior',
    });
    await internals.readInbox(root, 'lead', 'engineer', { unit: 'scenario one' });

    await expect(
      internals.closeUnit(root, 'lead', 'engineer', {
        unit: 'scenario one',
        resolution: 'done',
      }),
    ).rejects.toThrow(/dissent/);
    await expect(
      internals.closeUnit(root, 'lead', 'engineer', {
        unit: 'scenario one',
        resolution: 'done',
        dissent: '   ',
      }),
    ).rejects.toThrow(/dissent/);

    const closed = await internals.closeUnit(root, 'lead', 'engineer', {
      unit: 'scenario one',
      resolution: 'done',
      dissent: 'the challenge is about scope, not correctness',
    });
    expect(closed.status).toBe('closed');
    expect(closed.dissent).toBe('the challenge is about scope, not correctness');
  });

  it('Message cap stops two agents agreeing forever', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);

    for (let index = 0; index < internals.MAX_DISCUSSION_MESSAGES - 1; index += 1) {
      await internals.sendMessage(root, 'lead', 'engineer', {
        to: 'copilot',
        unit: 'scenario one',
        type: 'reply',
        body: `reply ${index}`,
      });
    }

    const countDiscussion = (): number =>
      internals
        .transcript(root, 'lead')
        .filter((message) => message.unit === 'scenario one' && message.kind === 'discussion').length;

    expect(countDiscussion()).toBe(internals.MAX_DISCUSSION_MESSAGES);

    await expect(
      internals.sendMessage(root, 'lead', 'engineer', {
        to: 'copilot',
        unit: 'scenario one',
        type: 'reply',
        body: 'one too many',
      }),
    ).rejects.toThrow(/cap/);
    await expect(
      internals.sendMessage(root, 'lead', 'copilot', {
        to: 'engineer',
        unit: 'scenario one',
        type: 'challenge',
        body: 'one too many',
      }),
    ).rejects.toThrow(/cap/);

    await expect(
      internals.sendMessage(root, 'lead', 'engineer', {
        to: 'copilot',
        unit: 'scenario one',
        type: 'propose_close',
        body: 'ready to close',
      }),
    ).resolves.toBeDefined();

    expect(countDiscussion()).toBe(internals.MAX_DISCUSSION_MESSAGES + 1);

    for (let index = 0; index < 5; index += 1) {
      await internals.sendMessage(root, 'lead', 'engineer', {
        to: 'copilot',
        unit: 'scenario one',
        type: 'reply',
        kind: 'evidence',
        body: `evidence ${index}`,
      });
    }

    expect(countDiscussion()).toBe(internals.MAX_DISCUSSION_MESSAGES + 1);
    await expect(
      internals.sendMessage(root, 'lead', 'engineer', {
        to: 'copilot',
        unit: 'scenario one',
        type: 'reply',
        body: 'still capped',
      }),
    ).rejects.toThrow(/cap/);
  });
});

describe('room identity and storage', () => {
  it('Rooms are keyed by the root session', async () => {
    const parents: Record<string, string | undefined> = {
      engineer: 'lead',
      copilot: 'lead',
    };
    const ctx = {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ({
          id: sessionID,
          parentID: parents[sessionID],
        }),
      },
    };

    expect(await internals.roomIdForSession(ctx, 'engineer')).toBe('lead');
    expect(await internals.roomIdForSession(ctx, 'copilot')).toBe('lead');
    expect(await internals.roomIdForSession(ctx, 'lead')).toBe('lead');

    const root = makeRoot();
    await internals.openRoom(root, 'lead', 'lead', {
      goal: 'root keyed',
      scope: SCOPE,
      authorized_paths: [],
    });
    await internals.joinRoom(root, 'lead', 'engineer', { role: 'driver' });
    await internals.sendMessage(root, 'lead', 'engineer', {
      to: '*',
      unit: 'scenario one',
      type: 'open',
      body: 'from the child session',
    });
    expect(internals.transcript(root, 'lead')).toHaveLength(1);
  });

  it('Concurrent writers never lose a message', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);

    const sends = Array.from({ length: 20 }, (_, index) =>
      internals.sendMessage(root, 'lead', 'engineer', {
        to: 'copilot',
        unit: 'scenario one',
        type: 'reply',
        kind: 'evidence',
        body: `concurrent ${index}`,
      }),
    );
    await Promise.all(sends);

    const transcript = internals.transcript(root, 'lead');
    const concurrent = transcript.filter((message) => message.body.startsWith('concurrent '));

    expect(concurrent).toHaveLength(20);
    expect(new Set(concurrent.map((message) => message.id)).size).toBe(20);
    expect(new Set(transcript.map((message) => message.seq)).size).toBe(transcript.length);
    expect(transcript.map((message) => message.body)).toEqual(
      expect.arrayContaining(Array.from({ length: 20 }, (_, index) => `concurrent ${index}`)),
    );
  });
});

async function openRoomWithPair(root: string, scope: string[]): Promise<void> {
  await internals.openRoom(root, 'lead', 'lead', {
    goal: 'pair on the feature',
    scope,
    authorized_paths: ['src'],
  });
  await internals.joinRoom(root, 'lead', 'engineer', { role: 'driver' });
  await internals.joinRoom(root, 'lead', 'copilot', { role: 'peer' });
  // T3: the ack is gated on reconciliation. Tests that do not exercise the
  // reconciliation round seed an agreed empty list so they keep isolating the
  // behavior they were written for.
  await internals.reconcileFiles(root, 'lead', 'engineer', { files: [] });
  await internals.reconcileFiles(root, 'lead', 'copilot', { files: [] });
}

async function recordRedGreen(root: string, unit: string): Promise<void> {
  await internals.recordEvidence(root, 'lead', 'engineer', {
    unit,
    stage: 'red',
    command: `bun test ${unit}`,
    exit_code: 1,
    output_excerpt: 'failing assertion',
  });
  await internals.recordEvidence(root, 'lead', 'engineer', {
    unit,
    stage: 'green',
    command: `bun test ${unit}`,
    exit_code: 0,
    output_excerpt: '1 pass',
  });
}

describe('step contract and evidence', () => {
  it('Units are acceptance scenarios and open in order', async () => {
    const root = makeRoot();
    await openRoomWithPair(root, ['one', 'two', 'three']);

    await internals.sendMessage(root, 'lead', 'engineer', {
      to: '*',
      unit: 'one',
      type: 'open',
      body: 'open the first unit',
    });

    await expect(
      internals.sendMessage(root, 'lead', 'engineer', {
        to: '*',
        unit: 'two',
        type: 'open',
        body: 'skip the first unit',
      }),
    ).rejects.toThrow(/earlier unit|scope order/);
    expect(Object.keys(internals.roomState(root, 'lead').units)).toEqual(['one']);

    await recordRedGreen(root, 'one');
    await internals.closeUnit(root, 'lead', 'engineer', { unit: 'one', resolution: 'done' });
    await expect(
      internals.sendMessage(root, 'lead', 'engineer', {
        to: '*',
        unit: 'two',
        type: 'open',
        body: 'now the second unit may open',
      }),
    ).resolves.toBeDefined();
  });

  it('A unit cannot reach green without red', async () => {
    const root = makeRoot();
    await openRoomWithPair(root, SCOPE);
    await internals.sendMessage(root, 'lead', 'engineer', {
      to: '*',
      unit: 'scenario one',
      type: 'open',
      body: 'open without red',
    });

    await expect(
      internals.recordEvidence(root, 'lead', 'engineer', {
        unit: 'scenario one',
        stage: 'green',
        command: 'bun test scenario-one',
        exit_code: 0,
        output_excerpt: '1 pass',
      }),
    ).rejects.toThrow(/red/);

    await internals.recordEvidence(root, 'lead', 'engineer', {
      unit: 'scenario one',
      stage: 'red',
      command: 'bun test scenario-one',
      exit_code: 1,
      output_excerpt: 'failing assertion',
    });
    await expect(
      internals.recordEvidence(root, 'lead', 'engineer', {
        unit: 'scenario one',
        stage: 'green',
        command: 'bun test scenario-one',
        exit_code: 0,
        output_excerpt: '1 pass',
      }),
    ).resolves.toBeDefined();
  });

  it('Evidence must be reproducible', async () => {
    const root = makeRoot();
    await openRoomWithPair(root, SCOPE);
    await internals.sendMessage(root, 'lead', 'engineer', {
      to: '*',
      unit: 'scenario one',
      type: 'open',
      body: 'open for evidence',
    });

    const valid = {
      unit: 'scenario one',
      stage: 'red' as const,
      command: 'bun test scenario-one',
      exit_code: 1,
      output_excerpt: 'failing assertion',
    };

    await expect(
      internals.recordEvidence(root, 'lead', 'engineer', { ...valid, command: '   ' }),
    ).rejects.toThrow(/command/);
    await expect(
      internals.recordEvidence(root, 'lead', 'engineer', { ...valid, output_excerpt: '' }),
    ).rejects.toThrow(/output_excerpt/);
    await expect(
      internals.recordEvidence(root, 'lead', 'engineer', {
        ...valid,
        exit_code: undefined as unknown as number,
      }),
    ).rejects.toThrow(/exit_code/);
    await expect(
      internals.recordEvidence(root, 'lead', 'engineer', { ...valid, exit_code: 1.5 }),
    ).rejects.toThrow(/exit_code|integer/);

    await expect(internals.recordEvidence(root, 'lead', 'engineer', valid)).resolves.toBeDefined();
  });

  it('The ack requires a green full-suite audit from the peer', async () => {
    const root = makeRoot();
    await openRoomWithPair(root, ['scenario one']);
    await internals.sendMessage(root, 'lead', 'engineer', {
      to: '*',
      unit: 'scenario one',
      type: 'open',
      body: 'open the only unit',
    });
    await recordRedGreen(root, 'scenario one');
    await internals.closeUnit(root, 'lead', 'engineer', {
      unit: 'scenario one',
      resolution: 'unit done',
    });

    await expect(
      internals.recordEvidence(root, 'lead', 'engineer', {
        unit: 'scenario one',
        stage: 'suite',
        command: 'bun run test',
        exit_code: 0,
        output_excerpt: 'all green',
      }),
    ).rejects.toThrow(/peer/);

    await expect(internals.ackRoom(root, 'lead', 'copilot', {})).rejects.toThrow(
      /awaiting_ack|end/,
    );

    await expect(internals.endRoom(root, 'lead', 'engineer', { wait_s: 0.05 })).rejects.toThrow(
      /suite/,
    );

    await internals.recordEvidence(root, 'lead', 'copilot', {
      unit: 'scenario one',
      stage: 'suite',
      command: 'bun run test',
      exit_code: 1,
      output_excerpt: '3 failures',
    });
    await expect(internals.endRoom(root, 'lead', 'engineer', { wait_s: 0.05 })).rejects.toThrow(
      /suite|exit code|non-zero/,
    );

    await internals.recordEvidence(root, 'lead', 'copilot', {
      unit: 'scenario one',
      stage: 'suite',
      command: 'bun run test',
      exit_code: 0,
      output_excerpt: '648 pass, 0 fail',
    });

    // Drive the state machine explicitly instead of racing a scheduled ack:
    // the end request parks the room in awaiting_ack, then the peer ack (the
    // only thing that may close it) is applied synchronously.
    const awaiting = await internals.endRoom(root, 'lead', 'engineer', { wait_s: 0 });
    expect(awaiting.status).toBe('awaiting_ack');

    const ended = await internals.ackRoom(root, 'lead', 'copilot', { summary: 'suite is green' });
    expect(ended.status).toBe('closed');
    expect(internals.roomState(root, 'lead').status).toBe('closed');
  });

  it('A blocking finding prevents unit closure', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);

    await internals.auditUnit(root, 'lead', 'copilot', {
      unit: 'scenario one',
      findings: [
        {
          category: 'quality',
          severity: 'blocking',
          detail: 'the scenario test only asserts the happy path',
        },
      ],
    });

    await expect(
      internals.closeUnit(root, 'lead', 'engineer', {
        unit: 'scenario one',
        resolution: 'done',
      }),
    ).rejects.toThrow(/blocking|dissent/);

    const closed = await internals.closeUnit(root, 'lead', 'engineer', {
      unit: 'scenario one',
      resolution: 'done',
      dissent: 'accepted as a known gap, tracked for the next slice',
    });
    expect(closed.status).toBe('closed');
    expect(closed.dissent).toBe('accepted as a known gap, tracked for the next slice');

    const transcript = internals.transcript(root, 'lead');
    const override = transcript.find((message) => /override/i.test(message.body));
    expect(override?.body).toMatch(/happy path/);
    expect(internals.roomState(root, 'lead').units['scenario one'].blocking_findings).toBe(0);
  });

  it('Findings carry a category and a severity', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);

    const validFinding = {
      category: 'evidence' as const,
      severity: 'minor' as const,
      detail: 'the excerpt is short but reproducible',
    };

    await expect(
      internals.auditUnit(root, 'lead', 'copilot', {
        unit: 'scenario one',
        findings: [{ ...validFinding, category: 'vibes' as never }],
      }),
    ).rejects.toThrow(/category/);
    await expect(
      internals.auditUnit(root, 'lead', 'copilot', {
        unit: 'scenario one',
        findings: [{ ...validFinding, severity: 'catastrophic' as never }],
      }),
    ).rejects.toThrow(/severity/);
    await expect(
      internals.auditUnit(root, 'lead', 'copilot', {
        unit: 'scenario one',
        findings: [{ ...validFinding, detail: '   ' }],
      }),
    ).rejects.toThrow(/detail/);
    await expect(
      internals.auditUnit(root, 'lead', 'copilot', { unit: 'scenario one', findings: [] }),
    ).rejects.toThrow(/finding|audit/);
    await expect(
      internals.auditUnit(root, 'lead', 'engineer', {
        unit: 'scenario one',
        findings: [validFinding],
      }),
    ).rejects.toThrow(/peer/);

    const message = await internals.auditUnit(root, 'lead', 'copilot', {
      unit: 'scenario one',
      findings: [validFinding],
      command: 'bun test scenario-one',
      note: 're-ran the scenario',
    });
    expect(message.kind).toBe('audit');
    expect(message.findings?.[0]).toMatchObject({ category: 'evidence', severity: 'minor' });
  });

  it('Correction rounds are bounded', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);

    const blocking = [
      { category: 'test' as const, severity: 'blocking' as const, detail: 'still failing' },
    ];
    for (let round = 0; round < internals.MAX_CORRECTION_ROUNDS; round += 1) {
      await internals.auditUnit(root, 'lead', 'copilot', {
        unit: 'scenario one',
        findings: blocking,
      });
    }

    await expect(
      internals.auditUnit(root, 'lead', 'copilot', {
        unit: 'scenario one',
        findings: blocking,
      }),
    ).rejects.toThrow(/pas_room_escalate/);

    // Non-blocking audits never consume a correction round.
    for (let index = 0; index < 5; index += 1) {
      await expect(
        internals.auditUnit(root, 'lead', 'copilot', {
          unit: 'scenario one',
          findings: [{ category: 'cruft', severity: 'info', detail: `note ${index}` }],
        }),
      ).resolves.toBeDefined();
    }

    const state = internals.roomState(root, 'lead');
    expect(state.units['scenario one'].correction_rounds).toBe(internals.MAX_CORRECTION_ROUNDS);
  });

  it('An escalation stops the room instead of waiting', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);

    await expect(
      internals.escalateRoom(root, 'lead', 'copilot', {
        action: 'supervise' as never,
        reason: 'not a real action',
      }),
    ).rejects.toThrow(/action/);

    const started = Date.now();
    const escalated = await internals.escalateRoom(root, 'lead', 'copilot', {
      action: 're_delegate',
      reason: 'the unit mixes two independent behaviors',
      unit: 'scenario one',
      evidence: 'bun test scenario-one',
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(escalated.escalation).toMatchObject({
      action: 're_delegate',
      reason: 'the unit mixes two independent behaviors',
    });
    expect(internals.renderRoomState(escalated)).toMatch(/re_delegate/);

    await expect(
      internals.closeUnit(root, 'lead', 'engineer', {
        unit: 'scenario one',
        resolution: 'done',
        dissent: 'ignoring the escalation',
      }),
    ).rejects.toThrow(/escalat/i);
    await expect(internals.endRoom(root, 'lead', 'engineer', { wait_s: 0 })).rejects.toThrow(
      /escalat/i,
    );
    await expect(internals.ackRoom(root, 'lead', 'copilot', {})).rejects.toThrow(/escalat/i);
  });

  async function prepareAck(root: string): Promise<void> {
    await internals.openRoom(root, 'lead', 'lead', {
      goal: 'pair on the feature',
      scope: ['scenario one'],
      authorized_paths: ['src'],
    });
    await internals.joinRoom(root, 'lead', 'engineer', { role: 'driver' });
    await internals.joinRoom(root, 'lead', 'copilot', { role: 'peer' });
    await internals.sendMessage(root, 'lead', 'engineer', {
      to: '*',
      unit: 'scenario one',
      type: 'open',
      body: 'open the only unit',
    });
    await recordRedGreen(root, 'scenario one');
    await internals.closeUnit(root, 'lead', 'engineer', {
      unit: 'scenario one',
      resolution: 'unit done',
    });
    await internals.recordEvidence(root, 'lead', 'copilot', {
      unit: 'scenario one',
      stage: 'suite',
      command: 'bun run test',
      exit_code: 0,
      output_excerpt: 'all green',
    });
    const ended = await internals.endRoom(root, 'lead', 'engineer', { wait_s: 0.02 });
    expect(ended.status).toBe('awaiting_ack');
  }

  it('Both agents reconcile their file list before the ack', async () => {
    const root = makeRoot();
    await prepareAck(root);

    await expect(internals.ackRoom(root, 'lead', 'copilot', {})).rejects.toThrow(/reconcil/i);

    await internals.reconcileFiles(root, 'lead', 'engineer', {
      files: ['src/a.ts', 'tests/a.test.ts'],
    });
    await expect(internals.ackRoom(root, 'lead', 'copilot', {})).rejects.toThrow(/reconcil/i);

    const disagreed = await internals.reconcileFiles(root, 'lead', 'copilot', {
      files: ['src/a.ts', 'src/b.ts'],
    });
    expect(disagreed.reconciliation?.reconciled).toBe(false);
    expect(disagreed.reconciliation?.discrepancies).toEqual({
      only_driver: ['tests/a.test.ts'],
      only_peer: ['src/b.ts'],
    });
    await expect(internals.ackRoom(root, 'lead', 'copilot', {})).rejects.toThrow(
      /reconcil|discrepan/i,
    );

    const agreed = await internals.reconcileFiles(root, 'lead', 'engineer', {
      files: ['src/a.ts', 'src/b.ts'],
    });
    expect(agreed.reconciliation?.reconciled).toBe(true);
    expect(agreed.reconciliation?.files).toEqual(['src/a.ts', 'src/b.ts']);

    const acked = await internals.ackRoom(root, 'lead', 'copilot', { summary: 'lists agree' });
    expect(acked.status).toBe('closed');
  });

  it('Ending requires every unit closed and a peer ack', async () => {
    const root = makeRoot();
    await openRoomWithPair(root, SCOPE);

    await expect(internals.endRoom(root, 'lead', 'engineer', { wait_s: 0.05 })).rejects.toThrow(
      /every unit|closed/,
    );

    await internals.sendMessage(root, 'lead', 'engineer', {
      to: '*',
      unit: 'scenario one',
      type: 'open',
      body: 'open one',
    });
    await recordRedGreen(root, 'scenario one');
    await internals.closeUnit(root, 'lead', 'engineer', {
      unit: 'scenario one',
      resolution: 'done',
    });

    await internals.sendMessage(root, 'lead', 'engineer', {
      to: '*',
      unit: 'scenario two',
      type: 'open',
      body: 'open two',
    });
    await recordRedGreen(root, 'scenario two');
    await internals.closeUnit(root, 'lead', 'engineer', {
      unit: 'scenario two',
      resolution: 'done',
    });

    await internals.sendMessage(root, 'lead', 'copilot', {
      to: 'driver',
      unit: 'scenario two',
      type: 'reply',
      body: 'one last note',
    });
    await expect(internals.endRoom(root, 'lead', 'engineer', { wait_s: 0.05 })).rejects.toThrow(
      /unread/,
    );
    await internals.readInbox(root, 'lead', 'engineer', {});

    await internals.recordEvidence(root, 'lead', 'copilot', {
      unit: 'scenario two',
      stage: 'suite',
      command: 'bun run test',
      exit_code: 0,
      output_excerpt: 'all green',
    });

    const ended = await internals.endRoom(root, 'lead', 'engineer', { wait_s: 0.02 });
    expect(ended.status).toBe('awaiting_ack');
    const stateText = internals.renderRoomState(internals.roomState(root, 'lead'));
    expect(stateText).toContain('awaiting_ack');
    expect(stateText).toMatch(/anomal/i);

    const acked = await internals.ackRoom(root, 'lead', 'copilot', { summary: 'ok' });
    expect(acked.status).toBe('closed');
  });
});

describe('unread notices in the model prompt', () => {
  interface HookEvent {
    sessionID?: string;
    system?: unknown[];
  }

  function sessionApi() {
    return {
      get: async ({ sessionID }: { sessionID: string }) =>
        sessionID === 'engineer'
          ? { id: 'engineer', parentID: 'lead' }
          : { id: sessionID },
    };
  }

  async function unreadForEngineer(root: string): Promise<void> {
    await openWithPair(root);
    // Opening the unit is a broadcast from the driver, so it is unread for the peer only.
    await openUnit(root);
    await internals.sendMessage(root, 'lead', 'copilot', {
      to: 'driver',
      unit: 'scenario one',
      type: 'reply',
      body: 'please cover the empty scope',
    });
  }

  it('Unread notices reach the model prompt', async () => {
    const root = makeRoot();
    await unreadForEngineer(root);
    const before = internals.roomState(root, 'lead').messages.map((message) => [...message.read_by]);

    const event: HookEvent = { sessionID: 'engineer', system: [] };
    await internals.createRoomNoticeHook(root, sessionApi())(event);

    expect(event.system).toHaveLength(1);
    const part = event.system?.[0] as { type: string; text: string };
    expect(part.type).toBe('text');
    expect(part.text).toContain('1 unread');
    expect(part.text).toContain('peer');
    expect(part.text).toContain('scenario one');
    expect(part.text).toContain('pas_room_inbox');

    const after = internals.roomState(root, 'lead').messages.map((message) => [...message.read_by]);
    expect(after).toEqual(before);
  });

  it('Notices survive compaction', async () => {
    const root = makeRoot();
    await unreadForEngineer(root);

    const hooks = new Map<string, (event: HookEvent) => unknown>();
    const ctx = {
      location: { directory: root },
      session: {
        ...sessionApi(),
        hook: async (name: string, callback: (event: HookEvent) => unknown) => {
          hooks.set(name, callback);
          return {};
        },
      },
      tool: { transform: async (callback: (editor: { add(tool: unknown): void }) => void) => callback({ add: () => {} }) },
    };
    await pasToolkit.setup(ctx);

    expect([...hooks.keys()].sort()).toEqual(['compaction', 'context']);

    const event: HookEvent = { sessionID: 'engineer', system: [] };
    await hooks.get('compaction')?.(event);
    expect(event.system).toHaveLength(1);
    expect((event.system?.[0] as { text: string }).text).toContain('1 unread');
  });

  it('Injects nothing when the session has no room', async () => {
    const root = makeRoot();
    const event: HookEvent = { sessionID: 'engineer', system: [] };
    await internals.createRoomNoticeHook(root, sessionApi())(event);
    expect(event.system).toHaveLength(0);
  });

  it('Injects nothing when the session has zero unread messages', async () => {
    const root = makeRoot();
    await openWithPair(root);
    await openUnit(root);
    // The peer reads its inbox, leaving the driver with nothing unread.
    await internals.readInbox(root, 'lead', 'copilot', {});

    const event: HookEvent = { sessionID: 'engineer', system: [] };
    await internals.createRoomNoticeHook(root, sessionApi())(event);
    expect(event.system).toHaveLength(0);
  });
});
