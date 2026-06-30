// Shared helpers for the Preact Summary/Technical review cards. The bar palette
// and the output-flattening match the legacy renderStats (app.js) verbatim so
// the cards keep their exact appearance.

export const BAR_COLORS = [
  '#6c9eff',
  '#5ccf7f',
  '#e09a5c',
  '#e06c6c',
  '#a78bfa',
  '#f472b6',
  '#56c8e8',
  '#4dd4a0',
  '#f0a060',
  '#b89cff',
  '#40d0d0',
  '#8cd460',
  '#e88080',
  '#70b0ff',
  '#d088f0',
];

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
