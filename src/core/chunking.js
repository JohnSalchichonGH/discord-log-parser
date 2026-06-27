// Splits a message list into context-window-sized chunks with overlap.
// Uses the same conservative per-message cost as the budget trim (A7).

import { messageCost, legendReserve } from './budget.js';

export function chunkMessages(allMsgs, maxTokens, overlap) {
  const maxChars = maxTokens * 4;
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
