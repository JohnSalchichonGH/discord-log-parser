import { describe, it, expect } from 'vitest';
import {
  processGroup,
  getFilteredMessages,
  assembleGroup,
  applyMessageFilters,
  trimGroup,
  buildIdentity,
} from '../src/core/pipeline.js';
import { buildGroups } from '../src/core/grouping.js';

// The worker caches assembleGroup results and composes the staged functions
// (applyMessageFilters + trimGroup) per request. These tests pin that the
// staged path produces EXACTLY the same output as the one-shot functions, so
// the caching can never change results — only speed.

function baseOpts(over = {}) {
  return {
    minMsgs: 0,
    maxChars: 1_000_000,
    userFilter: null,
    filterBots: false,
    botSet: new Set(),
    filterSystem: false,
    filterMediaOnly: false,
    dateFrom: null,
    dateTo: null,
    keywords: [],
    useRealNames: false,
    ...over,
  };
}

// A cross-format fixture: two channels, each with a JSON export and a TXT copy
// (so dedup + the username alias run), plus a TXT-only straggler message.
const mkJson = (ch, entries) =>
  JSON.stringify({
    guild: { id: '9', name: 'G' },
    channel: { id: String(ch), name: 'chan' + ch },
    dateRange: { after: null },
    messages: entries.map(([id, nick, user, text, ts]) => ({
      id: String(id),
      type: 'Default',
      timestamp: ts,
      content: text,
      author: { id: 'u-' + user, name: user, nickname: nick },
    })),
    messageCount: entries.length,
  });
const mkTxt = (ch, lines) =>
  `Guild: G\nChannel: chan${ch}\n\n` +
  lines.map(([who, text, clock]) => `[${clock}] ${who}\n${text}\n`).join('\n');

const files = [
  {
    isJson: true,
    channelId: '1',
    baseName: 'chan1',
    sortOrder: 0,
    content: mkJson(1, [
      [101, 'kay', 'kay99', 'hello there', '2025-07-12T12:00:00Z'],
      [102, 'bee', 'bee01', 'hi kay', '2025-07-12T12:01:00Z'],
      [103, 'kay', 'kay99', 'how are you', '2025-07-12T12:02:00Z'],
    ]),
  },
  {
    isTxt: true,
    channelId: '1',
    baseName: 'chan1',
    sortOrder: 1,
    content: mkTxt(1, [
      ['kay99', 'hello there', '7/12/2025 12:00 PM'], // dup of 101
      ['bee01', 'hi kay', '7/12/2025 12:01 PM'], // dup of 102
      ['bee01', 'a txt-only straggler', '7/12/2025 12:30 PM'], // unique
    ]),
  },
  {
    isJson: true,
    channelId: '2',
    baseName: 'chan2',
    sortOrder: 0,
    content: mkJson(2, [
      [201, 'kay', 'kay99', 'over in channel two', '2025-07-13T09:00:00Z'],
      [202, 'cee', 'cee55', 'yes indeed', '2025-07-13T09:05:00Z'],
    ]),
  },
];

const sig = (msgs) =>
  msgs.map(
    (m) => `${m.authorId}|${m.timestamp.getTime()}|${m.contentParts.join('¶')}`,
  );

describe('staged pipeline ≡ one-shot pipeline', () => {
  const identity = buildIdentity(files, false);
  const groups = [...buildGroups(files).values()];

  it('assembleGroup + applyMessageFilters ≡ getFilteredMessages (per group)', () => {
    for (const arr of groups) {
      for (const opts of [
        baseOpts(),
        baseOpts({ dateFrom: new Date('2025-07-13T00:00:00Z') }),
        baseOpts({ userFilter: new Set(['kay']) }),
        baseOpts({ filterMediaOnly: true }),
      ]) {
        const oneShot = getFilteredMessages(arr, opts, identity);
        const { allMessages, userMap } = assembleGroup(arr, false, identity);
        const staged = applyMessageFilters(allMessages, opts, userMap);
        expect(sig(staged)).toEqual(sig(oneShot.filtered));
        expect(allMessages.length).toBe(oneShot.allMessagesCount);
        expect(userMap).toBe(oneShot.userMap);
      }
    }
  });

  it('cached assembly reused across different filters ≡ fresh runs', () => {
    // Same assembled result, two different filters — like a user clicking
    // through Insights filters against the worker cache.
    const arr = groups[0];
    const { allMessages, userMap } = assembleGroup(arr, false, identity);
    const kayId = [...userMap.entries()].find(([, n]) => n === 'kay')[0];
    const a = applyMessageFilters(
      allMessages,
      baseOpts({ userFilterIds: new Set([kayId]) }),
      userMap,
    );
    const b = applyMessageFilters(allMessages, baseOpts(), userMap);
    const freshA = getFilteredMessages(
      arr,
      baseOpts({ userFilterIds: new Set([kayId]) }),
      identity,
    );
    const freshB = getFilteredMessages(arr, baseOpts(), identity);
    expect(sig(a)).toEqual(sig(freshA.filtered));
    expect(sig(b)).toEqual(sig(freshB.filtered));
    // Filtering never mutates the cached assembly.
    expect(allMessages.length).toBe(freshB.allMessagesCount);
  });

  it('applyMessageFilters + trimGroup ≡ processGroup (incl. trim + minMsgs)', () => {
    for (const arr of groups) {
      for (const opts of [
        baseOpts(),
        baseOpts({ maxChars: 300 }), // force a trim
        baseOpts({ minMsgs: 2 }), // low-activity cutoff
        baseOpts({ maxChars: 250, keywords: ['straggler'] }), // priority keep
      ]) {
        const oneShot = processGroup(arr, opts, identity);
        const { allMessages, userMap } = assembleGroup(arr, false, identity);
        const filtered = applyMessageFilters(allMessages, opts, userMap);
        const { finalChunks, budgetExceeded } = trimGroup(
          filtered,
          opts,
          userMap,
        );
        expect(sig(finalChunks)).toEqual(sig(oneShot.finalChunks));
        expect(budgetExceeded).toBe(oneShot.budgetExceeded);
        expect(filtered.length).toBe(oneShot.filteredCount);
        expect(allMessages.length).toBe(oneShot.allMessagesCount);
      }
    }
  });
});
