// Token estimation. Centralizes the legacy "1 token ≈ 4 characters"
// approximation behind a single seam so Phase 3 can swap in a real tokenizer
// (e.g. gpt-tokenizer / tiktoken WASM) behind a toggle without touching callers.

export const CHARS_PER_TOKEN = 4;

export function estimateTokensFromChars(chars) {
  return Math.round(chars / CHARS_PER_TOKEN);
}

export function estimateTokens(text) {
  return estimateTokensFromChars(text.length);
}

export function charsForTokens(tokens) {
  return tokens * CHARS_PER_TOKEN;
}
