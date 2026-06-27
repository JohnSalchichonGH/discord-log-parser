import { describe, it, expect } from 'vitest';
import { parseFilename, buildGroups } from '../src/core/grouping.js';

describe('parseFilename', () => {
  it('parses a base export filename, keying by channel snowflake', () => {
    const r = parseFilename('My Server - general [123456789].html');
    expect(r.channelId).toBe('123456789');
    expect(r.baseName).toBe('My Server - general [123456789]');
    expect(r.afterDate).toBeNull();
    expect(r.sortOrder).toBe(0);
  });

  it('parses a dated partial "(after YYYY-MM-DD)" filename', () => {
    const r = parseFilename(
      'My Server - general [123456789] (after 2025-07-12).html',
    );
    expect(r.channelId).toBe('123456789');
    expect(r.afterDate).toBe('2025-07-12');
    expect(r.sortOrder).toBe(new Date('2025-07-12').getTime());
  });

  it('falls back to the whole filename as channelId when no [id] present', () => {
    const r = parseFilename('random-export.html');
    expect(r.channelId).toBe('random-export.html');
    expect(r.baseName).toBe('random-export');
  });
});

describe('buildGroups', () => {
  it('groups by channelId and sorts each group oldest-first', () => {
    const files = [
      { channelId: 'A', sortOrder: 30 },
      { channelId: 'B', sortOrder: 5 },
      { channelId: 'A', sortOrder: 10 },
    ];
    const groups = buildGroups(files);
    expect([...groups.keys()].sort()).toEqual(['A', 'B']);
    expect(groups.get('A').map((f) => f.sortOrder)).toEqual([10, 30]);
    expect(groups.get('B').map((f) => f.sortOrder)).toEqual([5]);
  });
});
