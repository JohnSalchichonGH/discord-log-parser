import { describe, it, expect } from 'vitest';
import { buildUserMap } from '../src/core/assemble.js';

const raw = (over) => ({
  authorKey: null,
  authorName: '?',
  timestamp: new Date(),
  isSystem: false,
  replyToKey: null,
  replyToName: null,
  replySnippet: null,
  parts: ['x'],
  reactions: null,
  ...over,
});

describe('buildUserMap stable identity (#4)', () => {
  it('keeps two different users sharing a display name separate', () => {
    const msgs = [
      raw({ authorKey: '111', authorName: 'sam' }),
      raw({ authorKey: '222', authorName: 'sam' }),
    ];
    const { userMap, uidOf } = buildUserMap([msgs], false);
    expect(uidOf('111', 'sam')).toBe('U1');
    expect(uidOf('222', 'sam')).toBe('U2'); // NOT merged
    expect(userMap.size).toBe(2);
  });

  it('treats one user who changed nickname as a single id', () => {
    const msgs = [
      raw({ authorKey: '111', authorName: 'old' }),
      raw({ authorKey: '111', authorName: 'new' }),
    ];
    const { userMap, uidOf } = buildUserMap([msgs], false);
    expect(uidOf('111', 'old')).toBe('U1');
    expect(uidOf('111', 'new')).toBe('U1'); // same person
    expect(userMap.size).toBe(1);
    expect(userMap.get('U1')).toBe('old'); // first-seen label
  });

  it('falls back to display name when no id is available (TXT)', () => {
    const msgs = [raw({ authorName: 'alice' }), raw({ authorName: 'bob' })];
    const { uidOf } = buildUserMap([msgs], false);
    expect(uidOf(null, 'alice')).toBe('U1');
    expect(uidOf(null, 'bob')).toBe('U2');
  });

  it('resolves a keyless reply to an id-keyed author by name (HTML replies)', () => {
    const msgs = [
      raw({ authorKey: '111', authorName: 'alice' }),
      raw({
        authorKey: '222',
        authorName: 'bob',
        replyToKey: null,
        replyToName: 'alice',
        replySnippet: 'hi',
      }),
    ];
    const { uidOf } = buildUserMap([msgs], false);
    expect(uidOf(null, 'alice')).toBe('U1'); // reply matched to alice by name
    expect(uidOf('222', 'bob')).toBe('U2');
  });

  it('useRealNames uses the display name as the id', () => {
    const msgs = [raw({ authorKey: '111', authorName: 'alice' })];
    const { uidOf } = buildUserMap([msgs], true);
    expect(uidOf('111', 'alice')).toBe('alice');
  });
});
