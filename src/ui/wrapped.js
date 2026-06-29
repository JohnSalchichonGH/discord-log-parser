// Renders the "Conversation Wrapped" recap as a single self-contained SVG poster
// (so it can be exported to PNG with no dependencies) and wires a download.
// Colors are resolved from the live theme and baked in as literals, because CSS
// variables don't survive serialization to a canvas.

const MON = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const esc = (s) =>
  String(s).replace(
    /[&<>]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c],
  );
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOWFULL = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

function dparts(ms, tz) {
  const d = new Date(ms);
  return tz === 'local'
    ? {
        y: d.getFullYear(),
        mo: d.getMonth(),
        day: d.getDate(),
        h: d.getHours(),
        mi: d.getMinutes(),
      }
    : {
        y: d.getUTCFullYear(),
        mo: d.getUTCMonth(),
        day: d.getUTCDate(),
        h: d.getUTCHours(),
        mi: d.getUTCMinutes(),
      };
}
function fmtDay(ms, tz, withYear) {
  if (ms == null) return '—';
  const p = dparts(ms, tz);
  return `${MON[p.mo]} ${p.day}${withYear ? ', ' + p.y : ''}`;
}
function fmtDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${MON[m - 1]} ${d}, ${y}`;
}
function fmtDateTime(ms, tz) {
  if (ms == null) return '';
  const p = dparts(ms, tz);
  const h = p.h % 12 || 12;
  return `${MON[p.mo]} ${p.day}, ${p.y} · ${h}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
}
function persona(h) {
  if (h < 5) return 'Night owls';
  if (h < 9) return 'Early birds';
  if (h < 12) return 'Morning crew';
  if (h < 17) return 'Afternoon talkers';
  if (h < 21) return 'Evening crew';
  return 'Night owls';
}
function hourLabel(h) {
  const ap = h % 12 || 12;
  return `${ap} ${h < 12 ? 'AM' : 'PM'}`;
}
const clip = (s, n) => {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, fb) => cs.getPropertyValue(n).trim() || fb;
  return {
    bg: v('--bg-secondary', '#111114'),
    tile: v('--bg-surface', '#16161a'),
    tile2: v('--bg-tertiary', '#222228'),
    text: v('--text-primary', '#e8e8ed'),
    sub: v('--text-secondary', '#b0b0bc'),
    muted: v('--text-muted', '#707080'),
    accent: v('--accent', '#6c9eff'),
    border: v('--border', '#2e2e38'),
    success: v('--success', '#5ccf7f'),
    warning: v('--warning', '#e09a5c'),
    danger: v('--danger', '#e06c6c'),
  };
}

const W = 760;
const P = 30;
const G = 14;
const IW = W - 2 * P; // inner width

export function wrappedSvg(d, opts = {}) {
  const tz = opts.tz === 'local' ? 'local' : 'utc';
  const c = palette();
  const t = d.totals;
  const parts = [];
  let delay = 0;
  const tile = (inner) => {
    const s = `<g class="wtile" style="animation-delay:${delay.toFixed(2)}s">${inner}</g>`;
    delay += 0.05;
    return s;
  };
  const rectEl = (x, y, w, h, fill, stroke) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}/>`;
  const txt = (x, y, size, fill, s, extra = '') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`;
  const alpha = (hex) => hex + '22'; // #rrggbb -> translucent

  // mini bar chart (weekly / hourly)
  const bars = (x, y, w, h, vals, peakIdx, accent) => {
    const max = Math.max(1, ...vals);
    const n = vals.length;
    const gap = n > 12 ? 1.5 : 4;
    const bw = (w - (n - 1) * gap) / n;
    let s = '';
    for (let i = 0; i < n; i++) {
      const bh = Math.max(2, (vals[i] / max) * h);
      s += `<rect x="${(x + i * (bw + gap)).toFixed(1)}" y="${(y + h - bh).toFixed(1)}" width="${Math.max(1, bw).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${i === peakIdx ? accent : c.tile2}"/>`;
    }
    return s;
  };
  // area sparkline with a peak marker
  const spark = (x, y, w, h, vals, accent) => {
    const max = Math.max(1, ...vals);
    const n = vals.length;
    const X = (i) => x + (n <= 1 ? 0 : (i / (n - 1)) * w);
    const Y = (v) => y + h - (v / max) * h;
    let line = '';
    for (let i = 0; i < n; i++)
      line += `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(vals[i]).toFixed(1)} `;
    const area = `M${X(0).toFixed(1)} ${(y + h).toFixed(1)} ${vals
      .map((v, i) => `L${X(i).toFixed(1)} ${Y(v).toFixed(1)}`)
      .join(' ')} L${X(n - 1).toFixed(1)} ${(y + h).toFixed(1)} Z`;
    let pk = 0;
    for (let i = 1; i < n; i++) if (vals[i] > vals[pk]) pk = i;
    return (
      `<path d="${area}" fill="${alpha(accent)}"/>` +
      `<path d="${line}" fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>` +
      `<circle cx="${X(pk).toFixed(1)}" cy="${Y(vals[pk]).toFixed(1)}" r="3.5" fill="${accent}"/>`
    );
  };
  // compact half-width highlight
  const compact = (x, y, w, accent, emoji, title, value) =>
    rectEl(x, y, w, 76, c.tile, c.border) +
    `<circle cx="${x + 34}" cy="${y + 38}" r="19" fill="${alpha(accent)}"/>` +
    `<text x="${x + 34}" y="${y + 45}" font-size="18" text-anchor="middle">${emoji}</text>` +
    txt(x + 62, y + 31, 12, c.muted, title) +
    txt(
      x + 62,
      y + 54,
      16,
      c.text,
      clip(value, Math.floor((w - 74) / 8.4)),
      'font-weight="600"',
    );
  // full-width message card (label / quote / who · when)
  const msgCard = (y, accent, emoji, title, quote, meta) =>
    rectEl(P, y, IW, 104, c.tile, c.border) +
    `<circle cx="${P + 34}" cy="${y + 40}" r="20" fill="${alpha(accent)}"/>` +
    `<text x="${P + 34}" y="${y + 47}" font-size="20" text-anchor="middle">${emoji}</text>` +
    txt(P + 66, y + 32, 12, c.muted, title) +
    txt(
      P + 66,
      y + 60,
      16.5,
      c.text,
      '“' + clip(quote, 62) + '”',
      'font-weight="600"',
    ) +
    txt(P + 66, y + 84, 12.5, c.sub, meta);

  // Header
  const rangeStr =
    t.start != null
      ? `${fmtDay(t.start, tz, false)} – ${fmtDay(t.end, tz, true)} · ${num(t.activeDays)} active days`
      : '';
  parts.push(
    `<text x="${P}" y="54" font-size="29" font-weight="800" fill="${c.text}">✨ Conversation Wrapped</text>`,
    `<text x="${P}" y="82" font-size="14" fill="${c.sub}">${esc(rangeStr)}</text>`,
  );

  // Stat tiles (3 per row)
  const sw = (IW - 2 * G) / 3;
  const sh = 98;
  const small = (x, y, accent, big, label) =>
    `<rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="14" fill="${c.tile}" stroke="${c.border}"/>` +
    `<rect x="${x}" y="${y}" width="4" height="${sh}" rx="2" fill="${accent}"/>` +
    txt(x + 20, y + 54, 32, c.text, big, 'font-weight="700"') +
    txt(x + 20, y + 80, 13, c.muted, label);
  let y = 104;
  parts.push(
    tile(
      small(P, y, c.accent, num(t.messages), 'messages') +
        small(P + sw + G, y, c.success, num(t.participants), 'people') +
        small(P + 2 * (sw + G), y, c.warning, num(d.totalWords), 'words'),
    ),
  );
  y += sh + G;
  parts.push(
    tile(
      small(P, y, c.danger, num(t.reactions), 'reactions') +
        small(P + sw + G, y, c.accent, num(d.totalMedia), 'media shared') +
        small(P + 2 * (sw + G), y, c.success, num(d.streak), 'day streak'),
    ),
  );
  y += sh + G + 4;

  // Activity over time (sparkline)
  {
    const h = 122;
    const series = d.timeline || [];
    parts.push(
      tile(
        rectEl(P, y, IW, h, c.tile, c.border) +
          txt(P + 18, y + 28, 13, c.muted, 'Activity over time') +
          txt(
            W - P - 18,
            y + 28,
            13,
            c.sub,
            `≈ ${num(d.avgPerDay)}/day`,
            'text-anchor="end"',
          ) +
          (series.length > 1
            ? spark(P + 18, y + 44, IW - 36, h - 64, series, c.accent)
            : txt(P + 18, y + 70, 13, c.muted, 'Not enough days to chart')),
      ),
    );
    y += h + G;
  }

  // Weekly + daily rhythm (two half cards)
  {
    const hw = (IW - G) / 2;
    const h = 132;
    const weekly =
      rectEl(P, y, hw, h, c.tile, c.border) +
      txt(P + 18, y + 28, 13, c.muted, 'Weekly rhythm') +
      bars(P + 18, y + 44, hw - 36, 44, d.dow, d.busiestDow, c.accent) +
      DOW1.map(
        (lb, i) =>
          `<text x="${(P + 18 + ((hw - 36) / 7) * (i + 0.5)).toFixed(1)}" y="${y + 104}" font-size="10" text-anchor="middle" fill="${i === d.busiestDow ? c.accent : c.muted}">${lb}</text>`,
      ).join('') +
      txt(
        P + 18,
        y + 122,
        12.5,
        c.sub,
        `Most alive on ${DOWFULL[d.busiestDow]}`,
        'font-weight="600"',
      );
    const x2 = P + hw + G;
    const hours = d.hour || [];
    const axis = [0, 6, 12, 18]
      .map((hh) => {
        const x = x2 + 18 + ((hw - 36) / 24) * (hh + 0.5);
        return `<text x="${x.toFixed(1)}" y="${y + 104}" font-size="10" text-anchor="middle" fill="${c.muted}">${hh === 0 ? '12a' : hh === 12 ? '12p' : hh < 12 ? hh + 'a' : hh - 12 + 'p'}</text>`;
      })
      .join('');
    const daily =
      rectEl(x2, y, hw, h, c.tile, c.border) +
      txt(x2 + 18, y + 28, 13, c.muted, 'Daily rhythm') +
      bars(x2 + 18, y + 44, hw - 36, 44, hours, t.peakHour, c.success) +
      axis +
      txt(
        x2 + 18,
        y + 122,
        12.5,
        c.sub,
        `${persona(t.peakHour)} · peak ${hourLabel(t.peakHour)}`,
        'font-weight="600"',
      );
    parts.push(tile(weekly + daily));
    y += h + G;
  }

  // Podium (top 3 chatters)
  if (d.top3 && d.top3.length) {
    const h = 116;
    const medals = ['🥇', '🥈', '🥉'];
    let s =
      rectEl(P, y, IW, h, c.tile, c.border) +
      txt(P + 18, y + 28, 13, c.muted, 'Top chatters');
    for (let i = 0; i < Math.min(3, d.top3.length); i++) {
      const u = d.top3[i];
      const cx = P + (IW * (i + 0.5)) / 3;
      s +=
        `<text x="${cx.toFixed(1)}" y="${y + 66}" font-size="26" text-anchor="middle">${medals[i]}</text>` +
        txt(
          cx,
          y + 90,
          15,
          c.text,
          clip(u.name, 16),
          'text-anchor="middle" font-weight="600"',
        ) +
        txt(
          cx,
          y + 108,
          12,
          c.muted,
          `${num(u.count)} msgs`,
          'text-anchor="middle"',
        );
    }
    parts.push(tile(s));
    y += h + G;
  }

  // Top reactions (slim, full width)
  if (d.top3Emoji && d.top3Emoji.length) {
    const h = 62;
    const items = d.top3Emoji
      .map((e) => `${e.name}  ${num(e.count)}`)
      .join('     ');
    parts.push(
      tile(
        rectEl(P, y, IW, h, c.tile, c.border) +
          `<circle cx="${P + 34}" cy="${y + 31}" r="19" fill="${alpha(c.danger)}"/>` +
          `<text x="${P + 34}" y="${y + 38}" font-size="18" text-anchor="middle">⭐</text>` +
          txt(P + 62, y + 27, 12, c.muted, 'Top reactions') +
          txt(P + 62, y + 48, 16, c.text, items, 'font-weight="600"'),
      ),
    );
    y += h + G;
  }

  // 2×2 compact highlights
  {
    const hw = (IW - G) / 2;
    const cells = [];
    if (d.busiest)
      cells.push((x, yy) =>
        compact(
          x,
          yy,
          hw,
          c.warning,
          '📈',
          'Busiest day',
          `${fmtDayKey(d.busiest.date)} · ${num(d.busiest.count)}`,
        ),
      );
    if (d.topPair)
      cells.push((x, yy) =>
        compact(
          x,
          yy,
          hw,
          c.accent,
          '💞',
          'Top duo',
          `${d.topPair.from} ↔ ${d.topPair.to} · ${num(d.topPair.count)}`,
        ),
      );
    if (d.starter)
      cells.push((x, yy) =>
        compact(
          x,
          yy,
          hw,
          c.success,
          '🗣️',
          'Conversation starter',
          `${d.starter.name} · ${num(d.starter.count)} days`,
        ),
      );
    if (d.nightOwl)
      cells.push((x, yy) =>
        compact(
          x,
          yy,
          hw,
          c.danger,
          '🦉',
          'Night owl',
          `${d.nightOwl.name} · ${num(d.nightOwl.count)} late msgs`,
        ),
      );
    let s = '';
    cells.forEach((fn, i) => {
      const x = P + (i % 2) * (hw + G);
      const yy = y + Math.floor(i / 2) * (76 + G);
      s += fn(x, yy);
    });
    parts.push(tile(s));
    y += Math.ceil(cells.length / 2) * (76 + G);
  }

  // Message highlights (quote + who · when, never overflowing)
  if (d.mostReacted) {
    parts.push(
      tile(
        msgCard(
          y,
          c.warning,
          '⭐',
          `Most-reacted message · ${num(d.mostReacted.react)} reactions`,
          d.mostReacted.text,
          `— ${d.mostReacted.name} · ${fmtDateTime(d.mostReacted.ts, tz)}`,
        ),
      ),
    );
    y += 104 + G;
  }
  if (d.longest) {
    parts.push(
      tile(
        msgCard(
          y,
          c.success,
          '📝',
          `Longest message · ${num(d.longest.len)} chars`,
          d.longest.text,
          `— ${d.longest.name} · ${fmtDateTime(d.longest.ts, tz)}`,
        ),
      ),
    );
    y += 104 + G;
  }
  // Longest quiet stretch
  if (d.quietGap) {
    const h = 62;
    parts.push(
      tile(
        rectEl(P, y, IW, h, c.tile, c.border) +
          `<circle cx="${P + 34}" cy="${y + 31}" r="19" fill="${alpha(c.muted)}"/>` +
          `<text x="${P + 34}" y="${y + 38}" font-size="18" text-anchor="middle">🤫</text>` +
          txt(P + 62, y + 27, 12, c.muted, 'Longest quiet stretch') +
          txt(
            P + 62,
            y + 48,
            16,
            c.text,
            `${num(d.quietGap.days)} days · ${fmtDay(d.quietGap.from, tz, true)} → ${fmtDay(d.quietGap.to, tz, true)}`,
            'font-weight="600"',
          ),
      ),
    );
    y += h + G;
  }

  parts.push(
    `<text x="${W - P}" y="${y + 16}" font-size="11" text-anchor="end" fill="${c.muted}">made with discord-log-parser</text>`,
  );
  const H = y + 34;

  const style =
    `<style>@keyframes wpop{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}` +
    `.wtile{animation:wpop .5s ease both}</style>`;
  return (
    `<svg class="wrapped-svg" viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" role="img" aria-label="Conversation Wrapped recap">` +
    style +
    `<rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="${c.bg}"/>` +
    parts.join('') +
    `</svg>`
  );
}

export function renderWrapped(hostId, d, opts) {
  document.getElementById(hostId).innerHTML = wrappedSvg(d, opts);
}

// Serialize the rendered poster to a PNG download. Strips the entrance-animation
// <style> on a clone so the snapshot isn't captured at the 0-opacity keyframe.
export function downloadWrappedPng(hostId, filename) {
  const svg = document.getElementById(hostId).querySelector('svg');
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('style').forEach((s) => s.remove());
  clone.querySelectorAll('.wtile').forEach((g) => g.removeAttribute('style'));
  // Explicit pixel size so the <img> rasterizes at full resolution (width=100%
  // would otherwise give the image a tiny intrinsic size).
  clone.setAttribute('width', vb.width);
  clone.setAttribute('height', vb.height);
  const xml = new XMLSerializer().serializeToString(clone);
  const url =
    'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = vb.width * scale;
    canvas.height = vb.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, vb.width, vb.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };
  img.src = url;
}
