// Runtime token-counting configuration.
//
// Defaults to the lightweight char/4 approximation. The accurate (BPE) build
// registers a loader via setAccurateLoader(); only that build pulls in the
// tokenizer, so the default single-file output stays small.

import { estimateTokens } from './tokens.js';

let counter = estimateTokens; // text -> token count
let accurateLoader = null; // async () -> (text -> token count)

// Called by the accurate build's entry to advertise an accurate counter loader.
export function setAccurateLoader(loader) {
  accurateLoader = loader;
}

// Whether an accurate tokenizer is available in this build.
export function hasAccurate() {
  return !!accurateLoader;
}

// Switch to the accurate counter (loads it on first use).
export async function enableAccurate() {
  if (accurateLoader) counter = await accurateLoader();
}

export function disableAccurate() {
  counter = estimateTokens;
}

// Count tokens with the currently-selected counter.
export function countTokens(text) {
  return counter(text);
}
