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
      return `<div class="chart-bar-row" title="${escHtml(u.name)} · ${u.words.toLocaleString()} words · ${u.media} media · ${u.replies} replies · ${u.activeDays} active days">
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
