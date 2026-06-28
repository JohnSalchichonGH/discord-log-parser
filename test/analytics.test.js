import { describe, it, expect } from 'vitest';
import { computeAnalytics } from '../src/core/analytics.js';

const msg = (over) => ({
  authorId: 'U1',
  authorName: 'alice',
  timestamp: new Date('2025-07-12T03:50:00Z'),
  contentParts: ['hi'],
  isSystem: false,
  ...over,
});

// 2025-07-12 is a Saturday (UTC dow 6); 2025-07-13 is a Sunday (dow 0).
const messages = [
  msg({ contentParts: ['Hello world'] }),
  msg({
    timestamp: new Date('2025-07-12T03:51:00Z'),
    contentParts: ['a photo', '[IMG: x.png]', '^{👍:3}'],
  }),
  msg({
    authorId: 'U2',
    authorName: 'bob',
    timestamp: new Date('2025-07-12T05:00:00Z'),
    contentParts: ['> U1: Hello world', 'hi'],
  }),
  msg({
    authorId: 'U2',
    authorName: 'bob',
    timestamp: new Date('2025-07-13T10:00:00Z'),
    contentParts: ['ok ^{😂:2}'], // reaction merged onto text
  }),
];

describe('computeAnalytics', () => {
  const a = computeAnalytics(messages, { tz: 'utc' });

  it('computes top-level totals', () => {
    expect(a.totals.messages).toBe(4);
    expect(a.totals.participants).toBe(2);
    expect(a.totals.activeDays).toBe(2);
    expect(a.totals.peakHour).toBe(3); // two messages at 03:xx
    expect(a.totals.reactions).toBe(5); // 3 + 2
  });

  it('fills the day-of-week × hour heatmap (UTC)', () => {
    expect(a.heatmap[6][3]).toBe(2); // Sat 03:00
    expect(a.heatmap[6][5]).toBe(1); // Sat 05:00
    expect(a.heatmap[0][10]).toBe(1); // Sun 10:00
  });

  it('builds a daily timeline', () => {
    expect(a.timeline).toEqual([
      { date: '2025-07-12', count: 3 },
      { date: '2025-07-13', count: 1 },
    ]);
  });

  it('aggregates per-user words, media, and replies', () => {
    const u1 = a.users.find((u) => u.id === 'U1');
    const u2 = a.users.find((u) => u.id === 'U2');
    expect(u1.count).toBe(2);
    expect(u1.words).toBe(4); // "Hello world" + "a photo"
    expect(u1.media).toBe(1);
    expect(u1.replies).toBe(0);
    expect(u2.replies).toBe(1); // the "> U1:" message
    expect(u2.media).toBe(0);
  });

  it('tallies reactions and media tokens', () => {
    expect(a.reactions).toEqual([
      { name: '👍', count: 3 },
      { name: '😂', count: 2 },
    ]);
    expect(a.media).toEqual({ IMG: 1 });
  });

  it('records reply edges for a future network view', () => {
    expect(a.replyEdges).toContainEqual({ from: 'U2', to: 'U1', count: 1 });
  });

  it('supports local-timezone bucketing', () => {
    const local = computeAnalytics(messages, { tz: 'local' });
    expect(local.tz).toBe('local');
    // bucket counts still sum to the message total regardless of tz
    expect(local.timeline.reduce((s, d) => s + d.count, 0)).toBe(4);
  });
});
