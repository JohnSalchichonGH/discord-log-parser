import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  processGroup,
  getRawMessages,
  getFilteredMessages,
  getFilteredConversation,
  buildIdentity,
} from '../src/core/pipeline.js';
import { buildGroups } from '../src/core/grouping.js';
import { renderTxt } from '../src/render/txt.js';
import { chunkMessages } from '../src/core/chunking.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const sampleHtml = read('test/fixtures/sample.html');
const sampleTxt = read('test/fixtures/sample.txt');
const sampleJson = read('test/fixtures/sample.json');

// Default opts with all filters off; large budget so nothing is trimmed.
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

describe('processGroup (HTML)', () => {
  it('extracts all messages and builds a userMap', () => {
    const files = [{ isTxt: false, content: sampleHtml }];
    const { finalChunks, userMap, allMessagesCount } = processGroup(
      files,
      baseOpts(),
    );
    expect(allMessagesCount).toBe(3);
    expect(finalChunks).toHaveLength(3);
    expect(userMap.get('U1')).toBe('alice');
  });

  it('applies the user whitelist by display name', () => {
    const files = [{ isTxt: false, content: sampleHtml }];
    const { finalChunks } = processGroup(
      files,
      baseOpts({ userFilter: new Set(['bob']) }),
    );
    expect(finalChunks.every((m) => m.authorName === 'bob')).toBe(true);
    expect(finalChunks).toHaveLength(1);
  });
});

describe('processGroup (TXT)', () => {
  it('drops system messages when filterSystem is on', () => {
    const files = [{ isTxt: true, content: sampleTxt }];
    const withSys = processGroup(files, baseOpts());
    const noSys = processGroup(files, baseOpts({ filterSystem: true }));
    expect(noSys.finalChunks.length).toBe(withSys.finalChunks.length - 1);
  });

  it('keyword priority retains a matching old message under a tight budget', () => {
    const files = [{ isTxt: true, content: sampleTxt }];
    // Budget so small only priority + newest survive; "Hello" is the oldest.
    const { finalChunks } = processGroup(
      files,
      baseOpts({ maxChars: 1700, keywords: ['Hello'] }),
    );
    const texts = finalChunks.flatMap((m) => m.contentParts);
    expect(texts.some((t) => t.includes('Hello world'))).toBe(true);
  });
});

describe('keyword priority is always kept (fix #1)', () => {
  it('keeps all priority messages even over budget and reports budgetExceeded', () => {
    const txt = (body) => `Guild: G\nChannel: c\n\n${body}`;
    const content = txt(
      [
        '[7/12/2025 3:50 AM] alice',
        'KEEP one',
        '',
        '[7/12/2025 3:51 AM] alice',
        'KEEP two',
        '',
        '[7/12/2025 3:52 AM] alice',
        'KEEP three',
        '',
      ].join('\n'),
    );
    const r = processGroup(
      [{ isTxt: true, content }],
      baseOpts({ maxChars: 50, keywords: ['KEEP'] }),
    );
    expect(r.finalChunks).toHaveLength(3); // all priority retained
    expect(r.budgetExceeded).toBe(true);
  });
});

describe('getFilteredMessages — userFilterIds (Insights filter)', () => {
  // Same author id 999, two different nicknames across two merged files.
  const mk = (id, nick, ts) =>
    JSON.stringify({
      guild: { id: '9', name: 'G' },
      channel: { id: '1', name: 'c' },
      dateRange: { after: null },
      messages: [
        {
          id: String(id),
          type: 'Default',
          timestamp: ts,
          content: 'm',
          author: { id: '999', nickname: nick, name: 'x' },
        },
      ],
      messageCount: 1,
    });
  const files = [
    { isJson: true, content: mk(1, 'newName', '2025-07-10T00:00:00Z') },
    { isJson: true, content: mk(2, 'oldName', '2025-07-01T00:00:00Z') },
  ];

  it('collapses one author id to a single uid across merged files', () => {
    const { filtered } = getFilteredMessages(files, baseOpts());
    expect(filtered).toHaveLength(2);
    expect(new Set(filtered.map((m) => m.authorId)).size).toBe(1);
  });

  it('keeps all of a user’s messages when filtered by their stable uid', () => {
    const { filtered } = getFilteredMessages(files, baseOpts());
    const uid = filtered[0].authorId;
    const r = getFilteredMessages(files, {
      ...baseOpts(),
      userFilterIds: new Set([uid]),
    });
    expect(r.filtered).toHaveLength(2); // name-independent: nothing missed
  });
});

describe('cross-format dedup (TXT copy of an id-bearing message)', () => {
  // Same person + message exported as JSON (id "1001", nickname "k", username
  // "kang0420") and as TXT (written by username "kang0420", no ids). Noon
  // timestamps keep the UTC day stable across the test machine's timezone.
  const json = JSON.stringify({
    guild: { id: '9', name: 'G' },
    channel: { id: '1', name: 'general' },
    dateRange: { after: null },
    messages: [
      {
        id: '1001',
        type: 'Default',
        timestamp: '2025-07-12T12:00:00Z',
        content: 'greetings',
        author: { id: '999', name: 'kang0420', nickname: 'k' },
      },
    ],
    messageCount: 1,
  });
  const txtLine = (body) => `Guild: G\nChannel: general\n\n${body}`;

  it('unifies the TXT username with the id-backed nickname and drops the dup', () => {
    const files = [
      { isJson: true, content: json },
      {
        isTxt: true,
        content: txtLine('[7/12/2025 12:00 PM] kang0420\ngreetings\n'),
      },
    ];
    const { filtered, userMap } = getFilteredMessages(files, baseOpts());
    expect(filtered).toHaveLength(1); // TXT copy collapsed into the id-bearing one
    expect(filtered[0].messageId).toBe('1001'); // the richer copy is kept
    expect(userMap.get(filtered[0].authorId)).toBe('k'); // single identity
  });

  it('keeps a TXT-only message that has no id-bearing twin (since-deleted)', () => {
    const files = [
      { isJson: true, content: json },
      {
        isTxt: true,
        content: txtLine(
          '[7/12/2025 12:00 PM] kang0420\ngreetings\n\n[7/12/2025 12:30 PM] kang0420\nthis line was deleted before the JSON export\n',
        ),
      },
    ];
    const { filtered } = getFilteredMessages(files, baseOpts());
    expect(filtered).toHaveLength(2); // "greetings" dedups; the deleted line stays
    expect(
      filtered.some((m) => m.contentParts.join(' ').includes('deleted before')),
    ).toBe(true);
  });
});

describe('message-content identity bridge (renamed across exports)', () => {
  // Same person, different periods: a JSON export shows them as
  // "encyclopediagalactica" (id 7); an older TXT shows the SAME messages under an
  // old nick "eralnkj" that no id-bearing export ever recorded. Linking by name
  // is impossible, but the messages match, so they should collapse to one person.
  const lines = [
    'cranberry goat cheese is underrated honestly',
    'you rats are supposed to eat anything',
    'i had a cranberry goat cheese phase for a while',
    'seriously you have to try it',
    'my top cheese is gruyere then pecorino',
    'rate me fellow human being',
    'this server is something else lol',
    'anyway good night everyone',
    'seriously try the goat cheese',
    'i mean it this time',
  ];
  const json = JSON.stringify({
    guild: { id: '9', name: 'G' },
    channel: { id: '1', name: 'c' },
    dateRange: { after: null },
    messages: lines.map((c, i) => ({
      id: String(900 + i),
      type: 'Default',
      timestamp: `2026-04-${10 + i}T12:00:00Z`,
      content: c,
      author: {
        id: '7',
        name: 'encyclopediagalactica',
        nickname: 'encyclopediagalactica',
      },
    })),
    messageCount: lines.length,
  });
  const txt =
    'Guild: G\nChannel: c\n\n' +
    lines
      .map((c, i) => `[4/${10 + i}/2026 12:00 PM] eralnkj\n${c}\n`)
      .join('\n');

  it('folds the TXT author into the id-bearing identity and drops the duplicates', () => {
    const files = [
      { isJson: true, content: json },
      { isTxt: true, content: txt },
    ];
    const { filtered, userMap } = getFilteredMessages(files, baseOpts());
    expect(filtered).toHaveLength(lines.length); // duplicates collapsed, not doubled
    const ids = new Set(filtered.map((m) => m.authorId));
    expect(ids.size).toBe(1); // one identity
    expect(userMap.get([...ids][0])).toBe('encyclopediagalactica');
    expect([...new Set(filtered.map((m) => m.authorName))]).toEqual([
      'encyclopediagalactica',
    ]);
  });

  it('does NOT bridge a TXT author whose messages do not match an identity', () => {
    const otherTxt =
      'Guild: G\nChannel: c\n\n' +
      Array.from(
        { length: 10 },
        (_, i) =>
          `[4/${10 + i}/2026 1:00 PM] strangerguy\nunrelated message number ${i}\n`,
      ).join('\n');
    const files = [
      { isJson: true, content: json },
      { isTxt: true, content: otherTxt },
    ];
    const { filtered } = getFilteredMessages(files, baseOpts());
    // 10 JSON + 10 unrelated TXT, kept separate
    expect(filtered).toHaveLength(20);
    expect(new Set(filtered.map((m) => m.authorName)).size).toBe(2);
  });
});

describe('reply resolves to the referenced message’s author (HTML)', () => {
  // The person posts the referenced message as "Light" (id 7) in a JSON export.
  // A later HTML export's reply shows the old nick "favian" in the reply-author,
  // but its reply-link carries the referenced message id — so the reply should
  // resolve to "Light", not the stale "favian".
  const json = JSON.stringify({
    guild: { id: '9', name: 'G' },
    channel: { id: '1', name: 'c' },
    dateRange: { after: null },
    messages: [
      {
        id: '1439489076142145577',
        type: 'Default',
        timestamp: '2025-11-16T08:00:00Z',
        content: 'my favorite cheese is cranberry goat cheese',
        author: { id: '7', name: 'grokipedia', nickname: 'Light' },
      },
    ],
    messageCount: 1,
  });
  const html =
    '<html><body><div class="chatlog__message-group">' +
    '<div class="chatlog__message-container" data-message-id="1439490337109446667">' +
    '<div class="chatlog__message"><div class="chatlog__message-primary">' +
    '<div class="chatlog__reply"><div class="chatlog__reply-author" title="grokipedia">favian</div>' +
    '<div class="chatlog__reply-content"><span class="chatlog__reply-link" ' +
    'onclick="scrollToMessage(event,\'1439489076142145577\')">cheese</span></div></div>' +
    '<div class="chatlog__header"><span class="chatlog__author" title="cheezy" data-user-id="8">Cheezy</span></div>' +
    '<div class="chatlog__content chatlog__markdown"><span class="chatlog__markdown-preserve">yo</span></div>' +
    '</div></div></div></div></body></html>';

  it('re-points the reply token to the referenced message’s canonical author', () => {
    const files = [
      { isJson: true, content: json },
      { isTxt: false, content: html },
    ];
    const { filtered, userMap } = getFilteredMessages(files, baseOpts());
    const reply = filtered.find((m) => m.contentParts[0]?.startsWith('> '));
    expect(reply).toBeTruthy();
    const tok = reply.contentParts[0];
    const uid = tok.slice(2, tok.indexOf(':')).trim();
    expect(userMap.get(uid)).toBe('Light'); // not the stale "favian"
  });
});

describe('parse-once memoization (B2)', () => {
  it('parses each file only once and reuses the cache across reprocessing', () => {
    const f = { isJson: true, content: sampleJson };
    const r1 = getRawMessages(f);
    expect(getRawMessages(f)).toBe(r1); // same reference → not re-parsed
    // Re-processing (e.g. after a settings change) must not re-parse.
    processGroup([f], baseOpts());
    processGroup([f], baseOpts({ maxChars: 5000 }));
    expect(getRawMessages(f)).toBe(r1);
  });
});

describe('processGroup — TXT dedup (B5)', () => {
  const txt = (body) => `Guild: G\nChannel: c\n\n${body}`;

  it('keeps legitimately-repeated identical messages within one file', () => {
    const content = txt(
      [
        '[7/12/2025 3:50 AM] bob',
        'ok',
        '',
        '[7/12/2025 3:50 AM] bob',
        'ok',
        '',
      ].join('\n'),
    );
    const { finalChunks } = processGroup(
      [{ isTxt: true, content }],
      baseOpts(),
    );
    expect(finalChunks.filter((m) => m.contentParts[0] === 'ok')).toHaveLength(
      2,
    );
  });

  it('deduplicates the overlap between two export files', () => {
    // Both files contain the same two messages; result should keep each once.
    const a = txt(
      [
        '[7/12/2025 3:50 AM] bob',
        'hello',
        '',
        '[7/12/2025 3:51 AM] bob',
        'world',
        '',
      ].join('\n'),
    );
    const b = txt(
      [
        '[7/12/2025 3:51 AM] bob',
        'world',
        '',
        '[7/12/2025 3:52 AM] bob',
        'new',
        '',
      ].join('\n'),
    );
    const { finalChunks } = processGroup(
      [
        { isTxt: true, content: a, sortOrder: 1 },
        { isTxt: true, content: b, sortOrder: 2 },
      ],
      baseOpts(),
    );
    const texts = finalChunks.map((m) => m.contentParts[0]);
    expect(texts).toEqual(['hello', 'world', 'new']); // "world" not duplicated
  });
});

describe('processGroup (JSON)', () => {
  it('extracts all messages with locale-independent timestamps', () => {
    const files = [{ isJson: true, content: sampleJson }];
    const { finalChunks, userMap, allMessagesCount } = processGroup(
      files,
      baseOpts(),
    );
    expect(allMessagesCount).toBe(5);
    expect(finalChunks).toHaveLength(5);
    expect(userMap.get('U1')).toBe('alice');
    expect(finalChunks[0].timestamp.toISOString()).toBe(
      '2025-07-12T03:50:00.000Z',
    );
  });

  it('drops system messages when filterSystem is on', () => {
    const files = [{ isJson: true, content: sampleJson }];
    const { finalChunks } = processGroup(
      files,
      baseOpts({ filterSystem: true }),
    );
    expect(finalChunks).toHaveLength(4); // GuildMemberJoin removed
  });

  it('excludes bot messages when the author is tagged as a bot', () => {
    const files = [{ isJson: true, content: sampleJson }];
    const { finalChunks } = processGroup(
      files,
      baseOpts({ filterBots: true, botSet: new Set(['CarolBot']) }),
    );
    expect(finalChunks.some((m) => m.authorName === 'CarolBot')).toBe(false);
  });

  it('renders to the LLM-optimized format end-to-end', () => {
    const files = [{ isJson: true, content: sampleJson }];
    const { finalChunks, userMap } = processGroup(files, baseOpts());
    const out = renderTxt(finalChunks, userMap, 200000, {});
    expect(out).toContain('# U1: alice');
    expect(out).toContain('Hello world');
    expect(out).toContain('> U1: Hello world'); // reply preserved
  });
});

describe('renderTxt (end-to-end)', () => {
  const files = [{ isTxt: false, content: sampleHtml }];
  const { finalChunks, userMap } = processGroup(files, baseOpts());
  const out = renderTxt(finalChunks, userMap, 200000, {});

  it('emits the LLM-optimized header and participant legend', () => {
    expect(out).toContain('# LLM-Optimized Chat Log');
    expect(out).toContain('# U1: alice');
    expect(out).toContain('# U2: bob');
  });

  it('emits a day divider and the first author block', () => {
    expect(out).toMatch(/=== \w+, \w+ \d{2}, \d{4} ===/);
    expect(out).toContain('Hello world');
  });

  it('renders the first message clock in UTC (deterministic)', () => {
    // sample.html message 1 is 2025-07-12T03:50:00Z -> always "[3:50 AM]".
    expect(out).toContain('[3:50 AM] U1:');
  });

  it('anonymizes the legend when redactNames is set', () => {
    const red = renderTxt(finalChunks, userMap, 200000, { redactNames: true });
    expect(red).toContain('# U1: (');
    expect(red).not.toContain('# U1: alice');
  });

  it('strips URLs when redactUrls is set', () => {
    const m = [
      {
        authorId: 'U1',
        authorName: 'a',
        timestamp: new Date('2025-07-12T03:50:00Z'),
        contentParts: ['see https://example.com/x now'],
      },
    ];
    const red = renderTxt(m, new Map([['a', 'U1']]), 1000, {
      redactUrls: true,
    });
    expect(red).toContain('[URL]');
    expect(red).not.toContain('example.com');
  });
});

describe('analytics ⇄ export reconciliation (getFilteredConversation)', () => {
  // The SAME author posts an identical line on the same day in TWO different
  // channels — legitimately distinct messages. A single global dedup pass keys
  // by author+day+text (no channel), so it wrongly collapses them; per-channel
  // dedup (what the export does) keeps both.
  const txt = (ch) =>
    `Guild: G\nChannel: ${ch}\n\n[7/12/2025 12:00 PM] sam\nshared line\n`;
  const files = [
    { isTxt: true, content: txt('a'), channelId: '1', sortOrder: 0 },
    { isTxt: true, content: txt('b'), channelId: '2', sortOrder: 0 },
  ];

  it('dedups per channel group, not globally', () => {
    // Documents the old (inaccurate) global behavior the analytics used to use…
    expect(getFilteredMessages(files, baseOpts()).filtered).toHaveLength(1);
    // …vs the grouped conversation the analytics now share with the export.
    expect(getFilteredConversation(files, baseOpts()).filtered).toHaveLength(2);
  });

  it('message count equals the sum of per-group export filtering', () => {
    const identity = buildIdentity(files, false);
    let perGroup = 0;
    for (const [, arr] of buildGroups(files))
      perGroup += processGroup(arr, baseOpts(), identity).filteredCount;
    expect(getFilteredConversation(files, baseOpts()).filtered).toHaveLength(
      perGroup,
    );
  });
});

describe('chunkMessages', () => {
  it('splits into overlapping chunks that each respect the budget', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      contentParts: ['x'.repeat(300)],
      timestamp: new Date(2025, 0, 1, 0, i),
    }));
    // headerBudget=200, messageCost≈317/msg. maxChars=3000 fits 8 msgs/chunk.
    const chunks = chunkMessages(msgs, 750, 2);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toHaveLength(8);
    // overlap=2: the last 2 of a chunk are the first 2 of the next.
    expect(chunks[0].slice(-2)).toEqual(chunks[1].slice(0, 2));
  });
});
