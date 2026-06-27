// Parser for DCE plain-text (.txt) exports.
// Extracted verbatim from legacy index.html (PlainTextMessageWriter format).
//
// KNOWN LIMITATIONS (tracked for later phases):
//  - TXT_MSG_RE assumes the en-US "M/D/YYYY H:MM AM/PM" header shape. DCE emits
//    dates in the export machine's locale ("g" format), so non-US locales break
//    parsing entirely (bug A1).
//  - {Stickers} and {Forwarded Message} control blocks are not handled (bug A5).
//  - The {Reply} branch never triggers on real DCE output (bug A4).

import { parseTimestamp } from '../core/time.js';

export const TXT_MSG_RE =
  /^\[(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)\]\s+(.+)$/;

// Heuristic: detect system messages in TXT exports by content patterns.
export const SYSTEM_PATTERNS = [
  /^Pinned a message\.?$/i,
  /joined the server\.?$/i,
  /left the server\.?$/i,
  /^Started a thread/i,
  /boosted the server/i,
  /^Changed the channel/i,
  /^Added .+ to the group/i,
  /^Removed .+ from the group/i,
];

export function isTxtSystemMessage(contentParts) {
  if (contentParts.length !== 1) return false;
  const text = contentParts[0].trim();
  return SYSTEM_PATTERNS.some((p) => p.test(text));
}

export function parseTxtHeader(content) {
  let guild = '',
    channel = '';
  for (const line of content.split('\n').slice(0, 10)) {
    const gl = line.match(/^Guild:\s*(.+)/);
    if (gl) guild = gl[1].trim();
    const cl = line.match(/^Channel:\s*(.+)/);
    if (cl) channel = cl[1].trim();
  }
  const chanShort = channel.split('/').pop().trim() || channel || 'unknown';
  const chanId = guild + '|' + channel || 'txt-unknown';
  const baseName = (guild ? guild + ' - ' : '') + chanShort;
  return { channelId: chanId, baseName };
}

export function parseTxtAuthors(content) {
  const names = new Set();
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(TXT_MSG_RE);
    if (m) names.add(m[2].trim());
  }
  return names;
}

export function collectAuthorsTxt(content, userMap, counter) {
  for (const name of parseTxtAuthors(content)) {
    if (!userMap.has(name)) userMap.set(name, `U${counter.value++}`);
  }
}

export function extractMessagesTxt(content, userMap) {
  const messages = [];
  const lines = content.split('\n');
  let curAuthorName = null,
    curTimestamp = null;
  let textLines = [],
    reactions = [],
    attachments = [];
  let mode = 'text';

  function flushMessage() {
    if (!curAuthorName || !curTimestamp) return;
    const authorId = userMap.get(curAuthorName) || curAuthorName;
    const contentParts = [];
    const text = textLines.join('\n').trim();
    if (text) {
      const textLinesSplit = text.split('\n');
      let replyStr = null,
        bodyLines = [];
      for (const tl of textLinesSplit) {
        const rq = tl.match(/^>\s*(.+?):\s*(.*)$/);
        if (rq && !replyStr) {
          const rName = rq[1].trim();
          const rId = userMap.has(rName) ? userMap.get(rName) : rName;
          const snip = rq[2].trim();
          replyStr = `> ${rId}: ${snip.length > 80 ? snip.substring(0, 80) + '…' : snip}`;
        } else bodyLines.push(tl);
      }
      if (replyStr) contentParts.push(replyStr);
      const body = bodyLines.join('\n').trim();
      if (body) contentParts.push(body);
    }
    for (const url of attachments) {
      try {
        const urlObj = new URL(url);
        const raw = decodeURIComponent(urlObj.pathname);
        const fname = raw.split('/').pop().split('?')[0];
        const ext = fname.split('.').pop().toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext))
          contentParts.push(`[${ext === 'gif' ? 'GIF' : 'IMG'}: ${fname}]`);
        else if (['mp4', 'mov', 'webm'].includes(ext))
          contentParts.push(`[VID: ${fname}]`);
        else if (fname) contentParts.push(`[MEDIA: ${fname}]`);
      } catch {
        contentParts.push('[MEDIA: unknown]');
      }
    }
    if (reactions.length > 0) {
      const formatted = `^{${reactions.join(', ')}}`;
      if (
        contentParts.length > 0 &&
        !contentParts[contentParts.length - 1].startsWith('[')
      )
        contentParts[contentParts.length - 1] += ' ' + formatted;
      else contentParts.push(formatted);
    }
    if (contentParts.length > 0)
      messages.push({
        messageId: null,
        authorName: curAuthorName,
        authorId,
        timestamp: curTimestamp,
        contentParts,
        isSystem: isTxtSystemMessage(contentParts),
      });
    textLines = [];
    reactions = [];
    attachments = [];
    mode = 'text';
  }

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const mh = line.match(TXT_MSG_RE);
    if (mh) {
      flushMessage();
      curTimestamp = parseTimestamp(mh[1]);
      curAuthorName = mh[2].trim();
      mode = 'text';
      continue;
    }
    if (!curAuthorName) continue;
    const trimmed = line.trim();
    if (trimmed === '{Embed}') {
      mode = 'embed';
      continue;
    }
    if (trimmed === '{Attachments}') {
      mode = 'attachments';
      continue;
    }
    if (trimmed === '{Reactions}') {
      mode = 'reactions';
      continue;
    }
    if (trimmed === '{Reply}') {
      mode = 'text';
      continue;
    }
    switch (mode) {
      case 'embed':
        if (trimmed === '') mode = 'text';
        break;
      case 'attachments':
        if (trimmed === '') {
          mode = 'text';
          break;
        }
        if (trimmed.startsWith('http')) attachments.push(trimmed);
        break;
      case 'reactions':
        if (trimmed === '') {
          mode = 'text';
          break;
        }
        if (trimmed) reactions.push(trimmed);
        break;
      default:
        textLines.push(line);
        break;
    }
  }
  flushMessage();
  return messages;
}
