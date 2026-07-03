// Token estimation for the default (no-BPE) build.
//
// The legacy "1 token ~= 4 characters" rule is calibrated for clean English
// prose; Discord chat -- short lines, usernames, timestamps, markdown, emoji --
// runs closer to 2.4-2.8 chars/token, so char/4 under-counted by ~40% and a
// "1M token" export could really be ~1.7M tokens. estimateTokens() now walks
// the text in BPE-shaped segments (words, digit runs, whitespace, emoji, CJK,
// punctuation) with per-segment costs calibrated against the real cl100k_base
// tokenizer (see test/tokens.estimate.test.js, which pins the estimate within
// +-12% on chat-style corpora).
//
// Exact-model note: different models tokenize differently (Gemini vs GPT vs
// Claude); this targets the cl100k ballpark, which is representative.

// Average chars/token for CHAT text -- used only to size the greedy fill and
// the "approx N chars" labels; the real budget check measures rendered text
// with estimateTokens (or the accurate BPE counter when enabled).
export const CHARS_PER_TOKEN = 2.6;

export function estimateTokensFromChars(chars) {
  return Math.round(chars / CHARS_PER_TOKEN);
}

export function charsForTokens(tokens) {
  return Math.round(tokens * CHARS_PER_TOKEN);
}

// Segment pattern, approximating a BPE pre-tokenizer: latin words (incl.
// accented, À-ɏ), digit runs, space runs, newline runs, emoji
// clusters, then any other single character. CJK and other scripts fall through
// to the final "." (one segment per char) and are costed by charCode in the
// loop below -- no literal non-ASCII in the source.
const SEG =
  /[A-Za-zÀ-ɏ]+|\d+|[ \t]+|\r?\n(?:[ \t]*\r?\n)*|\p{Extended_Pictographic}(?:[\u{FE0F}\u{200D}]\p{Extended_Pictographic}?)*|./gsu;

export function estimateTokens(text) {
  let tokens = 0;
  SEG.lastIndex = 0;
  let m;
  while ((m = SEG.exec(text)) !== null) {
    const s = m[0];
    const c = s.charCodeAt(0);
    const L = s.length;
    if (
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      (c >= 0xc0 && c <= 0x24f)
    ) {
      // Latin word: common words (<=6 chars) are usually one token when
      // space-prefixed; longer ones split roughly every ~6-7 chars (cl100k
      // knows many long English words as a single merge).
      tokens += L <= 6 ? 1 : 1 + Math.round((L - 6) / 6.5);
    } else if (c >= 48 && c <= 57) {
      // Digit runs group ~3 digits per token in cl100k.
      tokens += Math.ceil(L / 3);
    } else if (c === 32 || c === 9) {
      // A single space merges into the following word token; longer runs
      // become one whitespace token.
      if (L > 1) tokens += 1;
    } else if (c === 10 || c === 13) {
      tokens += 1; // a newline run (incl. blank lines) ~= one token
    } else if (c >= 0x3000) {
      tokens += L >= 2 ? 3 : 1.5; // CJK char ~= 1.5; emoji cluster ~= 3
    } else {
      // Punctuation/symbols: common trailing marks merge with neighbours
      // (". ", "?!"), so a char is a bit less than one token on average.
      tokens += 0.82;
    }
  }
  return Math.round(tokens);
}
