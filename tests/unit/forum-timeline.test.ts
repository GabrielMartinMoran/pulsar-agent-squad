import { describe, expect, it } from 'bun:test';
import { projectTimeline } from '../../src/cli/forum/project';

function timestamp(seconds: number): string {
  return `2026-11-02T10:${String(seconds).padStart(2, '0')}:00.000Z`;
}

function timelineRoom(): Record<string, unknown> {
  return {
    id: 'ses_timeline',
    status: 'open',
    generation: 2,
    goal: 'Merge the transcript',
    messages: [
      {
        id: 'evt-reset',
        seq: 0,
        role: 'host',
        to: '*',
        type: 'reset',
        kind: 'discussion',
        body: 'started generation 2',
        created_at: timestamp(0),
        read_by: ['host', 'driver', 'peer'],
      },
      {
        id: 'post-review',
        seq: 2,
        role: 'driver',
        to: '*',
        type: 'ready_for_review',
        kind: 'discussion',
        body: 'Ready for review.',
        created_at: timestamp(2),
        read_by: ['driver'],
      },
      {
        id: 'post-review',
        seq: 2,
        role: 'driver',
        to: '*',
        type: 'ready_for_review',
        kind: 'discussion',
        body: 'Ready for review.',
        created_at: timestamp(2),
        read_by: ['driver'],
      },
      {
        id: 'evt-stall',
        seq: 3,
        role: 'host',
        to: 'peer',
        type: 'participant_stall_candidate',
        kind: 'system',
        body: 'peer is unavailable',
        created_at: timestamp(3),
        read_by: [],
      },
      {
        id: 'post-approved',
        seq: 5,
        role: 'peer',
        to: '*',
        type: 'approved',
        kind: 'discussion',
        body: 'Approved.',
        created_at: timestamp(5),
        read_by: ['host', 'driver', 'peer'],
      },
    ],
    forum: {
      topics: [
        {
          id: 'transcript',
          title: 'Transcript',
          scenarios: ['The timeline merges posts with room events in sequence order'],
          status: 'approved',
          revision: 2,
        },
      ],
      posts: [
        {
          id: 'post-review',
          seq: 2,
          topic: 'transcript',
          category: 'ready_for_review',
          message: 'Ready for review.',
          role: 'driver',
          revision: 2,
          evidence: { command: 'bun test x', exit_code: 0, output: 'ok' },
        },
        {
          id: 'post-approved',
          seq: 5,
          topic: 'transcript',
          category: 'approved',
          message: 'Approved.',
          role: 'peer',
          revision: 2,
        },
        {
          id: 'post-unmirrored',
          seq: 7,
          topic: 'transcript',
          category: 'comment',
          message: 'Only in the forum record',
          role: 'driver',
          revision: 3,
        },
      ],
      expected: {},
      final_requested: false,
    },
  };
}

function postWithEvidence(output: string): Record<string, unknown> {
  return {
    id: 'ses_evidence',
    status: 'open',
    generation: 1,
    messages: [
      {
        id: 'post-evidence',
        seq: 1,
        role: 'peer',
        type: 'approved',
        body: 'Approved.',
        created_at: timestamp(1),
        read_by: ['peer'],
      },
    ],
    forum: {
      topics: [],
      posts: [
        {
          id: 'post-evidence',
          seq: 1,
          topic: 'evidence',
          category: 'approved',
          message: 'Approved.',
          role: 'peer',
          revision: 1,
          evidence: { command: 'bun run test', exit_code: 0, output },
        },
      ],
    },
  };
}

describe('timeline projection', () => {
  it('merges mirrored forum posts with room events once, ordered by sequence', () => {
    const timeline = projectTimeline(timelineRoom());

    expect(timeline.map((entry) => entry.id)).toEqual([
      'evt-reset',
      'post-review',
      'evt-stall',
      'post-approved',
      'post-unmirrored',
    ]);
    expect(timeline.map((entry) => entry.seq)).toEqual([0, 2, 3, 5, 7]);
    expect(timeline.map((entry) => entry.kind)).toEqual(['event', 'post', 'event', 'post', 'post']);
  });

  it('takes the post category, revision, topic and evidence from the forum record', () => {
    const [, review] = projectTimeline(timelineRoom());

    expect(review).toMatchObject({
      id: 'post-review',
      seq: 2,
      at: timestamp(2),
      role: 'driver',
      to: '*',
      category: 'ready_for_review',
      kind: 'post',
      message: 'Ready for review.',
      topic: 'transcript',
      revision: 2,
      evidence: { command: 'bun test x', exitCode: 0, output: 'ok', truncated: false },
      seenBy: ['driver'],
    });
    expect(review!.replyTo).toBeUndefined();
  });

  it('takes time, role, target and seen-by from the mirrored message', () => {
    const [reset] = projectTimeline(timelineRoom());

    expect(reset).toEqual({
      id: 'evt-reset',
      seq: 0,
      at: timestamp(0),
      role: 'host',
      to: '*',
      category: 'reset',
      kind: 'event',
      message: 'started generation 2',
      seenBy: ['host', 'driver', 'peer'],
    });
  });

  it('keeps a forum post that has no mirrored message instead of dropping traffic', () => {
    const timeline = projectTimeline(timelineRoom());
    const unmirrored = timeline.find((entry) => entry.id === 'post-unmirrored');

    expect(unmirrored).toMatchObject({
      seq: 7,
      at: null,
      role: 'driver',
      category: 'comment',
      kind: 'post',
      message: 'Only in the forum record',
      topic: 'transcript',
      revision: 3,
      seenBy: [],
    });
  });

  it('marks evidence output truncated at 8192 UTF-8 bytes and keeps command and exit code', () => {
    const [entry] = projectTimeline(postWithEvidence('a'.repeat(9_000)));

    expect(entry!.evidence!.command).toBe('bun run test');
    expect(entry!.evidence!.exitCode).toBe(0);
    expect(entry!.evidence!.truncated).toBe(true);
    expect(Buffer.byteLength(entry!.evidence!.output, 'utf8')).toBe(8_192);
  });

  it('leaves evidence at or under the bound untouched', () => {
    const [entry] = projectTimeline(postWithEvidence('a'.repeat(8_192)));

    expect(entry!.evidence).toEqual({
      command: 'bun run test',
      exitCode: 0,
      output: 'a'.repeat(8_192),
      truncated: false,
    });
  });

  it('never cuts a multi-byte character in half', () => {
    const [wide] = projectTimeline(postWithEvidence('é'.repeat(5_000)));
    const [emoji] = projectTimeline(postWithEvidence('😀'.repeat(3_000)));

    expect(wide!.evidence!.truncated).toBe(true);
    expect(Buffer.byteLength(wide!.evidence!.output, 'utf8')).toBeLessThanOrEqual(8_192);
    expect(wide!.evidence!.output).toBe('é'.repeat(4_096));

    expect(emoji!.evidence!.truncated).toBe(true);
    expect(Buffer.byteLength(emoji!.evidence!.output, 'utf8')).toBeLessThanOrEqual(8_192);
    expect(emoji!.evidence!.output).toBe('😀'.repeat(2_048));
  });

  it('returns an empty timeline for a room without messages', () => {
    expect(projectTimeline({ id: 'ses_empty', messages: [] })).toEqual([]);
  });
});
