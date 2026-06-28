import { describe, it, expect } from 'vitest';
import { computeAnalytics } from '../src/core/analytics.js';
import { computeWrapped } from '../src/core/wrapped.js';

// Pipeline-shaped messages (timestamp + contentParts) for computeAnalytics…
const msgs = [
  {
    authorId: 'U1',
    authorName: 'alice',
    timestamp: new Date('2025-01-01T10:00:00Z'),
    contentParts: ['hello world this is by far the longest message here'],
  },
  {
    authorId: 'U2',
    authorName: 'bob',
    timestamp: new Date('2025-01-01T10:05:00Z'),
    contentParts: ['> U1: hello world', 'ok ^{🔥:7}'],
  },
  {
    authorId: 'U1',
    authorName: 'alice',
    timestamp: new Date('2025-01-02T11:00:00Z'),
    contentParts: ['day two ^{🔥:2}'],
  },
  {
    authorId: 'U2',
    authorName: 'bob',
    timestamp: new Date('2025-01-02T11:01:00Z'),
    contentParts: ['> U1: day two', 'reply'],
  },
  {
    authorId: 'U1',
    authorName: 'alice',
    timestamp: new Date('2025-01-03T09:00:00Z'),
    contentParts: ['[IMG: pic.png]'],
  },
];

// …and the lightweight DTO shape (ts + parts) for computeWrapped.
const dtos = msgs.map((m) => ({
  authorId: m.authorId,
  authorName: m.authorName,
  ts: m.timestamp.getTime(),
  parts: m.contentParts,
  isSystem: false,
}));

describe('computeWrapped', () => {
  const stats = computeAnalytics(msgs, { tz: 'utc' });
  const w = computeWrapped(dtos, stats);

  it('reports totals and the longest active-day streak', () => {
    expect(w.totals.messages).toBe(5);
    expect(w.streak).toBe(3); // Jan 1, 2, 3 are consecutive
    expect(w.totalMedia).toBe(1);
  });

  it('finds the busiest day and the most active member', () => {
    expect(w.busiest.count).toBe(2);
    expect(w.topUser.name).toBe('alice'); // 3 messages vs bob's 2
  });

  it('surfaces the favorite reaction and the most-reacted message', () => {
    expect(w.topEmoji).toEqual({ name: '🔥', count: 9 });
    expect(w.mostReacted.react).toBe(7);
    expect(w.mostReacted.name).toBe('bob');
  });

  it('identifies the longest message and the top reply duo', () => {
    expect(w.longest.name).toBe('alice');
    expect(w.topPair).toEqual({ from: 'bob', to: 'alice', count: 2 });
  });

  it('derives rhythm, podium and behavioral patterns', () => {
    // Jan 1 2025 is a Wednesday (dow 3), and it ties for busiest weekday.
    expect(w.busiestDow).toBe(3);
    expect(w.timeline).toEqual([2, 2, 1]); // daily counts feed the sparkline
    expect(w.avgPerDay).toBe(2); // 5 messages / 3 active days
    expect(w.top3[0].name).toBe('alice');
    // alice posts the first message of all three days.
    expect(w.starter).toEqual({ name: 'alice', count: 3 });
    // No messages before 6am and no day gaps in this fixture.
    expect(w.nightOwl).toBeNull();
    expect(w.quietGap).toBeNull();
  });
});
