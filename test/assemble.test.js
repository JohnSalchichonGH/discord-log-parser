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

  it('treats one user who changed nickname as a single id, labeled by the most recent nickname', () => {
    const msgs = [
      raw({
        authorKey: '111',
        authorName: 'old',
        timestamp: new Date('2025-01-01T00:00:00Z'),
      }),
      raw({
        authorKey: '111',
        authorName: 'new',
        timestamp: new Date('2025-02-01T00:00:00Z'),
      }),
    ];
    const { userMap, uidOf } = buildUserMap([msgs], false);
    expect(uidOf('111', 'old')).toBe('U1');
    expect(uidOf('111', 'new')).toBe('U1'); // same person
    expect(userMap.size).toBe(1);
    expect(userMap.get('U1')).toBe('new'); // most-recent nickname wins
  });

  it('prefers an id-backed nickname over an id-less (TXT) name for the label', () => {
    // Same person: an id-backed HTML/JSON nickname "k" plus a later TXT line
    // written by username "kang0420". The id-backed nickname should win.
    const msgs = [
      raw({
        authorKey: '901',
        authorName: 'k',
        authorUsername: 'kang0420',
        timestamp: new Date('2025-01-01T00:00:00Z'),
      }),
      raw({
        authorKey: null,
        authorName: 'kang0420',
        timestamp: new Date('2025-03-01T00:00:00Z'),
      }),
    ];
    const { userMap, uidOf } = buildUserMap([msgs], false);
    expect(uidOf(null, 'kang0420')).toBe('U1'); // TXT name resolves to same person
    expect(userMap.size).toBe(1);
    expect(userMap.get('U1')).toBe('k'); // id-backed nickname preferred
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

  it('useRealNames keys by the real name but no longer collapses distinct ids', () => {
    const msgs = [
      raw({ authorKey: '111', authorName: 'alice' }),
      raw({ authorKey: '222', authorName: 'alice' }), // different person, same name
    ];
    const { userMap, uidOf } = buildUserMap([msgs], true);
    expect(uidOf('111', 'alice')).toBe('alice');
    expect(uidOf('222', 'alice')).toBe('alice (2)'); // disambiguated, NOT merged
    expect(userMap.size).toBe(2);
  });

  it('merges one person’s remade accounts (same nick, similar username, disjoint dates)', () => {
    const msgs = [
      raw({
        authorKey: '1',
        authorName: 'Cheezy',
        authorUsername: 'cheezy_mcsqueezy0w0',
        timestamp: new Date('2026-01-10T00:00:00Z'),
      }),
      raw({
        authorKey: '2',
        authorName: 'Cheezy',
        authorUsername: 'cheezy_mcsqueezy0_0',
        timestamp: new Date('2026-03-10T00:00:00Z'),
      }),
    ];
    const { userMap, uidOf } = buildUserMap([msgs], false);
    expect(uidOf('1', 'Cheezy')).toBe(uidOf('2', 'Cheezy')); // merged
    expect(userMap.size).toBe(1);
    expect([...userMap.values()][0]).toBe('Cheezy');
  });

  it('keeps different people who share a nick (different usernames, overlapping)', () => {
    const mk = (id, user, ts) =>
      raw({
        authorKey: id,
        authorName: 'kot',
        authorUsername: user,
        timestamp: new Date(ts),
      });
    const msgs = [
      mk('1', 'pyoslayetgavgav', '2026-03-12T00:00:00Z'),
      mk('1', 'pyoslayetgavgav', '2026-06-21T00:00:00Z'),
      mk('2', 'kitnekotenja', '2026-03-29T00:00:00Z'),
      mk('2', 'kitnekotenja', '2026-06-29T00:00:00Z'),
    ];
    const { userMap, uidOf } = buildUserMap([msgs], false);
    expect(uidOf('1', 'kot')).not.toBe(uidOf('2', 'kot')); // NOT merged
    expect(userMap.size).toBe(2);
    expect(new Set(userMap.values())).toEqual(new Set(['kot', 'kot (2)'])); // disambiguated
  });

  it('labels a deleted user by their last real nick when an earlier export had it', () => {
    const msgs = [
      raw({
        authorKey: '9',
        authorName: 'realnick',
        timestamp: new Date('2026-01-01T00:00:00Z'),
      }),
      raw({
        authorKey: '9',
        authorName: 'Deleted User', // later export, after deletion
        timestamp: new Date('2026-05-01T00:00:00Z'),
      }),
    ];
    const { userMap, uidOf } = buildUserMap([msgs], false);
    expect(userMap.size).toBe(1);
    expect(userMap.get(uidOf('9', 'realnick'))).toBe('realnick'); // skips placeholder
  });
});
