// Shared helpers for the Preact Summary/Technical review cards. Output-flattening
// matches the legacy renderStats (app.js) verbatim. Leaderboard bar colors are
// assigned by rank (ui/colors.js `rankColor`, keyed on the message-count order),
// so a person's bar matches their reply-network node and every ranked user gets a
// distinct color.

// Flatten the per-group processed outputs into one chunk list + a merged userMap
// (uid → display name), exactly as the legacy stats render did.
export function flattenOutputs(outputs) {
  const chunks = [];
  const userMap = new Map();
  for (const po of outputs) {
    for (const c of po.finalChunks) chunks.push(c);
    for (const [k, v] of po.userMap) userMap.set(k, v);
  }
  return { chunks, userMap };
}

// Per-author message counts, sorted high → low. The leaderboard + the budget
// breakdown both rank users by this.
export function userCounts(chunks) {
  const counts = {};
  for (const c of chunks) counts[c.authorId] = (counts[c.authorId] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
