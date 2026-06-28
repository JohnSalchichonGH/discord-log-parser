// Renders the "Conversation Wrapped" recap as a single self-contained SVG poster
// (so it can be exported to PNG with no dependencies) and wires a download.
// Colors are resolved from the live theme and baked in as literals, because CSS
// variables don't survive serialization to a canvas.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = (s) =>
  String(s).replace(
    /[&<>]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c],
  );
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

function dparts(ms, tz) {
  const d = new Date(ms);
  return tz === 'local'
    ? { y: d.getFullYear(), mo: d.getMonth(), day: d.getDate() }
    : { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate() };
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
function persona(h) {
  if (h < 5) return { emoji: '🦉', label: 'Night owls' };
  if (h < 9) return { emoji: '🌅', label: 'Early birds' };
  if (h < 12) return { emoji: '☕', label: 'Morning crew' };
  if (h < 17) return { emoji: '☀️', label: 'Afternoon talkers' };
  if (h < 21) return { emoji: '🌆', label: 'Evening crew' };
  return { emoji: '🌙', label: 'Night owls' };
}
function hourLabel(h) {
  const ap = h % 12 || 12;
  return `${ap} ${h < 12 ? 'AM' : 'PM'}`;
}

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

export function wrappedSvg(d, opts = {}) {
  const tz = opts.tz === 'local' ? 'local' : 'utc';
  const c = palette();
  const t = d.totals;
  const parts = [];
  let delay = 0;
  const tile = (inner) => {
    const s = `<g class="wtile" style="animation-delay:${delay.toFixed(2)}s">${inner}</g>`;
    delay += 0.06;
    return s;
  };

  // ── small stat tile (3 per row) ──
  const sw = (W - 2 * P - 2 * G) / 3;
  const sh = 104;
  const small = (x, y, accent, big, label) =>
    tile(
      `<rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="14" fill="${c.tile}" stroke="${c.border}"/>` +
        `<rect x="${x}" y="${y}" width="4" height="${sh}" rx="2" fill="${accent}"/>` +
        `<text x="${x + 20}" y="${y + 58}" font-size="34" font-weight="700" fill="${c.text}">${esc(big)}</text>` +
        `<text x="${x + 20}" y="${y + 84}" font-size="13" fill="${c.muted}">${esc(label)}</text>`,
    );

  // ── wide highlight row ──
  const wh = 80;
  const wide = (y, accent, emoji, title, value) =>
    tile(
      `<rect x="${P}" y="${y}" width="${W - 2 * P}" height="${wh}" rx="14" fill="${c.tile}" stroke="${c.border}"/>` +
        `<circle cx="${P + 38}" cy="${y + wh / 2}" r="22" fill="${accent}22"/>` +
        `<text x="${P + 38}" y="${y + wh / 2 + 8}" font-size="22" text-anchor="middle">${emoji}</text>` +
        `<text x="${P + 76}" y="${y + 33}" font-size="13" fill="${c.muted}">${esc(title)}</text>` +
        `<text x="${P + 76}" y="${y + 58}" font-size="19" font-weight="600" fill="${c.text}">${esc(value)}</text>`,
    );

  // Header
  const rangeStr =
    t.start != null
      ? `${fmtDay(t.start, tz, false)} – ${fmtDay(t.end, tz, true)} · ${num(t.activeDays)} active days`
      : '';
  parts.push(
    `<text x="${P}" y="56" font-size="30" font-weight="800" fill="${c.text}">✨ Conversation Wrapped</text>`,
    `<text x="${P}" y="84" font-size="14" fill="${c.sub}">${esc(rangeStr)}</text>`,
  );

  // Small stat grid
  let y = 112;
  parts.push(small(P, y, c.accent, num(t.messages), 'messages'));
  parts.push(small(P + sw + G, y, c.success, num(t.participants), 'people'));
  parts.push(small(P + 2 * (sw + G), y, c.warning, num(d.totalWords), 'words'));
  y += sh + G;
  parts.push(small(P, y, c.danger, num(t.reactions), 'reactions'));
  parts.push(small(P + sw + G, y, c.accent, num(d.totalMedia), 'media shared'));
  parts.push(small(P + 2 * (sw + G), y, c.success, num(d.streak), 'day streak'));
  y += sh + G + 6;

  // Wide highlights
  if (d.topUser) {
    parts.push(
      wide(y, c.accent, '🏆', 'Most active', `${d.topUser.name} · ${num(d.topUser.count)} messages`),
    );
    y += wh + G;
  }
  if (d.busiest) {
    parts.push(
      wide(y, c.warning, '📈', 'Busiest day', `${fmtDayKey(d.busiest.date)} · ${num(d.busiest.count)} messages`),
    );
    y += wh + G;
  }
  {
    const pz = persona(t.peakHour);
    parts.push(wide(y, c.success, pz.emoji, 'The crew runs on', `${pz.label} · peak around ${hourLabel(t.peakHour)}`));
    y += wh + G;
  }
  if (d.topEmoji) {
    parts.push(
      wide(y, c.danger, d.topEmoji.name, 'Favorite reaction', `${d.topEmoji.name} · used ${num(d.topEmoji.count)} times`),
    );
    y += wh + G;
  }
  if (d.topPair) {
    parts.push(
      wide(y, c.accent, '💞', 'Top duo', `${d.topPair.from} ↔ ${d.topPair.to} · ${num(d.topPair.count)} replies`),
    );
    y += wh + G;
  }
  if (d.mostReacted) {
    parts.push(
      wide(
        y,
        c.warning,
        '⭐',
        `Most-reacted message · ${num(d.mostReacted.react)} reactions`,
        `“${d.mostReacted.text}” — ${d.mostReacted.name}`,
      ),
    );
    y += wh + G;
  }
  if (d.longest) {
    parts.push(
      wide(y, c.success, '📝', 'Longest message', `“${d.longest.text}” — ${d.longest.name}`),
    );
    y += wh + G;
  }

  parts.push(
    `<text x="${W - P}" y="${y + 18}" font-size="11" text-anchor="end" fill="${c.muted}">made with discord-log-parser</text>`,
  );
  const H = y + 36;

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
  const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
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
