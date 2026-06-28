// Derives a "Conversation Wrapped" highlight set — a punchy, shareable summary —
// from the analytics stats object plus the raw message DTOs. Pure and
// dependency-free; the renderer (ui/wrapped.js) turns this into an SVG poster.

const snippet = (s, n = 90) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// Consecutive-day streak from the sorted list of active day keys (YYYY-MM-DD).
function longestStreak(dayKeys) {
  const days = [...dayKeys].sort();
  let best = 0,
    run = 0,
    prev = null;
  for (const d of days) {
    const ms = Date.parse(d + 'T00:00:00Z');
    run = prev != null && ms - prev === 86400000 ? run + 1 : 1;
    if (run > best) best = run;
    prev = ms;
  }
  return best;
}

// Sum reaction counts in a message's parts (tokens like "^{👍:3, 🔥:1}").
function reactionTotal(parts) {
  let total = 0;
  for (const p of parts) {
    const blobs = p.match(/\^\{([^}]*)\}/g);
    if (!blobs) continue;
    for (const b of blobs)
      for (const entry of b.slice(2, -1).split(',')) {
        const i = entry.lastIndexOf(':');
        if (i >= 0) total += parseInt(entry.slice(i + 1)) || 0;
      }
  }
  return total;
}

// Plain text of a message (drops media tokens, reply quote, reaction blobs).
function plainText(parts) {
  const out = [];
  for (const p of parts) {
    if (p.startsWith('[') || p.startsWith('> ')) continue;
    const t = p.replace(/\s*\^\{[^}]*\}\s*/g, '').trim();
    if (t) out.push(t);
  }
  return out.join(' ');
}

// messages: [{ authorId, authorName, ts, parts, isSystem }]
// stats: the computeAnalytics() result.
export function computeWrapped(messages, stats) {
  const nameOf = new Map(stats.users.map((u) => [u.id, u.name]));

  const busiest = stats.timeline.reduce(
    (a, b) => (a && a.count >= b.count ? a : b),
    null,
  );

  let mostReacted = null;
  let longest = null;
  for (const m of messages || []) {
    if (m.isSystem) continue;
    const react = reactionTotal(m.parts);
    if (react > 0 && (!mostReacted || react > mostReacted.react))
      mostReacted = {
        react,
        name: m.authorName,
        text: snippet(plainText(m.parts) || '(media)'),
        ts: m.ts,
      };
    const text = plainText(m.parts);
    if (text && (!longest || text.length > longest.len))
      longest = { len: text.length, name: m.authorName, text: snippet(text), ts: m.ts };
  }

  const topPairEdge = stats.replyEdges
    .filter((e) => e.from !== e.to)
    .reduce((a, b) => (a && a.count >= b.count ? a : b), null);

  return {
    totals: stats.totals,
    streak: longestStreak(stats.timeline.map((d) => d.date)),
    busiest, // { date, count } | null
    topUser: stats.users[0] || null,
    topEmoji: stats.reactions[0] || null, // { name, count }
    totalMedia: Object.values(stats.media).reduce((s, n) => s + n, 0),
    totalWords: stats.users.reduce((s, u) => s + u.words, 0),
    mostReacted, // { react, name, text, ts } | null
    longest, // { len, name, text, ts } | null
    topPair: topPairEdge
      ? {
          from: nameOf.get(topPairEdge.from) || topPairEdge.from,
          to: nameOf.get(topPairEdge.to) || topPairEdge.to,
          count: topPairEdge.count,
        }
      : null,
  };
}
