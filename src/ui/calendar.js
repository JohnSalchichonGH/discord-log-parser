// Message explorer: a heat-shaded month calendar paired with a chat-style day
// view. Pick a day on the calendar to jump the stream there; an hour scrubber
// lets you land on a specific hour; scrolling near either edge of the stream
// lazily loads earlier/later messages across day boundaries.
//
// Driven entirely client-side from the full filtered message list (lightweight
// DTOs { authorId, authorName, ts, parts, isSystem }) the worker returns once
// per processing run, plus the uid->name userMap. Day/hour bucketing respects
// the shared UTC/Local timezone toggle.

import { authorColor } from './colors.js';

const $ = (id) => document.getElementById(id);
const escHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DOWS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // Mon-first grid

const BATCH = 250; // messages loaded per scroll extend
const MAXWIN = 1500; // cap on rendered messages (sliding window)
const GROUP_GAP_MS = 7 * 60 * 1000; // group consecutive msgs within 7 minutes

// ── timezone-aware date helpers ──────────────────────────────────────────────
function dparts(ms, tz) {
  const d = new Date(ms);
  return tz === 'local'
    ? {
        y: d.getFullYear(),
        mo: d.getMonth(),
        day: d.getDate(),
        dow: d.getDay(),
        h: d.getHours(),
        mi: d.getMinutes(),
      }
    : {
        y: d.getUTCFullYear(),
        mo: d.getUTCMonth(),
        day: d.getUTCDate(),
        dow: d.getUTCDay(),
        h: d.getUTCHours(),
        mi: d.getUTCMinutes(),
      };
}
const pad2 = (n) => String(n).padStart(2, '0');
const keyOf = (ms, tz) => {
  const p = dparts(ms, tz);
  return `${p.y}-${pad2(p.mo + 1)}-${pad2(p.day)}`;
};
const keyParts = (key) => key.split('-').map(Number); // [y, mo(1-12), day]
function fmtTime(ms, tz) {
  const p = dparts(ms, tz);
  let h = p.h % 12 || 12;
  return `${h}:${pad2(p.mi)} ${p.h < 12 ? 'AM' : 'PM'}`;
}
// Compact clock for the grouped-message gutter: "h:mm" only. The gutter is
// exactly as wide as the avatar column (so grouped text aligns), which can't
// fit "12:01 AM" without wrapping — and the group's header row already shows
// the full time, so the suffix is redundant there.
function fmtTimeShort(ms, tz) {
  const p = dparts(ms, tz);
  return `${p.h % 12 || 12}:${pad2(p.mi)}`;
}
function fmtDayLabel(key) {
  const [y, mo, day] = keyParts(key);
  const dow = new Date(Date.UTC(y, mo - 1, day)).getUTCDay();
  return `${DOWS[dow]}, ${MONTHS[mo - 1]} ${day}, ${y}`;
}

// ── module state ─────────────────────────────────────────────────────────────
const S = {
  msgs: [],
  umap: new Map(),
  tz: 'utc',
  days: new Map(), // key -> { count, firstIdx, endIdx, hours:Int[24] }
  dayList: [], // chronological keys with data
  maxDayCount: 1,
  minKey: null,
  maxKey: null,
  viewY: 0,
  viewMo: 0, // currently displayed calendar month (mo 0-11)
  selKey: null,
  winStart: 0,
  winEnd: 0,
  tbKey: null, // day currently shown in the toolbar scrubber
  scrollPending: false,
  suppressScroll: false, // ignore the scroll event from a programmatic reset
  wired: false,
};

// Build the per-day index from the (timestamp-sorted) message list.
function buildIndex() {
  S.days = new Map();
  S.maxDayCount = 1;
  for (let i = 0; i < S.msgs.length; i++) {
    const ts = S.msgs[i].ts;
    const k = keyOf(ts, S.tz);
    let e = S.days.get(k);
    if (!e) {
      e = {
        count: 0,
        firstIdx: i,
        endIdx: S.msgs.length,
        hours: new Array(24).fill(0),
      };
      S.days.set(k, e);
    }
    e.count++;
    e.hours[dparts(ts, S.tz).h]++;
  }
  S.dayList = [...S.days.keys()].sort();
  for (let j = 0; j < S.dayList.length; j++) {
    const e = S.days.get(S.dayList[j]);
    e.endIdx =
      j + 1 < S.dayList.length
        ? S.days.get(S.dayList[j + 1]).firstIdx
        : S.msgs.length;
    if (e.count > S.maxDayCount) S.maxDayCount = e.count;
  }
  S.minKey = S.dayList[0] || null;
  S.maxKey = S.dayList[S.dayList.length - 1] || null;
}

// ── calendar grid ────────────────────────────────────────────────────────────
function monthHasData(y, mo) {
  return S.dayList.some((k) => {
    const [ky, km] = keyParts(k);
    return ky === y && km - 1 === mo;
  });
}
function adjacentDataMonth(y, mo, dir) {
  // Nearest month in `dir` (+1/-1) that contains data, or null.
  let cy = y,
    cm = mo;
  for (let i = 0; i < 600; i++) {
    cm += dir;
    if (cm < 0) {
      cm = 11;
      cy--;
    } else if (cm > 11) {
      cm = 0;
      cy++;
    }
    if (S.minKey) {
      const [miny, minm] = keyParts(S.minKey);
      const [maxy, maxm] = keyParts(S.maxKey);
      if (cy < miny || (cy === miny && cm < minm - 1)) return null;
      if (cy > maxy || (cy === maxy && cm > maxm - 1)) return null;
    }
    if (monthHasData(cy, cm)) return { y: cy, mo: cm };
  }
  return null;
}

function renderCalendar() {
  const y = S.viewY,
    mo = S.viewMo;
  $('calMonthLabel').textContent = `${MONTHS[mo]} ${y}`;
  $('calPrev').disabled = !adjacentDataMonth(y, mo, -1);
  $('calNext').disabled = !adjacentDataMonth(y, mo, +1);

  const first = new Date(Date.UTC(y, mo, 1)).getUTCDay(); // 0=Sun
  const lead = (first + 6) % 7; // Mon-first offset
  const daysIn = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();

  let html = '<div class="cal-dows">';
  for (const d of DOW_SHORT) html += `<span>${d}</span>`;
  html += '</div><div class="cal-days">';
  for (let i = 0; i < lead; i++) html += '<span class="cal-cell empty"></span>';
  for (let day = 1; day <= daysIn; day++) {
    const key = `${y}-${pad2(mo + 1)}-${pad2(day)}`;
    const e = S.days.get(key);
    const count = e ? e.count : 0;
    if (count === 0) {
      html += `<span class="cal-cell blank">${day}</span>`;
      continue;
    }
    const scale = Math.sqrt(count / S.maxDayCount);
    const op = (0.14 + 0.82 * scale).toFixed(3);
    const sel = key === S.selKey ? ' sel' : '';
    html += `<button type="button" class="cal-cell day${sel}" data-key="${key}" title="${fmtDayLabel(key)} · ${count.toLocaleString()} messages" style="--heat:${op}">${day}</button>`;
  }
  html += '</div>';
  $('calGrid').innerHTML = html;
}

// ── message rendering ────────────────────────────────────────────────────────
function parseParts(parts) {
  let reply = null;
  const media = [];
  let reactions = [];
  const text = [];
  for (const p of parts) {
    if (p.startsWith('> ')) {
      const m = p.match(/^>\s*([^:]+):\s*([\s\S]*)$/);
      if (m)
        reply = { who: S.umap.get(m[1].trim()) || m[1].trim(), snippet: m[2] };
      continue;
    }
    let core = p;
    const rm = p.match(/\^\{([^}]*)\}/);
    if (rm) {
      reactions = reactions.concat(
        rm[1]
          .split(',')
          .map((s) => {
            const idx = s.lastIndexOf(':');
            const name = (idx >= 0 ? s.slice(0, idx) : s).trim();
            const cnt = idx >= 0 ? parseInt(s.slice(idx + 1)) : 1;
            return { name, count: cnt || 1 };
          })
          .filter((r) => r.name),
      );
      core = p.replace(/\s*\^\{[^}]*\}\s*/g, '').trim();
    }
    if (!core) continue;
    if (core.startsWith('[')) {
      const mm = core.match(/^\[([A-Z]+)(?::\s*([\s\S]*?))?\]$/);
      if (mm) media.push({ type: mm[1], name: (mm[2] || '').trim() });
      else media.push({ type: '', name: core.replace(/^\[|\]$/g, '') });
      continue;
    }
    text.push(core);
  }
  return { reply, text: text.join('\n'), media, reactions };
}

const MEDIA_ICON = {
  IMG: '🖼️',
  GIF: '🖼️',
  VID: '🎬',
  VIDEO: '🎬',
  MEDIA: '📎',
  FILE: '📎',
  AUDIO: '🎵',
  STICKER: '🩷',
  EMBED: '🔗',
  YT: '▶️',
};
function linkify(escaped) {
  return escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`,
  );
}
function mediaChip(m) {
  const icon = MEDIA_ICON[m.type] || '📎';
  const label =
    m.name ||
    (m.type ? m.type[0] + m.type.slice(1).toLowerCase() : 'Attachment');
  return `<span class="msg-media" title="${escHtml(m.type || 'attachment')}: ${escHtml(label)}">${icon} ${escHtml(label.length > 40 ? label.slice(0, 39) + '…' : label)}</span>`;
}

function avatar(m) {
  const name = m.authorName || '?';
  const initials =
    name
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || name.slice(0, 2).toUpperCase();
  const color = authorColor(m.authorId || name);
  return `<div class="msg-avatar" style="background:${color}">${escHtml(initials)}</div>`;
}

function messageHtml(m, i, grouped) {
  if (m.isSystem) {
    const { text, media } = parseParts(m.parts);
    const body = text || media.map((x) => x.name || x.type).join(' ');
    return `<div class="day-sys" data-i="${i}">${escHtml(body)} · ${fmtTime(m.ts, S.tz)}</div>`;
  }
  const { reply, text, media, reactions } = parseParts(m.parts);
  let inner = '';
  if (reply)
    inner += `<div class="msg-reply"><span class="msg-reply-who">${escHtml(reply.who)}</span> ${escHtml(reply.snippet.length > 120 ? reply.snippet.slice(0, 119) + '…' : reply.snippet)}</div>`;
  if (text) inner += `<div class="msg-text">${linkify(escHtml(text))}</div>`;
  if (media.length)
    inner += `<div class="msg-medias">${media.map(mediaChip).join('')}</div>`;
  if (reactions.length)
    inner += `<div class="msg-reacts">${reactions
      .map(
        (r) =>
          `<span class="msg-react">${escHtml(r.name)} <b>${r.count}</b></span>`,
      )
      .join('')}</div>`;

  if (grouped)
    return `<div class="msg grouped" data-i="${i}"><div class="msg-gutter"><span class="msg-gtime" title="${fmtTime(m.ts, S.tz)}">${fmtTimeShort(m.ts, S.tz)}</span></div><div class="msg-body">${inner}</div></div>`;
  return `<div class="msg" data-i="${i}">${avatar(m)}<div class="msg-main"><div class="msg-head"><span class="msg-name">${escHtml(m.authorName)}</span><span class="msg-time">${fmtTime(m.ts, S.tz)}</span></div><div class="msg-body">${inner}</div></div></div>`;
}

function renderDay() {
  let html = '';
  let prev = null;
  let prevKey = null;
  for (let i = S.winStart; i < S.winEnd; i++) {
    const m = S.msgs[i];
    const k = keyOf(m.ts, S.tz);
    if (k !== prevKey) {
      const e = S.days.get(k);
      html += `<div class="day-sep"><span>${fmtDayLabel(k)}</span><em>${e ? e.count.toLocaleString() + ' messages' : ''}</em></div>`;
      prevKey = k;
      prev = null; // new day → never group across the divider
    }
    const grouped =
      prev &&
      !m.isSystem &&
      !prev.isSystem &&
      prev.authorId === m.authorId &&
      m.ts - prev.ts < GROUP_GAP_MS;
    html += messageHtml(m, i, grouped);
    prev = m;
  }
  $('dayView').innerHTML = html;
}

// ── toolbar (current-day hour scrubber) ──────────────────────────────────────
function renderToolbar(key) {
  S.tbKey = key;
  const e = S.days.get(key);
  if (!e) {
    $('dayToolbar').innerHTML = '';
    return;
  }
  const maxH = Math.max(1, ...e.hours);
  let bars = '';
  for (let h = 0; h < 24; h++) {
    const c = e.hours[h];
    const hh = (c / maxH).toFixed(3);
    const ap = h % 12 || 12;
    bars += `<button type="button" class="day-hour${c ? '' : ' off'}" data-hour="${h}" title="${ap} ${h < 12 ? 'AM' : 'PM'} · ${c} messages" style="--h:${hh}"></button>`;
  }
  $('dayToolbar').innerHTML =
    `<div class="day-tb-label">${fmtDayLabel(key)} · <b>${e.count.toLocaleString()}</b> messages</div>` +
    `<div class="day-hours">${bars}</div>` +
    `<div class="day-hours-axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>`;
}

// ── selection + scrolling ────────────────────────────────────────────────────
function selectDay(key, hour) {
  const e = S.days.get(key);
  if (!e) return;
  S.selKey = key;
  S.winStart = e.firstIdx;
  S.winEnd = e.endIdx;
  if (S.winEnd - S.winStart > MAXWIN) S.winEnd = S.winStart + MAXWIN;
  renderDay();
  ensureFillDown(); // guarantee scroll room so the next day is reachable
  renderCalendarSelection();
  renderToolbar(key);
  // Resetting scrollTop fires a scroll event; ignore that one so we don't
  // immediately auto-load the previous day and drift the toolbar off the pick.
  S.suppressScroll = true;
  if (hour != null) scrollToHour(key, hour);
  else $('dayView').scrollTop = 0;
}

// Short days don't overflow the viewport, leaving nothing to scroll. Pull in
// following messages until the stream is taller than the pane (or we run out).
function ensureFillDown() {
  const c = $('dayView');
  let guard = 0;
  while (
    c.clientHeight > 0 &&
    c.scrollHeight <= c.clientHeight + 4 &&
    S.winEnd < S.msgs.length &&
    S.winEnd - S.winStart < MAXWIN &&
    guard++ < 40
  ) {
    S.winEnd = Math.min(S.msgs.length, S.winEnd + BATCH);
    renderDay();
  }
}

function renderCalendarSelection() {
  $('calGrid')
    .querySelectorAll('.cal-cell.day')
    .forEach((c) => c.classList.toggle('sel', c.dataset.key === S.selKey));
}

function indexForHour(key, hour) {
  const e = S.days.get(key);
  if (!e) return -1;
  for (let i = e.firstIdx; i < e.endIdx; i++)
    if (dparts(S.msgs[i].ts, S.tz).h >= hour) return i;
  return e.firstIdx;
}
function scrollToHour(key, hour) {
  const idx = indexForHour(key, hour);
  if (idx < 0) return;
  if (idx < S.winStart || idx >= S.winEnd) {
    S.winStart = Math.max(0, idx - 30);
    S.winEnd = Math.min(S.msgs.length, idx + BATCH);
    renderDay();
  }
  const row = $('dayView').querySelector(`[data-i="${idx}"]`);
  if (row) $('dayView').scrollTop = row.offsetTop - 8;
}

// Keep the viewport visually stable across a re-render that adds/removes
// messages above the fold: anchor on the first message row crossing the top.
function captureAnchor() {
  const c = $('dayView');
  const st = c.scrollTop;
  for (const row of c.children) {
    if (
      row.dataset &&
      row.dataset.i != null &&
      row.offsetTop + row.offsetHeight > st
    )
      return { i: row.dataset.i, delta: row.offsetTop - st };
  }
  return null;
}
function restoreAnchor(a) {
  if (!a) return;
  const row = $('dayView').querySelector(`[data-i="${a.i}"]`);
  if (row) $('dayView').scrollTop = row.offsetTop - a.delta;
}

function extendUp() {
  if (S.winStart === 0) return;
  const a = captureAnchor();
  S.winStart = Math.max(0, S.winStart - BATCH);
  if (S.winEnd - S.winStart > MAXWIN) S.winEnd = S.winStart + MAXWIN;
  renderDay();
  restoreAnchor(a);
}
function extendDown() {
  if (S.winEnd >= S.msgs.length) return;
  const a = captureAnchor();
  S.winEnd = Math.min(S.msgs.length, S.winEnd + BATCH);
  if (S.winEnd - S.winStart > MAXWIN) S.winStart = S.winEnd - MAXWIN;
  renderDay();
  restoreAnchor(a);
}

function topVisibleDayKey() {
  const c = $('dayView');
  const st = c.scrollTop;
  for (const row of c.children) {
    if (
      row.dataset &&
      row.dataset.i != null &&
      row.offsetTop + row.offsetHeight > st
    )
      return keyOf(S.msgs[+row.dataset.i].ts, S.tz);
  }
  return S.selKey;
}

function onScroll() {
  if (S.suppressScroll) {
    S.suppressScroll = false;
    return;
  }
  if (S.scrollPending) return;
  S.scrollPending = true;
  requestAnimationFrame(() => {
    S.scrollPending = false;
    const c = $('dayView');
    if (c.scrollTop < 200) extendUp();
    else if (c.scrollHeight - c.scrollTop - c.clientHeight < 200) extendDown();
    const k = topVisibleDayKey();
    if (k && k !== S.tbKey) renderToolbar(k);
  });
}

// ── wiring (once) ────────────────────────────────────────────────────────────
function wire() {
  if (S.wired) return;
  S.wired = true;
  $('calPrev').addEventListener('click', () => {
    const a = adjacentDataMonth(S.viewY, S.viewMo, -1);
    if (a) {
      S.viewY = a.y;
      S.viewMo = a.mo;
      renderCalendar();
    }
  });
  $('calNext').addEventListener('click', () => {
    const a = adjacentDataMonth(S.viewY, S.viewMo, +1);
    if (a) {
      S.viewY = a.y;
      S.viewMo = a.mo;
      renderCalendar();
    }
  });
  $('calGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell.day');
    if (cell) selectDay(cell.dataset.key, null);
  });
  $('dayToolbar').addEventListener('click', (e) => {
    const hb = e.target.closest('.day-hour');
    if (hb && S.tbKey) scrollToHour(S.tbKey, +hb.dataset.hour);
  });
  $('dayView').addEventListener('scroll', onScroll, { passive: true });
}

// ── public API ───────────────────────────────────────────────────────────────
export function loadCalendar(messages, userMap, tz) {
  S.msgs = messages || [];
  S.umap = userMap instanceof Map ? userMap : new Map(userMap || []);
  S.tz = tz === 'local' ? 'local' : 'utc';
  wire();
  buildIndex();
  if (!S.maxKey) {
    $('calGrid').innerHTML =
      '<div style="color:var(--text-muted);font-size:13px;padding:8px">No messages to explore.</div>';
    $('dayView').innerHTML = '';
    $('dayToolbar').innerHTML = '';
    return false;
  }
  // Open on the most active day by default.
  const best = mostActiveKey();
  const [by, bm] = keyParts(best);
  S.viewY = by;
  S.viewMo = bm - 1;
  renderCalendar();
  selectDay(best, null);
  return true;
}

export function setCalendarTz(tz) {
  const next = tz === 'local' ? 'local' : 'utc';
  if (next === S.tz || !S.msgs.length) {
    S.tz = next;
    return;
  }
  // Preserve the selected day across the rebucket when possible.
  const keep = S.selKey;
  S.tz = next;
  buildIndex();
  if (!S.maxKey) return;
  const target = S.days.has(keep) ? keep : mostActiveKey();
  const [ty, tm] = keyParts(target);
  S.viewY = ty;
  S.viewMo = tm - 1;
  renderCalendar();
  selectDay(target, null);
}
function mostActiveKey() {
  let best = S.dayList[0];
  for (const k of S.dayList)
    if (S.days.get(k).count > S.days.get(best).count) best = k;
  return best;
}
