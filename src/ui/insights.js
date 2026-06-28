// Renders the Insights panel charts from a computeAnalytics() stats object.
// Hand-rolled SVG/HTML, theme-aware via the app's CSS variables (no chart deps).

import { escHtml } from '../core/format.js';

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
    both = 16;
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

const BAR_COLORS = ['#6c9eff', '#5ccf7f', '#e09a5c', '#e06c6c', '#a78bfa'];

function leaderboardHtml(users) {
  if (users.length === 0)
    return '<div style="color:var(--text-muted);font-size:13px;">No participants.</div>';
  const top = users.slice(0, 12);
  const max = top[0].count;
  return top
    .map((u, i) => {
      const pct = Math.max(2, Math.round((u.count / max) * 100));
      const color = BAR_COLORS[i % BAR_COLORS.length];
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

// Tiny force-directed layout (repulsion + edge springs + center pull), run once.
function layout(nodes, edges, w, h, iters) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const pos = nodes.map((_, i) => ({
    x: w / 2 + Math.cos((2 * Math.PI * i) / nodes.length) * w * 0.32,
    y: h / 2 + Math.sin((2 * Math.PI * i) / nodes.length) * h * 0.32,
    vx: 0,
    vy: 0,
  }));
  const k = Math.sqrt((w * h) / Math.max(1, nodes.length));
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = pos[i].x - pos[j].x,
          dy = pos[i].y - pos[j].y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = ((k * k) / d) * 0.032;
        dx /= d;
        dy /= d;
        pos[i].vx += dx * f;
        pos[i].vy += dy * f;
        pos[j].vx -= dx * f;
        pos[j].vy -= dy * f;
      }
    for (const e of edges) {
      const a = idx.get(e.from),
        b = idx.get(e.to);
      if (a == null || b == null || a === b) continue;
      let dx = pos[a].x - pos[b].x,
        dy = pos[a].y - pos[b].y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = ((d * d) / k) * 0.0009 * Math.min(6, e.count);
      dx /= d;
      dy /= d;
      pos[a].vx -= dx * f;
      pos[a].vy -= dy * f;
      pos[b].vx += dx * f;
      pos[b].vy += dy * f;
    }
    for (let i = 0; i < nodes.length; i++) {
      pos[i].vx += (w / 2 - pos[i].x) * 0.006;
      pos[i].vy += (h / 2 - pos[i].y) * 0.006;
      pos[i].x += Math.max(-16, Math.min(16, pos[i].vx));
      pos[i].y += Math.max(-16, Math.min(16, pos[i].vy));
      pos[i].vx *= 0.86;
      pos[i].vy *= 0.86;
      pos[i].x = Math.max(24, Math.min(w - 24, pos[i].x));
      pos[i].y = Math.max(20, Math.min(h - 24, pos[i].y));
    }
  }
  return pos;
}

// Build the node/edge set for the reply network, or null when there's nothing
// to graph. Only participants who actually reply to / are replied to by someone
// belong here — restricting to connected users keeps TXT exports (which carry no
// reply data) and other reply-less participants out entirely.
function buildNetwork(stats) {
  const realEdges = stats.replyEdges.filter((e) => e.from !== e.to);
  if (realEdges.length === 0) return null;

  const connected = new Set();
  for (const e of realEdges) {
    connected.add(e.from);
    connected.add(e.to);
  }
  // Top connected users by message count (already sorted desc in stats.users).
  let nodes = stats.users
    .filter((u) => connected.has(u.id))
    .slice(0, 28)
    .map((u) => ({ id: u.id, name: u.name, count: u.count }));
  let nodeIds = new Set(nodes.map((n) => n.id));
  let edges = realEdges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  // After capping the node count, drop any node left without a visible edge.
  const withEdge = new Set();
  for (const e of edges) {
    withEdge.add(e.from);
    withEdge.add(e.to);
  }
  nodes = nodes.filter((n) => withEdge.has(n.id));
  nodeIds = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  if (nodes.length < 2) return null;
  return { nodes, edges };
}

function networkSvg(net, focusId) {
  const { nodes, edges } = net;
  const w = 700,
    h = 460;
  const pos = layout(nodes, edges, w, h, 220);
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const maxCount = nodes[0].count || 1;
  const maxEdge = Math.max(...edges.map((e) => e.count));
  const r = (c) => 8 + 18 * Math.sqrt(c / maxCount);

  // Neighbours of the focused node (either direction) for highlighting.
  const neighbours = new Set();
  if (focusId) {
    neighbours.add(focusId);
    for (const e of edges) {
      if (e.from === focusId) neighbours.add(e.to);
      if (e.to === focusId) neighbours.add(e.from);
    }
  }
  const dim = (id) => focusId && !neighbours.has(id);

  // The .net-vp group is what pan/zoom transforms; the SVG viewBox stays fixed.
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block;max-height:520px;cursor:grab;touch-action:none;user-select:none" role="img" aria-label="Reply network — scroll to zoom, drag to pan">`;
  svg += `<g class="net-vp">`;
  // Edges first (under the nodes).
  for (const e of edges) {
    const a = pos[idx.get(e.from)],
      b = pos[idx.get(e.to)];
    const touchesFocus = focusId && (e.from === focusId || e.to === focusId);
    const faded = focusId && !touchesFocus;
    const op = faded ? 0.04 : 0.18 + 0.55 * (e.count / maxEdge);
    const sw = (0.7 + 3 * (e.count / maxEdge)).toFixed(2);
    svg += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="var(--accent)" stroke-opacity="${op.toFixed(3)}" stroke-width="${sw}"></line>`;
  }
  // Nodes + labels on top.
  nodes.forEach((n, i) => {
    const p = pos[i];
    const rad = r(n.count);
    const isFocus = n.id === focusId;
    const o = dim(n.id) ? 0.18 : 1;
    const fillOp = isFocus ? 1 : 0.92;
    const label = escHtml(
      n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name,
    );
    svg += `<g class="net-node" data-uid="${escHtml(n.id)}" style="cursor:pointer" opacity="${o}"><title>${escHtml(n.name)} · ${n.count.toLocaleString()} messages</title>`;
    svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rad.toFixed(1)}" fill="var(--accent)" fill-opacity="${fillOp}" stroke="${isFocus ? 'var(--text-primary)' : 'var(--bg-secondary)'}" stroke-width="${isFocus ? 2.5 : 2}"></circle>`;
    // Halo (paint-order: stroke) keeps labels legible over nodes/edges.
    svg += `<text x="${p.x.toFixed(1)}" y="${(p.y + rad + 12).toFixed(1)}" font-size="11" text-anchor="middle" paint-order="stroke" stroke="var(--bg-secondary)" stroke-width="3" stroke-linejoin="round" fill="var(--text-secondary)">${label}</text>`;
    svg += `</g>`;
  });
  return svg + '</g></svg>';
}

function replyPartnersHtml(stats, focusId) {
  if (!focusId) return '';
  const nameOf = new Map(stats.users.map((u) => [u.id, u.name]));
  const repliesTo = new Map();
  const repliedBy = new Map();
  for (const e of stats.replyEdges) {
    if (e.from === e.to) continue;
    if (e.from === focusId) repliesTo.set(e.to, (repliesTo.get(e.to) || 0) + e.count);
    if (e.to === focusId) repliedBy.set(e.from, (repliedBy.get(e.from) || 0) + e.count);
  }
  const top = (mp) =>
    [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
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
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
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
