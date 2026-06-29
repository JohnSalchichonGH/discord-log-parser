import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  messageCost,
  legendReserve,
  fitToBudget,
  topUpToBudget,
} from '../src/core/budget.js';
import { processGroup } from '../src/core/pipeline.js';
import { renderTxt } from '../src/render/txt.js';

describe('messageCost', () => {
  it('counts per-part indentation (conservative vs the old join+15)', () => {
    const msg = { contentParts: ['aaa', 'bbb', 'ccc'] };
    // old naive: 'aaa\nbbb\nccc'.length + 15 = 11 + 15 = 26
    // new: 14 + (3+3)*3 = 14 + 18 = 32  (accounts for "  " indent + newline)
    expect(messageCost(msg)).toBe(32);
    expect(messageCost(msg)).toBeGreaterThan('aaa\nbbb\nccc'.length + 15);
  });
});

describe('legendReserve', () => {
  it('grows with the participant count', () => {
    expect(legendReserve(0)).toBe(200);
    expect(legendReserve(5)).toBe(400);
  });
});

describe('fitToBudget', () => {
  const measure = (msgs) =>
    msgs.reduce((s, m) => s + m.contentParts[0].length, 0);

  it('returns the list unchanged when it already fits', () => {
    const msgs = [{ contentParts: ['ab'] }, { contentParts: ['cd'] }];
    expect(fitToBudget(msgs, 100, new Set(), measure)).toBe(msgs);
  });

  it('drops oldest non-priority messages until it fits', () => {
    const a = { contentParts: ['1234567890'] }; // 10
    const b = { contentParts: ['1234567890'] }; // 10
    const c = { contentParts: ['1234567890'] }; // 10
    const out = fitToBudget([a, b, c], 20, new Set(), measure);
    expect(out).toHaveLength(2);
    expect(out).toEqual([b, c]); // oldest (a) dropped first
  });

  it('never drops priority messages even if over budget', () => {
    const p = { contentParts: ['priority!!'] };
    const n = { contentParts: ['normal....'] };
    const out = fitToBudget([p, n], 5, new Set([p]), measure);
    expect(out).toContain(p);
  });
});

describe('topUpToBudget', () => {
  // 1 token per char of the single content part, deterministic.
  const measure = (msgs) =>
    msgs.reduce((s, m) => s + m.contentParts[0].length, 0);
  const mk = (t, text) => ({ timestamp: t, contentParts: [text] });

  it('adds back the newest excluded messages until the budget is full', () => {
    const kept = [mk(30, '0123456789')]; // 10, newest
    // Excluded older messages, newest-first as the pipeline passes them.
    const leftover = [mk(20, '0123456789'), mk(10, '0123456789')]; // 10 each
    const out = topUpToBudget(kept, leftover, 25, measure);
    expect(measure(out)).toBeLessThanOrEqual(25);
    // 10 (kept) + 10 (t=20) = 20 fits; adding t=10 would hit 30 > 25.
    expect(out.map((m) => m.timestamp)).toEqual([20, 30]);
  });

  it('keeps the result sorted by timestamp', () => {
    const kept = [mk(30, 'aa'), mk(40, 'bb')];
    const leftover = [mk(20, 'cc'), mk(10, 'dd')];
    const out = topUpToBudget(kept, leftover, 1000, measure);
    expect(out.map((m) => m.timestamp)).toEqual([10, 20, 30, 40]);
  });

  it('is a no-op when there is no headroom', () => {
    const kept = [mk(30, '0123456789')]; // 10
    const out = topUpToBudget(kept, [mk(20, '0123456789')], 10, measure);
    expect(out).toEqual(kept);
  });

  it('returns kept unchanged when there are no candidates', () => {
    const kept = [mk(1, 'x')];
    expect(topUpToBudget(kept, [], 100, measure)).toBe(kept);
  });
});

describe('A7: rendered output stays within the budget', () => {
  const sampleJson = readFileSync(
    resolve(process.cwd(), 'test/fixtures/sample.json'),
    'utf8',
  );

  function opts(maxChars) {
    return {
      minMsgs: 0,
      maxChars,
      userFilter: null,
      filterBots: false,
      botSet: new Set(),
      filterSystem: false,
      filterMediaOnly: false,
      dateFrom: null,
      dateTo: null,
      keywords: [],
      useRealNames: false,
    };
  }

  it('keeps the rendered TXT within a tight budget (verify-and-retrim)', () => {
    const files = [{ isJson: true, content: sampleJson }];
    const maxChars = 500;
    const { finalChunks, userMap } = processGroup(files, opts(maxChars));
    const rendered = renderTxt(finalChunks, userMap, maxChars / 4, {}).length;
    expect(rendered).toBeLessThanOrEqual(maxChars);
  });

  it('keeps everything when the budget is generous', () => {
    const files = [{ isJson: true, content: sampleJson }];
    const { finalChunks } = processGroup(files, opts(1_000_000));
    expect(finalChunks).toHaveLength(5);
  });

  it('tops up an accurate token budget the char estimate under-filled (A7b)', () => {
    // 20 messages; the greedy fill is sized by the 4-chars/token estimate, but
    // here each message tokenizes far cheaper than that, so without a top-up
    // pass most of the budget would go unused.
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: String(1000 + i),
      type: 'Default',
      timestamp: `2025-07-12T03:${String(i).padStart(2, '0')}:00+00:00`,
      content: `message number ${i}`,
      author: {
        id: '111',
        name: 'alice',
        discriminator: '0001',
        nickname: 'alice',
        isBot: false,
      },
      attachments: [],
      embeds: [],
      stickers: [],
      reactions: [],
    }));
    const content = JSON.stringify({ messages });
    const files = [{ isJson: true, content }];
    const countTokens = (t) => Math.ceil(t.length / 8); // ~8 chars/token (under 4cpt)
    const maxTokens = 200;
    const maxChars = maxTokens * 4; // what an accurate run reserves on the char side

    const { finalChunks, userMap } = processGroup(files, {
      ...opts(maxChars),
      countTokens,
      maxTokens,
    });
    const used = countTokens(renderTxt(finalChunks, userMap, maxTokens, {}));
    // Provably fits the token budget...
    expect(used).toBeLessThanOrEqual(maxTokens);
    // ...and all 20 are kept. The char-greedy fill alone can't do this: the 20
    // messages cost ~920 chars (> maxChars 800), so it stops a few short; only
    // the token-measured top-up recovers the rest.
    expect(finalChunks).toHaveLength(20);
  });

  it('fits an accurate token budget when a counter is supplied (B4)', () => {
    const files = [{ isJson: true, content: sampleJson }];
    const countTokens = (t) => t.length; // 1 token per char, deterministic
    const maxTokens = 400;
    const { finalChunks, userMap } = processGroup(files, {
      ...opts(1_000_000), // generous char pre-trim; the token verify does the work
      countTokens,
      maxTokens,
    });
    const measured = countTokens(
      renderTxt(finalChunks, userMap, maxTokens, {}),
    );
    expect(measured).toBeLessThanOrEqual(maxTokens);
  });
});
