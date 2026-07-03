// Splits a message list into context-window-sized chunks with overlap.
// Uses the same conservative per-message cost as the budget trim (A7).

import { messageCost, legendReserve, effectiveBudget } from './budget.js';
import { charsForTokens } from './tokens.js';

export function chunkMessages(allMsgs, maxTokens, overlap) {
  // Reserve the same headroom as the single-file trim so each chunk fits the
  // model's real context window (see effectiveBudget).
  const maxChars = charsForTokens(effectiveBudget(maxTokens));
  const headerBudget = legendReserve(0);
  const chunks = [];
  let start = 0;

  while (start < allMsgs.length) {
    let chars = headerBudget;
    let end = start;
    while (end < allMsgs.length) {
      const cost = messageCost(allMsgs[end]);
      if (chars + cost > maxChars && end > start) break;
      chars += cost;
      end++;
    }
    chunks.push(allMsgs.slice(start, end));
    start = Math.max(start + 1, end - overlap);
    if (end >= allMsgs.length) break;
  }
  return chunks;
}
