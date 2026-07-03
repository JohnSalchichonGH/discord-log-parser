// Renderer for a self-contained, human-readable HTML transcript.
//
// Unlike the TXT/JSON/MD/CSV renderers (which target machines), this produces a
// styled Discord-style document meant to be opened in a browser and read or
// shared: day dividers, session breaks, per-author avatars/colors, reply quotes,
// media chips, reaction pills and linkified URLs. The output is a complete
// standalone .html file with all CSS inlined and no external requests.
//
// Like the other renderers it works off `finalChunks` + `userMap` and honors the
// same redaction options (names / urls / emails+phones).

import { escHtml } from '../core/format.js';
import { redactString } from '../core/redact.js';
import {
  SESSION_BREAK_THRESHOLD,
  formatAMPMUtc,
  formatDayDividerUtc,
  formatLongDuration,
  utcDayKey,
} from '../core/time.js';

// Stable, readable per-author accent colors (Discord-ish palette).
const PALETTE = [
  '#5865f2',
  '#3ba55d',
  '#faa61a',
  '#ed4245',
  '#eb459e',
  '#1abc9c',
  '#e67e22',
  '#9b59b6',
  '#3498db',
  '#e91e63',
  '#2ecc71',
  '#f1c40f',
];

function colorFor(uid) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function initials(name) {
  const t = String(name).trim();
  return t ? escHtml(t[0].toUpperCase()) : '?';
}

// Escape, redact, linkify URLs and turn media tokens ([IMG: …], [VID: …], …)
// into chips. URLs are dropped to plain text when redactUrls is set.
function renderContentLine(line, opts) {
  let s = escHtml(redactString(line, opts));
  // Media tokens -> chips (operate on the already-escaped string; tokens never
  // contain HTML-special chars beyond what escHtml leaves intact). The token set
  // mirrors what the parsers emit — including bare "[STICKER]" (no colon).
  s = s.replace(
    /\[(IMG|GIF|VID|MEDIA|YT|EMBED|STICKER)(?::[^\]]*)?\]/g,
    (m) => `<span class="chip">${m}</span>`,
  );
  if (!opts.redactUrls) {
    // Linkify bare URLs. Run after escaping so the href/text are already safe;
    // the scheme set is restricted to http(s).
    s = s.replace(
      /(https?:\/\/[^\s<]+)/g,
      (u) =>
        `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`,
    );
  }
  return s;
}

// Pull reactions out of a chunk: a standalone "^{…}" part, or a "… ^{…}" tail
// appended to the last content line. Returns { contentLines, reply, reactions }.
function splitParts(chunk) {
  let reply = null;
  const reactions = [];
  const contentLines = [];
  const parts = chunk.contentParts;
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    // Only the FIRST part can be a reply token (assembleMessage always emits it
    // there); a body part that starts with ">" is a markdown blockquote and
    // stays content. `hasReply !== false` keeps the legacy heuristic for
    // hand-built objects that don't set the flag.
    if (i === 0 && chunk.hasReply !== false && part.startsWith('>')) {
      reply = part.replace(/^>\s*/, '');
      continue;
    }
    if (part.startsWith('^')) {
      reactions.push(part.slice(1));
      continue;
    }
    // A trailing reaction group attached to a content line.
    const tail = part.match(/\s*(\^\{[^}]*\})\s*$/);
    if (tail) {
      reactions.push(tail[1].slice(1));
      part = part.slice(0, tail.index).trimEnd();
    }
    if (part) contentLines.push(part);
  }
  return { contentLines, reply, reactions };
}

function renderReactions(reactions) {
  const pills = [];
  for (const group of reactions) {
    // group looks like "{👍:3, ❤️:1}" (counts) or "{👍, ❤️}" (TXT, no counts).
    const inner = group.replace(/^\{/, '').replace(/\}$/, '');
    for (const tok of inner.split(',')) {
      const t = tok.trim();
      if (!t) continue;
      const m = t.match(/^(.*?):(\d+)$/);
      const emoji = escHtml(m ? m[1] : t);
      const count = m ? ` <span class="rc">${escHtml(m[2])}</span>` : '';
      pills.push(`<span class="react">${emoji}${count}</span>`);
    }
  }
  return pills.length ? `<div class="reactions">${pills.join('')}</div>` : '';
}

// Resolve a reply quote "<uid>: <snippet>" to a display name + snippet.
function renderReply(reply, userMap, opts) {
  const m = reply.match(/^(\S+?):\s*([\s\S]*)$/);
  let who = m ? m[1] : '';
  const snippet = m ? m[2] : reply;
  if (who && !opts.redactNames && userMap.has(who)) who = userMap.get(who);
  return (
    `<div class="reply"><span class="reply-who">${escHtml(who)}</span> ` +
    `<span class="reply-text">${renderContentLine(snippet, opts)}</span></div>`
  );
}

// Above this many messages the document opts into CSS `content-visibility`, so
// the browser skips layout/paint of off-screen rows (bounded render cost, smooth
// scroll) while every row stays in the DOM — native Ctrl-F and printing keep
// working and no JavaScript is added. Small logs are emitted byte-for-byte as
// before. See renderHTML.
const VIRTUALIZE_THRESHOLD = 2000;

// Rough rendered pixel height of a message row, used as the per-row
// `contain-intrinsic-size` placeholder so the scrollbar is about right before a
// row is scrolled into view (the browser replaces it with the real height on
// render). Deliberately approximate — long wrapped lines self-correct.
function estimateHeight(grouped, contentLines, reply, reactions) {
  let h = 8; // vertical padding
  if (!grouped) h += 22; // author/time header
  h += Math.max(1, contentLines.length) * 22; // content lines
  if (reply) h += 22;
  if (reactions.length) h += 28;
  return Math.max(grouped ? 24 : 44, h); // at least one avatar's worth
}

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#313338;color:#dbdee1;font-family:"gg sans","Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.4}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 64px}
header{border-bottom:1px solid #3f4147;padding-bottom:16px;margin-bottom:8px}
h1{font-size:20px;margin:0 0 4px}
.meta{color:#949ba4;font-size:13px}
.participants{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.pill{display:flex;align-items:center;gap:6px;background:#2b2d31;border-radius:12px;padding:3px 10px 3px 4px;font-size:12px}
.dot{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:600}
.pct{color:#949ba4}
.divider{display:flex;align-items:center;gap:12px;color:#949ba4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.02em;margin:24px 0 8px}
.divider::before,.divider::after{content:"";flex:1;height:1px;background:#3f4147}
.break{color:#f0b132}
.msg{display:flex;gap:16px;padding:2px 0}
.msg.cont{padding-top:0}
.avatar{width:40px;height:40px;border-radius:50%;flex:0 0 40px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:16px}
.avatar.blank{visibility:hidden;height:0}
.body{flex:1;min-width:0}
.head{display:flex;align-items:baseline;gap:8px}
.author{font-weight:600}
.time{color:#949ba4;font-size:12px}
.content{white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}
.content a{color:#00a8fc;text-decoration:none}
.content a:hover{text-decoration:underline}
.chip{background:#2b2d31;border:1px solid #3f4147;border-radius:4px;padding:0 6px;font-size:13px;color:#c4c9ce}
.reply{display:flex;gap:6px;align-items:center;color:#b5bac1;font-size:13px;margin-bottom:2px}
.reply::before{content:"";width:24px;height:10px;margin-left:8px;border-left:2px solid #4e5058;border-top:2px solid #4e5058;border-top-left-radius:6px;align-self:flex-end}
.reply-who{font-weight:600;color:#dbdee1}
.reply-text{color:#a3a6aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:600px}
.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.react{background:#2b2d31;border:1px solid #3f4147;border-radius:8px;padding:1px 7px;font-size:13px;display:inline-flex;gap:4px;align-items:center}
.rc{color:#949ba4;font-size:12px;font-weight:600}
.empty{color:#949ba4;padding:32px 0;text-align:center}
`;

// Appended only for large logs: virtualize off-screen rows. `--h` is the
// per-row estimate set inline on each .msg.
const VIRTUAL_STYLE = `
body.virt .msg{content-visibility:auto;contain-intrinsic-size:0 var(--h,46px)}
`;

export function renderHTML(finalChunks, userMap, maxTokens, opts = {}) {
  const stats = {};
  for (const c of finalChunks) stats[c.authorId] = (stats[c.authorId] || 0) + 1;
  const total = finalChunks.length;
  const nameOf = (uid) => (opts.redactNames ? uid : userMap.get(uid) || uid);
  const virtualize = total > VIRTUALIZE_THRESHOLD;

  const head = [];
  head.push('<!doctype html>');
  head.push('<html lang="en"><head><meta charset="utf-8">');
  head.push(
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
  );
  head.push('<title>Chat Log</title>');
  head.push(`<style>${STYLE}${virtualize ? VIRTUAL_STYLE : ''}</style>`);
  head.push(
    `</head><body${virtualize ? ' class="virt"' : ''}><div class="wrap">`,
  );

  const body = [];
  body.push('<header>');
  if (opts.preamble && opts.preamble.trim())
    body.push(`<p class="meta">${escHtml(opts.preamble.trim())}</p>`);
  body.push('<h1>Chat Log</h1>');
  if (total > 0) {
    body.push(
      `<div class="meta">${total.toLocaleString()} messages · from ` +
        `${escHtml(finalChunks[0].timestamp.toUTCString())} (UTC)</div>`,
    );
    // Participant legend, most active first.
    const legend = Object.keys(stats)
      .sort((a, b) => stats[b] - stats[a])
      .map((uid) => {
        const pct = ((stats[uid] / total) * 100).toFixed(1);
        const nm = nameOf(uid);
        return (
          `<span class="pill"><span class="dot" style="background:${colorFor(uid)}">` +
          `${initials(nm)}</span>${escHtml(nm)} ` +
          `<span class="pct">${stats[uid]} · ${pct}%</span></span>`
        );
      });
    body.push(`<div class="participants">${legend.join('')}</div>`);
  }
  body.push('</header>');

  if (total === 0) {
    body.push('<div class="empty">No messages found.</div>');
  } else {
    let lastDate = null;
    let lastAid = null;
    let lastTs = null;
    for (const chunk of finalChunks) {
      const ts = chunk.timestamp;
      const curDate = utcDayKey(ts);
      let isNewBlock = false;
      if (curDate !== lastDate) {
        body.push(
          `<div class="divider">${escHtml(formatDayDividerUtc(ts))}</div>`,
        );
        isNewBlock = true;
      } else if (lastTs && ts - lastTs > SESSION_BREAK_THRESHOLD) {
        body.push(
          `<div class="divider break">Session break · ${escHtml(
            formatLongDuration(ts - lastTs),
          )}</div>`,
        );
        isNewBlock = true;
      }

      const { contentLines, reply, reactions } = splitParts(chunk);
      // Start a fresh author block on a new author, after any divider, or when
      // this message opens with a reply (replies always show their own header).
      const grouped = !isNewBlock && chunk.authorId === lastAid && !reply;

      const nm = nameOf(chunk.authorId);
      const color = colorFor(chunk.authorId);
      const inner = [];
      if (reply) inner.push(renderReply(reply, userMap, opts));
      if (!grouped) {
        inner.push(
          `<div class="head"><span class="author" style="color:${color}">` +
            `${escHtml(nm)}</span><span class="time">${escHtml(
              formatAMPMUtc(ts),
            )}</span></div>`,
        );
      }
      if (contentLines.length)
        inner.push(
          `<div class="content">${contentLines
            .map((l) => renderContentLine(l, opts))
            .join('\n')}</div>`,
        );
      inner.push(renderReactions(reactions));

      const avatar = grouped
        ? '<div class="avatar blank"></div>'
        : `<div class="avatar" style="background:${color}">${initials(nm)}</div>`;
      const est = virtualize
        ? ` style="--h:${estimateHeight(grouped, contentLines, reply, reactions)}px"`
        : '';
      body.push(
        `<div class="msg${grouped ? ' cont' : ''}"${est}>${avatar}` +
          `<div class="body">${inner.filter(Boolean).join('')}</div></div>`,
      );

      lastDate = curDate;
      lastAid = chunk.authorId;
      lastTs = ts;
    }
  }

  return head.join('') + body.join('\n') + '</div></body></html>';
}
