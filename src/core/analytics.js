// Computes an analytics/stats object from processed messages for the Insights
// panel. Pure and dependency-free: everything is derived from the message
// timestamp, stable author id, and the contentParts tokens the pipeline already
// produces (media [IMG:…], reactions ^{👍:3}, replies > Uxx:).

// Split a message's contentParts into text, media count, reaction blob, reply.
// Reactions may be a standalone part ("^{👍:3}") or merged onto a text part
// ("hi ^{👍:3}"), so they are matched anywhere in a part.
function dissect(parts) {
  let media = 0;
  let isReply = false;
  let reactionBlob = null;
  const textPieces = [];
  for (const p of parts) {
    const rm = p.match(/\^\{([^}]*)\}/);
    if (rm) reactionBlob = rm[1];
    if (p.startsWith('> ')) {
      isReply = true;
      continue;
    }
    if (p.startsWith('[')) {
      media++;
      continue;
    }
    const t = p.replace(/\s*\^\{[^}]*\}\s*/g, '').trim();
    if (t) textPieces.push(t);
  }
  return { text: textPieces.join(' '), media, reactionBlob, isReply };
}

// Reply target short-id from a "> Uxx: snippet" part, or null.
function replyTarget(parts) {
  for (const p of parts) {
    const m = p.match(/^>\s*([^:]+):/);
    if (m) return m[1].trim();
  }
  return null;
}

// The media tokens the parsers actually emit (html/json/txt). Any other
// bracketed all-caps token — e.g. system-message content wrapped as "[OOOOOOOO]"
// by html.js — is NOT media and must not pollute the media breakdown.
const MEDIA_TYPES = new Set([
  'IMG',
  'GIF',
  'VID',
  'MEDIA',
  'YT',
  'EMBED',
  'STICKER',
]);

const D = (d, tz) => (tz === 'local' ? d.getDay() : d.getUTCDay()); // 0=Sun..6=Sat
const H = (d, tz) => (tz === 'local' ? d.getHours() : d.getUTCHours());
function dayKey(d, tz) {
  if (tz === 'local') {
    const y = d.getFullYear(),
      m = `${d.getMonth() + 1}`.padStart(2, '0'),
      day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return d.toISOString().slice(0, 10);
}

// messages: [{ authorId, authorName, timestamp: Date, contentParts, isSystem }]
// opts: { tz: 'utc' | 'local' }
export function computeAnalytics(messages, opts = {}) {
  const tz = opts.tz === 'local' ? 'local' : 'utc';

  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const byDay = new Map(); // dayKey -> count
  const users = new Map(); // id -> aggregate
  const reactions = new Map(); // emoji -> count
  const media = {}; // token type -> count
  const replyEdges = new Map(); // "from->to" -> count

  let minT = Infinity,
    maxT = -Infinity;

  for (const m of messages) {
    const t = m.timestamp;
    const ms = t.getTime();
    if (isNaN(ms)) continue;
    if (ms < minT) minT = ms;
    if (ms > maxT) maxT = ms;

    heatmap[D(t, tz)][H(t, tz)]++;
    const dk = dayKey(t, tz);
    byDay.set(dk, (byDay.get(dk) || 0) + 1);

    const {
      text,
      media: mediaCount,
      reactionBlob,
      isReply,
    } = dissect(m.contentParts);

    let u = users.get(m.authorId);
    if (!u) {
      u = {
        id: m.authorId,
        name: m.authorName,
        count: 0,
        words: 0,
        chars: 0,
        media: 0,
        replies: 0,
        firstSeen: ms,
        lastSeen: ms,
        days: new Set(),
      };
      users.set(m.authorId, u);
    }
    u.count++;
    u.chars += text.length;
    if (text) u.words += text.split(/\s+/).filter(Boolean).length;
    u.media += mediaCount;
    if (isReply) u.replies++;
    if (ms < u.firstSeen) u.firstSeen = ms;
    if (ms > u.lastSeen) u.lastSeen = ms;
    u.days.add(dk);

    // Media token types (whitelisted; non-media bracketed tokens are ignored)
    for (const p of m.contentParts) {
      const mm = p.match(/^\[([A-Z]+)(?::|\])/);
      if (mm && MEDIA_TYPES.has(mm[1])) media[mm[1]] = (media[mm[1]] || 0) + 1;
    }

    // Reactions
    if (reactionBlob) {
      for (const entry of reactionBlob.split(',')) {
        const [name, cnt] = entry.split(':');
        const emoji = (name || '').trim();
        if (emoji)
          reactions.set(
            emoji,
            (reactions.get(emoji) || 0) + (parseInt(cnt) || 1),
          );
      }
    }

    // Reply edges (for a future network view)
    if (isReply) {
      const to = replyTarget(m.contentParts);
      if (to) {
        const key = `${m.authorId}\t${to}`;
        replyEdges.set(key, (replyEdges.get(key) || 0) + 1);
      }
    }
  }

  // Peak hour across all days
  const hourTotals = new Array(24).fill(0);
  for (let d = 0; d < 7; d++)
    for (let h = 0; h < 24; h++) hourTotals[h] += heatmap[d][h];
  let peakHour = 0;
  for (let h = 1; h < 24; h++)
    if (hourTotals[h] > hourTotals[peakHour]) peakHour = h;

  const timeline = [...byDay.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const userList = [...users.values()]
    .map((u) => ({
      id: u.id,
      name: u.name,
      count: u.count,
      words: u.words,
      chars: u.chars,
      media: u.media,
      replies: u.replies,
      activeDays: u.days.size,
      avgLen: u.count ? Math.round(u.chars / u.count) : 0,
      firstSeen: u.firstSeen,
      lastSeen: u.lastSeen,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    tz,
    totals: {
      messages: messages.length,
      participants: users.size,
      activeDays: byDay.size,
      peakHour,
      reactions: [...reactions.values()].reduce((s, n) => s + n, 0),
      start: minT === Infinity ? null : minT,
      end: maxT === -Infinity ? null : maxT,
    },
    timeline,
    heatmap,
    users: userList,
    reactions: [...reactions.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    media,
    replyEdges: [...replyEdges.entries()].map(([k, count]) => {
      const [from, to] = k.split('\t');
      return { from, to, count };
    }),
  };
}
