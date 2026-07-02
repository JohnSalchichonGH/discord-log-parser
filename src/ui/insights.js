// Renders the Insights panel charts from a computeAnalytics() stats object.
// Hand-rolled SVG/HTML, theme-aware via the app's CSS variables (no chart deps).

import { escHtml } from '../core/format.js';
import { rankColor } from './colors.js';

const $ = (id) => document.getElementById(id);
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // display order
const DOW_IDX = [1, 2, 3, 4, 5, 6, 0]; // map display row -> JS getDay index

function hourLabel(h) {
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 || 12;
  return `${hh} ${ap}`;
}
function shortDate(ms, tz) {
  if (ms == null) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz === 'local' ? undefined : 'UTC',
  });
}

function metricsHtml(t, tz) {
  const cards = [
    ['Messages', t.messages.toLocaleString()],
    ['Participants', t.participants.toLocaleString()],
    ['Active days', t.activeDays.toLocaleString()],
    ['Peak hour', hourLabel(t.peakHour)],
    ['Reactions', t.reactions.toLocaleString()],
    ['Date range', `${shortDate(t.start, tz)} – ${shortDate(t.end, tz)}`],
  ];
  return cards
    .map(
      ([label, val], i) =>
        `<div class="stat-card"${i === 5 ? ' style="grid-column:span 2;"' : ''}>
           <div class="stat-value"${i === 5 ? ' style="font-size:14px;"' : ''}>${escHtml(String(val))}</div>
           <div class="stat-label">${label}</div>
         </div>`,
    )
    .join('');
}

function heatmapSvg(heatmap) {
  let max = 1;
  for (let d = 0; d < 7; d++)
    for (let h = 0; h < 24; h++) max = Math.max(max, heatmap[d][h]);
  const cell = 22,
    gap = 4,
    lab = 38,
    both = 36; // room for the hour axis + a color legend row
  const w = lab + 24 * (cell + gap);
  const h = 7 * (cell + gap) + both;
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Activity by weekday and hour">`;
  for (let row = 0; row < 7; row++) {
    const y = row * (cell + gap);
    s += `<text x="0" y="${y + 15}" font-size="11" fill="var(--text-muted)">${DOW[row]}</text>`;
    for (let hr = 0; hr < 24; hr++) {
      const v = heatmap[DOW_IDX[row]][hr];
      const op = v === 0 ? 0 : 0.15 + 0.85 * (v / max);
      const x = lab + hr * (cell + gap);
      s += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="var(--accent)" fill-opacity="${op.toFixed(3)}" stroke="var(--border)" stroke-width="0.5"><title>${DOW[row]} ${hourLabel(hr)}: ${v}</title></rect>`;
    }
  }
  [0, 6, 12, 18, 23].forEach((hr) => {
    s += `<text x="${lab + hr * (cell + gap)}" y="${7 * (cell + gap) + 11}" font-size="10" fill="var(--text-muted)">${hr}</text>`;
  });

  // Color legend (Less → More) with numeric context for the busiest cell.
  const legTop = 7 * (cell + gap) + 20;
  const legText = legTop + 9;
  s += `<text x="0" y="${legText}" font-size="10" fill="var(--text-muted)">max ${max}/hr</text>`;
  const sw = 13,
    sh = 11,
    steps = [0.3, 0.52, 0.74, 1];
  let lx = w - (28 + steps.length * (sw + 2) + 34);
  s += `<text x="${lx}" y="${legText}" font-size="10" fill="var(--text-muted)">Less</text>`;
  lx += 26;
  for (const op of steps) {
    s += `<rect x="${lx}" y="${legTop}" width="${sw}" height="${sh}" rx="2" fill="var(--accent)" fill-opacity="${op}" stroke="var(--border)" stroke-width="0.5"></rect>`;
    lx += sw + 2;
  }
  s += `<text x="${lx + 4}" y="${legText}" font-size="10" fill="var(--text-muted)">More</text>`;
  return s + '</svg>';
}

function timelineSvg(timeline) {
  if (timeline.length === 0)
    return '<div style="color:var(--text-muted);font-size:13px;">No data.</div>';
  const w = 800,
    h = 150,
    pad = 6;
  const max = Math.max(1, ...timeline.map((d) => d.count));
  const n = timeline.length;
  const x = (i) => (n === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (c) => h - pad - (c / max) * (h - 2 * pad - 14);
  const pts = timeline.map(
    (d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`,
  );
  const area = `M${x(0).toFixed(1)},${h - pad} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${h - pad} Z`;
  const line = `M${pts.join(' L')}`;
  const first = timeline[0].date,
    last = timeline[n - 1].date;
  return (
    `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Messages over time">` +
    `<path d="${area}" fill="var(--accent)" fill-opacity="0.12"></path>` +
    `<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2"></path>` +
    `<text x="${pad}" y="${h - 2}" font-size="10" fill="var(--text-muted)">${first}</text>` +
    `<text x="${w - pad}" y="${h - 2}" font-size="10" fill="var(--text-muted)" text-anchor="end">${last}</text>` +
    `<text x="${pad}" y="12" font-size="10" fill="var(--text-muted)">peak ${max}/day</text>` +
    `</svg>`
  );
}

function leaderboardHtml(users) {
  if (users.length === 0)
    return '<div style="color:var(--text-muted);font-size:13px;">No participants.</div>';
  const top = users.slice(0, 12);
  const max = top[0].count;
  return top
    .map((u, i) => {
      const pct = Math.max(2, Math.round((u.count / max) * 100));
      const color = rankColor(i);
      return `<div class="chart-bar-row insight-clickable" data-uid="${escHtml(u.id)}" style="cursor:pointer;" title="${escHtml(u.name)} · ${u.words.toLocaleString()} words · ${u.media} media · ${u.replies} replies · ${u.activeDays} active days — click to focus">
        <span class="chart-bar-label" style="width:110px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(u.name)}</span>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%;background:${color};">${u.count.toLocaleString()}</div></div>
      </div>`;
    })
    .join('');
}

function listHtml(rows, emptyLabel) {
  if (rows.length === 0)
    return `<div style="color:var(--text-muted);font-size:13px;">${emptyLabel}</div>`;
  const max = rows[0][1];
  return rows
    .slice(0, 8)
    .map(([label, count]) => {
      const pct = Math.max(2, Math.round((count / max) * 100));
      return `<div class="chart-bar-row">
        <span class="chart-bar-label" style="width:90px;text-align:left;">${escHtml(String(label))}</span>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%;background:#a78bfa;">${count.toLocaleString()}</div></div>
      </div>`;
    })
    .join('');
}

export function renderInsights(stats) {
  $('insightMetrics').innerHTML = metricsHtml(stats.totals, stats.tz);
  $('insightHeatmap').innerHTML = heatmapSvg(stats.heatmap);
  $('insightTimeline').innerHTML = timelineSvg(stats.timeline);
  $('insightUsers').innerHTML = leaderboardHtml(stats.users);
  $('insightReactions').innerHTML = listHtml(
    stats.reactions.map((r) => [r.name, r.count]),
    'No reactions.',
  );
  $('insightMedia').innerHTML = listHtml(
    Object.entries(stats.media).sort((a, b) => b[1] - a[1]),
    'No media.',
  );
}

// ── Reply network ────────────────────────────────────────────────────────────

// Force-directed layout (Fruchterman-Reingold with a cooling schedule + gravity),
// run once. Repulsion (all pairs) spreads nodes out; edge attraction pulls
// connected people together; gravity keeps the whole graph centered so weakly-
// connected nodes don't pile onto the walls. Every edge gets a baseline pull so
// people who talk cluster at all, with reply-affinity (e.w) adding extra pull on
// top — so your strongest partners land closest, not just somewhere on the rim.
function layout(nodes, edges, w, h, iters) {
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  // Seed on a circle (deterministic — no randomness, so the layout is stable).
  const pos = nodes.map((_, i) => ({
    x: w / 2 + Math.cos((2 * Math.PI * i) / n) * w * 0.28,
    y: h / 2 + Math.sin((2 * Math.PI * i) / n) * h * 0.28,
  }));
  // Node radii (match networkSvg) so repulsion can keep big circles apart by
  // their SURFACES, not their centres — otherwise the biggest nodes pile up.
  const maxCount = Math.max(1, ...nodes.map((nd) => nd.count));
  const rad = (c) => 8 + 18 * Math.sqrt(c / maxCount);
  const radOf = nodes.map((nd) => rad(nd.count));

  // Ideal separation, scaled down so a hub-and-spoke graph stays inside the
  // viewport instead of flinging its leaves to the walls.
  const k = Math.sqrt((w * h) / n) * 0.55;
  let temp = w * 0.15; // max step per iter, cooled linearly toward 0
  const cool = temp / (iters + 1);

  for (let it = 0; it < iters; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));

    // Repulsion between every pair, measured from the surface gap so larger
    // nodes reserve proportionally more room: fr = k² / gap.
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x,
          dy = pos[i].y - pos[j].y;
        const d = Math.hypot(dx, dy) || 0.01;
        const gap = Math.max(d - radOf[i] - radOf[j], 6);
        const fr = (k * k) / gap;
        dx /= d;
        dy /= d;
        disp[i].x += dx * fr;
        disp[i].y += dy * fr;
        disp[j].x -= dx * fr;
        disp[j].y -= dy * fr;
      }

    // Attraction along edges: fa = (d² / k) · weight, weight = baseline+affinity.
    for (const e of edges) {
      const a = idx.get(e.a),
        b = idx.get(e.b);
      if (a == null || b == null || a === b) continue;
      let dx = pos[a].x - pos[b].x,
        dy = pos[a].y - pos[b].y;
      const d = Math.hypot(dx, dy) || 0.01;
      // Affinity dominates the pull (wide range) so your strongest partners are
      // pulled distinctly closer than the crowd, not merely somewhere inside.
      const fa = ((d * d) / k) * (0.2 + 2.8 * e.w);
      dx /= d;
      dy /= d;
      disp[a].x -= dx * fa;
      disp[a].y -= dy * fa;
      disp[b].x += dx * fa;
      disp[b].y += dy * fa;
    }

    // Gravity toward the center keeps loosely-connected nodes (and fully
    // disconnected pairs) off the walls instead of pinned in a corner.
    for (let i = 0; i < n; i++) {
      disp[i].x += (w / 2 - pos[i].x) * 0.13;
      disp[i].y += (h / 2 - pos[i].y) * 0.13;
    }

    // Apply displacement, capped by the current temperature; then clamp to view.
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(disp[i].x, disp[i].y) || 0.01;
      pos[i].x += (disp[i].x / d) * Math.min(d, temp);
      pos[i].y += (disp[i].y / d) * Math.min(d, temp);
      pos[i].x = Math.max(24, Math.min(w - 24, pos[i].x));
      // Leave room below the lowest node for its name label (drawn at
      // y + radius + 12) so bottom-row labels don't clip past the viewBox.
      pos[i].y = Math.max(20, Math.min(h - 42, pos[i].y));
    }
    temp -= cool;
  }

  // Final pass: separate any overlapping nodes so circles (and their labels)
  // never stack — including fully-overlapping disconnected pairs.
  for (let pass = 0; pass < 24; pass++) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x,
          dy = pos[i].y - pos[j].y;
        let d = Math.hypot(dx, dy);
        if (d < 0.5) {
          // Exactly stacked: pick a deterministic direction to break the tie.
          dx = i - j || 1;
          dy = 1;
          d = Math.hypot(dx, dy);
        }
        const min = radOf[i] + radOf[j] + 18;
        if (d < min) {
          const push = (min - d) / 2;
          dx /= d;
          dy /= d;
          pos[i].x += dx * push;
          pos[i].y += dy * push;
          pos[j].x -= dx * push;
          pos[j].y -= dy * push;
        }
      }
    for (let i = 0; i < n; i++) {
      pos[i].x = Math.max(24, Math.min(w - 24, pos[i].x));
      pos[i].y = Math.max(20, Math.min(h - 42, pos[i].y));
    }
  }

  // Re-center: shift the whole graph so its bounding box sits in the middle of
  // the frame (the sim can settle off to one side, especially with a detached
  // cluster). Radii are included so nodes don't clip the edges; labels sit below
  // a node, so the bottom margin is a little larger.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, pos[i].x - radOf[i]);
    maxX = Math.max(maxX, pos[i].x + radOf[i]);
    minY = Math.min(minY, pos[i].y - radOf[i]);
    maxY = Math.max(maxY, pos[i].y + radOf[i] + 14);
  }
  const shiftX = (w - (minX + maxX)) / 2;
  const shiftY = (h - (minY + maxY)) / 2;
  for (let i = 0; i < n; i++) {
    pos[i].x += shiftX;
    pos[i].y += shiftY;
  }
  return pos;
}

// Only pairs with at least this many replies exchanged are graphed — filters out
// one-off "@reply" noise so the network shows relationships, not every stray link.
const MIN_PAIR_REPLIES = 3;

// Build the node/edge set for the reply network, or null when there's nothing
// to graph. Only participants who actually reply to / are replied to by someone
// belong here — restricting to connected users keeps TXT exports (which carry no
// reply data) and other reply-less participants out entirely.
//
// Edges are UNDIRECTED pairs weighted by reciprocal reply-affinity: each side's
// share of its OWN replies that goes to the other, combined as a geometric mean.
// Normalizing by each person's total replies (rather than using the raw count)
// stops high-volume users from clumping in the centre just for being busy, and
// the geometric mean rewards genuine two-way bonds over one-sided "fan" replies.
export function buildNetwork(stats) {
  // Total replies SENT by each user — the affinity denominator.
  const outReplies = new Map();
  for (const e of stats.replyEdges) {
    if (e.from === e.to) continue;
    outReplies.set(e.from, (outReplies.get(e.from) || 0) + e.count);
  }

  // Collapse the two directional edges of a pair into one undirected record.
  const pairs = new Map(); // "a\tb" (a<b) -> { a, b, ab, ba, raw }
  for (const e of stats.replyEdges) {
    if (e.from === e.to) continue;
    const [a, b] = e.from < e.to ? [e.from, e.to] : [e.to, e.from];
    const key = a + '\t' + b;
    let p = pairs.get(key);
    if (!p) pairs.set(key, (p = { a, b, ab: 0, ba: 0, raw: 0 }));
    if (e.from === a) p.ab += e.count;
    else p.ba += e.count;
    p.raw += e.count;
  }
  if (pairs.size === 0) return null;

  const connected = new Set();
  for (const p of pairs.values()) {
    connected.add(p.a);
    connected.add(p.b);
  }
  // Top connected users by message count (nodes are sized by messages). Each
  // node carries its global rank so it can be colored to match the leaderboard.
  const rankOf = new Map(stats.users.map((u, i) => [u.id, i]));
  let nodes = stats.users
    .filter((u) => connected.has(u.id))
    .slice(0, 28)
    .map((u) => ({
      id: u.id,
      name: u.name,
      count: u.count,
      rank: rankOf.get(u.id),
    }));
  let nodeIds = new Set(nodes.map((n) => n.id));

  // Keep pairs whose both endpoints are shown and that clear the noise floor.
  let edges = [];
  for (const p of pairs.values()) {
    if (!nodeIds.has(p.a) || !nodeIds.has(p.b)) continue;
    if (p.raw < MIN_PAIR_REPLIES) continue;
    const sa = p.ab / (outReplies.get(p.a) || 1);
    const sb = p.ba / (outReplies.get(p.b) || 1);
    edges.push({
      a: p.a,
      b: p.b,
      ab: p.ab,
      ba: p.ba,
      raw: p.raw,
      weight: Math.sqrt(sa * sb),
    });
  }
  // Drop any node left without a surviving edge.
  const withEdge = new Set();
  for (const e of edges) {
    withEdge.add(e.a);
    withEdge.add(e.b);
  }
  nodes = nodes.filter((n) => withEdge.has(n.id));
  nodeIds = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => nodeIds.has(e.a) && nodeIds.has(e.b));
  if (nodes.length < 2) return null;

  // Normalize weights to [0,1] for drawing + layout. If every surviving pair is
  // one-directional (affinity 0), fall back to raw volume so edges still differ.
  let maxW = 0;
  for (const e of edges) maxW = Math.max(maxW, e.weight);
  if (maxW > 0) for (const e of edges) e.w = e.weight / maxW;
  else {
    let maxRaw = 0;
    for (const e of edges) maxRaw = Math.max(maxRaw, e.raw);
    for (const e of edges) e.w = maxRaw ? e.raw / maxRaw : 0;
  }
  return { nodes, edges };
}

function networkSvg(net, focusId) {
  const { nodes, edges } = net;
  // Lay out on a roomy canvas, then fit the viewBox to the result. More space
  // between nodes relative to the fixed label size is what stops labels from
  // colliding; the relative geometry (who's near whom) is a uniform scale, so
  // it's untouched.
  const LW = 1000,
    LH = 660;
  const pos = layout(nodes, edges, LW, LH, 220);
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));
  const colorOf = new Map(nodes.map((n) => [n.id, rankColor(n.rank)]));
  const maxCount = nodes[0].count || 1;
  const r = (c) => 8 + 18 * Math.sqrt(c / maxCount);

  // Neighbours of the focused node (either direction) for highlighting.
  // When a participant is focused, fade every node by how much it interacts with
  // them: the focused node stays solid, its reply partners scale up with the
  // number of replies exchanged (sqrt so mid-level partners still read), and
  // people with no interaction sit at a faint — but still visible — floor.
  const focusRaw = new Map();
  let focusMax = 1;
  if (focusId) {
    for (const e of edges) {
      const other = e.a === focusId ? e.b : e.b === focusId ? e.a : null;
      if (other != null) {
        focusRaw.set(other, e.raw);
        if (e.raw > focusMax) focusMax = e.raw;
      }
    }
  }
  const nodeOpacity = (id) => {
    if (!focusId || id === focusId) return 1;
    const raw = focusRaw.get(id);
    return raw == null ? 0.12 : 0.4 + 0.6 * Math.sqrt(raw / focusMax);
  };

  // Fit the viewBox to the laid-out graph (nodes + their radii, plus a little
  // extra below each node for its label), so it's centered and fully visible.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  nodes.forEach((nd, i) => {
    const rr = r(nd.count);
    minX = Math.min(minX, pos[i].x - rr);
    maxX = Math.max(maxX, pos[i].x + rr);
    minY = Math.min(minY, pos[i].y - rr);
    maxY = Math.max(maxY, pos[i].y + rr + 16);
  });
  const pad = 14;
  const vb = `${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${(maxX - minX + 2 * pad).toFixed(0)} ${(maxY - minY + 2 * pad).toFixed(0)}`;

  // The .net-vp group is what pan/zoom transforms; the viewBox stays fixed.
  let svg = `<svg viewBox="${vb}" width="100%" style="display:block;max-height:560px;cursor:grab;touch-action:none;user-select:none" role="img" aria-label="Reply network — scroll to zoom, drag to pan">`;
  // Edges first (under the nodes). Thickness + opacity track the same normalized
  // affinity weight the layout uses, so a bolder line always means "closer". Each
  // line is a gradient from one person's color to the other's, so it visibly
  // connects the two participants.
  let defs = '';
  let edgeStr = '';
  edges.forEach((e, i) => {
    const a = pos[idx.get(e.a)],
      b = pos[idx.get(e.b)];
    const touchesFocus = focusId && (e.a === focusId || e.b === focusId);
    const faded = focusId && !touchesFocus;
    const op = faded ? 0.04 : 0.12 + 0.6 * e.w;
    const sw = (0.6 + 3.2 * e.w).toFixed(2);
    const na = escHtml(nameOf.get(e.a) || e.a);
    const nb = escHtml(nameOf.get(e.b) || e.b);
    defs += `<linearGradient id="ng${i}" gradientUnits="userSpaceOnUse" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"><stop offset="0" stop-color="${colorOf.get(e.a)}"></stop><stop offset="1" stop-color="${colorOf.get(e.b)}"></stop></linearGradient>`;
    edgeStr += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="url(#ng${i})" stroke-opacity="${op.toFixed(3)}" stroke-width="${sw}"><title>${na} ↔ ${nb}: ${e.raw.toLocaleString()} replies (${na}→${nb} ${e.ab.toLocaleString()}, ${nb}→${na} ${e.ba.toLocaleString()})</title></line>`;
  });
  svg += `<defs>${defs}</defs><g class="net-vp">${edgeStr}`;
  // Nodes + labels on top.
  nodes.forEach((n, i) => {
    const p = pos[i];
    const rad = r(n.count);
    const isFocus = n.id === focusId;
    const o = nodeOpacity(n.id);
    const fillOp = isFocus ? 1 : 0.92;
    // Ring: the focused node gets a bold white outline; the people it interacted
    // with get a thinner white ring (which fades with the node's interaction-
    // graded opacity); everyone else keeps the plain dark separator ring.
    const interacted = focusId && focusRaw.has(n.id);
    const ringColor =
      isFocus || interacted ? 'var(--text-primary)' : 'var(--bg-secondary)';
    const ringW = isFocus ? 2.5 : interacted ? 1.5 : 2;
    const label = escHtml(
      n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name,
    );
    svg += `<g class="net-node" data-uid="${escHtml(n.id)}" style="cursor:pointer" opacity="${o}"><title>${escHtml(n.name)} · ${n.count.toLocaleString()} messages</title>`;
    svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${colorOf.get(n.id)}" fill-opacity="${fillOp}" stroke="${ringColor}" stroke-width="${ringW}"></circle>`;
    // Halo (paint-order: stroke) keeps labels legible over nodes/edges.
    svg += `<text x="${p.x.toFixed(1)}" y="${(p.y + rad + 12).toFixed(1)}" font-size="11" text-anchor="middle" paint-order="stroke" stroke="var(--bg-secondary)" stroke-width="3" stroke-linejoin="round" fill="var(--text-secondary)">${label}</text>`;
    svg += `</g>`;
  });
  svg += '</g></svg>';

  // Legend (plain HTML under the SVG, so it never pans/zooms with the graph):
  // decodes node size and line weight for a first-time viewer.
  const legend =
    `<div class="net-legend" style="display:flex;gap:20px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);margin-top:2px;">` +
    `<span><svg width="30" height="12" style="vertical-align:middle"><circle cx="6" cy="6" r="3" fill="var(--accent)" fill-opacity="0.9"></circle><circle cx="21" cy="6" r="5.5" fill="var(--accent)" fill-opacity="0.9"></circle></svg> bigger = more messages</span>` +
    `<span><svg width="38" height="12" style="vertical-align:middle"><line x1="2" y1="6" x2="15" y2="6" stroke="var(--accent)" stroke-width="1"></line><line x1="21" y1="6" x2="36" y2="6" stroke="var(--accent)" stroke-width="3.5"></line></svg> thicker / closer = stronger two-way reply bond</span>` +
    `</div>`;
  return svg + legend;
}

function replyPartnersHtml(stats, focusId) {
  if (!focusId) return '';
  const nameOf = new Map(stats.users.map((u) => [u.id, u.name]));
  const repliesTo = new Map();
  const repliedBy = new Map();
  for (const e of stats.replyEdges) {
    if (e.from === e.to) continue;
    if (e.from === focusId)
      repliesTo.set(e.to, (repliesTo.get(e.to) || 0) + e.count);
    if (e.to === focusId)
      repliedBy.set(e.from, (repliedBy.get(e.from) || 0) + e.count);
  }
  const top = (mp) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const rows = (list, empty) =>
    list.length
      ? list
          .map(
            ([id, c]) =>
              `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span style="color:var(--text-primary);">${escHtml(nameOf.get(id) || id)}</span><span style="color:var(--text-secondary);font-family:var(--font-mono);">${c.toLocaleString()}</span></div>`,
          )
          .join('')
      : `<div style="color:var(--text-muted);font-size:13px;">${empty}</div>`;
  return (
    `<div class="cols-2" style="margin-top:6px;">` +
    `<div><div class="form-label">Replies to</div>${rows(top(repliesTo), 'None.')}</div>` +
    `<div><div class="form-label">Replied to by</div>${rows(top(repliedBy), 'None.')}</div>` +
    `</div>`
  );
}

// Pan/zoom view state, persisted across re-renders (e.g. focus changes) so the
// user's framing survives a redraw. Reset when a new dataset is loaded.
const netView = { s: 1, tx: 0, ty: 0 };
export function resetNetView() {
  netView.s = 1;
  netView.tx = 0;
  netView.ty = 0;
}

// Wire scroll-to-zoom (around the cursor) and drag-to-pan onto a freshly
// rendered network SVG, plus click-to-focus that ignores drags. All listeners
// live on the <svg>, which is replaced on every render, so nothing accumulates.
function wireNetwork(host, onNodeClick) {
  const svg = host.querySelector('svg');
  const vp = host.querySelector('.net-vp');
  if (!svg || !vp) return;

  const apply = () =>
    vp.setAttribute(
      'transform',
      `translate(${netView.tx.toFixed(2)} ${netView.ty.toFixed(2)}) scale(${netView.s.toFixed(3)})`,
    );
  // Client coords -> viewBox units (accounts for viewBox + preserveAspectRatio).
  const toVB = (e) => {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const r = p.matrixTransform(m.inverse());
    return { x: r.x, y: r.y };
  };

  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const { x, y } = toVB(e);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const s2 = Math.max(0.4, Math.min(6, netView.s * factor));
      const k = s2 / netView.s;
      // Keep the point under the cursor fixed while scaling.
      netView.tx = x - (x - netView.tx) * k;
      netView.ty = y - (y - netView.ty) * k;
      netView.s = s2;
      apply();
    },
    { passive: false },
  );

  // Focus is resolved from the node under the *pointerdown* and fired on
  // pointerup, NOT from the click event: because we take pointer capture on the
  // svg for panning, the browser retargets the subsequent click to the svg
  // itself, so a click handler would never see the node. We also gate it on a
  // small movement threshold so a pan drag never counts as a focus click.
  let dragging = false,
    moved = false,
    last = null,
    downNode = null,
    startClient = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    last = toVB(e);
    startClient = { x: e.clientX, y: e.clientY };
    downNode = e.target.closest('.net-node');
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* not all pointer ids are capturable */
    }
    svg.style.cursor = 'grabbing';
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (
      !moved &&
      (Math.abs(e.clientX - startClient.x) > 4 ||
        Math.abs(e.clientY - startClient.y) > 4)
    )
      moved = true;
    const cur = toVB(e);
    netView.tx += cur.x - last.x;
    netView.ty += cur.y - last.y;
    last = cur;
    apply();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    svg.style.cursor = 'grab';
    if (svg.hasPointerCapture(e.pointerId))
      svg.releasePointerCapture(e.pointerId);
    // A press that didn't turn into a drag, on a node, is a focus click.
    if (!moved && downNode && onNodeClick)
      onNodeClick(downNode.getAttribute('data-uid'));
    downNode = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // Double-click empty space resets the view.
  svg.addEventListener('dblclick', (e) => {
    if (e.target.closest('.net-node')) return;
    resetNetView();
    apply();
  });

  apply();
}

// Render the reply network. Returns false (and clears the host) when there's
// nothing to graph, so the caller can hide the whole section.
export function renderNetwork(stats, focusId, onNodeClick) {
  const host = $('insightNetwork');
  const net = buildNetwork(stats);
  if (!net) {
    host.innerHTML = '';
    return false;
  }
  host.innerHTML = networkSvg(net, focusId);
  wireNetwork(host, onNodeClick);
  return true;
}

export function renderPartners(stats, focusId) {
  const el = $('insightPartners');
  const html = replyPartnersHtml(stats, focusId);
  el.innerHTML = html;
  el.style.display = html ? 'block' : 'none';
}
