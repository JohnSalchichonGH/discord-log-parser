import { describe, it, expect } from 'vitest';
import { encode } from 'gpt-tokenizer';
import { estimateTokens, CHARS_PER_TOKEN } from '../src/core/tokens.js';
import { renderTxt } from '../src/render/txt.js';

// Calibration pins for the default (no-BPE) token estimator: the estimate must
// stay within tolerance of the REAL cl100k_base count on representative text.
// The legacy chars/4 rule under-counted chat by ~40% (a "1M token" budget
// produced ~1.7M real tokens); these tests exist so the estimator can never
// silently drift that far again.

const realTokens = (text) => encode(text).length;
const relErr = (text) => {
  const real = realTokens(text);
  return Math.abs(estimateTokens(text) - real) / real;
};

// A rendered chat log shaped like the actual TXT output: headers, short lines,
// usernames, deltas, day dividers, media tokens, reactions, links, markdown.
function chatCorpus() {
  const users = new Map([
    ['U1', 'kang0420'],
    ['U2', 'tetron432'],
    ['U3', 'DETECTIVE indie'],
    ['U4', 'whiteout'],
  ]);
  const lines = [
    'lol',
    'no way that happened',
    'i had a cranberry goat cheese phase for a while ngl',
    'check this out https://example.com/watch?v=dQw4w9WgXcQ',
    '**seriously** you have to try it',
    'rate my setup 8/10 at least',
    'gg wp everyone, same time tomorrow at 19:30?',
    'the answer is 424242 obviously',
    'brb',
    'that reference to the birds and the bees went over everyone',
    'imagine using light theme in 2026 lmaooo',
    'ok but consider: pizza',
  ];
  const msgs = [];
  const base = Date.UTC(2025, 6, 12, 3, 50, 0);
  for (let i = 0; i < 400; i++) {
    msgs.push({
      authorId: `U${(i % 4) + 1}`,
      timestamp: new Date(base + i * 137000),
      contentParts:
        i % 9 === 8
          ? ['[IMG: eyechart.jpg]', '^{👍:3, 😂:2}']
          : [lines[i % lines.length]],
    });
  }
  return renderTxt(msgs, users, 200000, {});
}

const PROSE = `The quick brown fox jumps over the lazy dog. It was the best of
times, it was the worst of times, it was the age of wisdom, it was the age of
foolishness. Meanwhile, the committee deliberated extensively regarding the
implementation of comprehensive infrastructure improvements throughout the
metropolitan area, notwithstanding considerable budgetary constraints.`.repeat(
  20,
);

describe('estimateTokens calibration vs real cl100k', () => {
  it('is within ±12% on rendered chat output (the text budgets apply to)', () => {
    const text = chatCorpus();
    expect(relErr(text)).toBeLessThan(0.12);
  });

  it('is within ±18% on plain English prose (not overfit to chat)', () => {
    expect(relErr(PROSE)).toBeLessThan(0.18);
  });

  it('beats the legacy chars/4 rule on chat text by a wide margin', () => {
    const text = chatCorpus();
    const real = realTokens(text);
    const legacyErr = Math.abs(text.length / 4 - real) / real;
    expect(relErr(text)).toBeLessThan(legacyErr / 2);
  });

  it('CHARS_PER_TOKEN sizing constant reflects real chat density (±20%)', () => {
    const text = chatCorpus();
    const realRatio = text.length / realTokens(text);
    expect(Math.abs(realRatio - CHARS_PER_TOKEN) / realRatio).toBeLessThan(0.2);
  });
});
