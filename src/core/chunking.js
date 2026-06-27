// Splits a message list into context-window-sized chunks with overlap.
// Extracted verbatim from legacy index.html (chunkMessages).

export function chunkMessages(allMsgs, maxTokens, overlap) {
  const maxChars = maxTokens * 4;
  const headerBudget = 400 * 4;
  const chunks = [];
  let start = 0;

  while (start < allMsgs.length) {
    let chars = headerBudget;
    let end = start;
    while (end < allMsgs.length) {
      const cost = allMsgs[end].contentParts.join('\n').length + 15;
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
