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

function hourOf(ms, tz) {
  const d = new Date(ms);
  return tz === 'local' ? d.getHours() : d.getUTCHours();
}
function dayKeyOf(ms, tz) {
  const d = new Date(ms);
  const y = tz === 'local' ? d.getFullYear() : d.getUTCFullYear();
  const mo = (tz === 'local' ? d.getMonth() : d.getUTCMonth()) + 1;
  const day = tz === 'local' ? d.getDate() : d.getUTCDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const topEntry = (mp) => {
  let best = null;
  for (const [name, count] of mp)
    if (!best || count > best.count) best = { name, count };
  return best;
};

// messages: [{ authorId, authorName, ts, parts, isSystem }]
// stats: the computeAnalytics() result. tz: 'utc' | 'local' (for late-night /
// conversation-starter bucketing; charts come from the already-bucketed stats).
export function computeWrapped(messages, stats, tz) {
  tz = tz === 'local' ? 'local' : 'utc';
  const nameOf = new Map(stats.users.map((u) => [u.id, u.name]));

  const busiest = stats.timeline.reduce(
    (a, b) => (a && a.count >= b.count ? a : b),
    null,
  );

  // Weekly + hourly rhythm from the (tz-bucketed) heatmap. heatmap[dow][hour],
  // dow 0=Sun..6=Sat.
  const dow = new Array(7).fill(0);
  const hour = new Array(24).fill(0);
  for (let d = 0; d < 7; d++)
    for (let h = 0; h < 24; h++) {
      dow[d] += stats.heatmap[d][h];
      hour[h] += stats.heatmap[d][h];
    }
  let busiestDow = 0;
  for (let d = 1; d < 7; d++) if (dow[d] > dow[busiestDow]) busiestDow = d;

  // Late-night owls (00:00–05:59) and conversation starters (first message of a
  // day) — both need per-message bucketing in the selected timezone.
  const lateBy = new Map();
  const firstOfDay = new Map(); // dayKey -> { ts, author }
  for (const m of messages || []) {
    if (m.isSystem) continue;
    if (hourOf(m.ts, tz) < 6)
      lateBy.set(m.authorName, (lateBy.get(m.authorName) || 0) + 1);
    const dk = dayKeyOf(m.ts, tz);
    const cur = firstOfDay.get(dk);
    if (!cur || m.ts < cur.ts)
      firstOfDay.set(dk, { ts: m.ts, author: m.authorName });
  }
  const starterBy = new Map();
  for (const { author } of firstOfDay.values())
    starterBy.set(author, (starterBy.get(author) || 0) + 1);

  // Longest stretch of silence between two active days.
  const dayMs = stats.timeline
    .map((d) => Date.parse(d.date + 'T00:00:00Z'))
    .sort((a, b) => a - b);
  let quietGap = null;
  for (let i = 1; i < dayMs.length; i++) {
    const g = (dayMs[i] - dayMs[i - 1]) / 86400000 - 1;
    if (g > 0 && (!quietGap || g > quietGap.days))
      quietGap = { days: g, from: dayMs[i - 1], to: dayMs[i] };
  }

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
      longest = {
        len: text.length,
        name: m.authorName,
        text: snippet(text),
        ts: m.ts,
      };
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
    timeline: stats.timeline.map((x) => x.count), // daily counts for the sparkline
    dow, // number[7], 0=Sun..6=Sat
    hour, // number[24]
    busiestDow,
    top3: stats.users.slice(0, 3), // podium
    top3Emoji: stats.reactions.slice(0, 3),
    avgPerDay: stats.totals.activeDays
      ? Math.round(stats.totals.messages / stats.totals.activeDays)
      : 0,
    nightOwl: topEntry(lateBy), // { name, count } | null
    starter: topEntry(starterBy), // { name, count } | null
    quietGap, // { days, from, to } | null
  };
}
