import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { processGroup, getRawMessages } from '../src/core/pipeline.js';
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
