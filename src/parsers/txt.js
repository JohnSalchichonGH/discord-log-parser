// Parser for DCE plain-text (.txt) exports. Parses ONCE into userMap-independent
// raw messages (see core/assemble.js).
//
// KNOWN LIMITATION: TXT_MSG_RE assumes the en-US "M/D/YYYY H:MM AM/PM" header
// shape. DCE emits dates in the export machine's locale ("g" format), so non-US
// locales break parsing entirely (bug A1) — prefer JSON for those.

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

export function isTxtSystemMessage(parts) {
  if (parts.length !== 1) return false;
  const text = parts[0].trim();
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
  // Only fall back to 'txt-unknown' when both header lines are absent (the old
  // `guild + '|' + channel` was always truthy, so the fallback never fired).
  const chanId = guild || channel ? `${guild}|${channel}` : 'txt-unknown';
  const baseName = (guild ? guild + ' - ' : '') + chanShort;
  return { channelId: chanId, baseName };
}

export function parseMessages(content) {
  const messages = [];
  const lines = content.split('\n');
  let curAuthorName = null,
    curTimestamp = null;
  let textLines = [],
    reactions = [],
    attachments = [],
    stickers = [];
  let mode = 'text';

  function flushMessage() {
    if (!curAuthorName || !curTimestamp) return;
    const parts = [];
    // DCE plain-text exports carry no reply metadata, so message text — including
    // any markdown blockquotes — is kept verbatim as body content (A4).
    const text = textLines.join('\n').trim();
    if (text) parts.push(text);

    for (const url of attachments) {
      try {
        const urlObj = new URL(url);
        const raw = decodeURIComponent(urlObj.pathname);
        const fname = raw.split('/').pop().split('?')[0];
        const ext = fname.split('.').pop().toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext))
          parts.push(`[${ext === 'gif' ? 'GIF' : 'IMG'}: ${fname}]`);
        else if (['mp4', 'mov', 'webm'].includes(ext))
          parts.push(`[VID: ${fname}]`);
        else if (fname) parts.push(`[MEDIA: ${fname}]`);
      } catch {
        parts.push('[MEDIA: unknown]');
      }
    }
    // Stickers (A5): one [STICKER] token per sticker URL in the {Stickers} block.
    for (let i = 0; i < stickers.length; i++) parts.push('[STICKER]');

    const reactionStr =
      reactions.length > 0 ? `^{${reactions.join(', ')}}` : null;

    if (parts.length > 0 || reactionStr)
      messages.push({
        messageId: null,
        authorKey: null, // TXT exports carry no user ids
        authorName: curAuthorName,
        timestamp: curTimestamp,
        isSystem: isTxtSystemMessage(parts),
        replyToKey: null,
        replyToName: null,
        replySnippet: null,
        parts,
        reactions: reactionStr,
      });

    textLines = [];
    reactions = [];
    attachments = [];
    stickers = [];
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
    // Postamble / separator line ("=====…"): end the current message so the
    // footer ("Exported N message(s)") is not slurped into it (A9).
    if (/^={40,}$/.test(trimmed)) {
      flushMessage();
      curAuthorName = null;
      curTimestamp = null;
      continue;
    }
    if (trimmed === '{Embed}') {
      mode = 'embed';
      continue;
    }
    if (trimmed === '{Attachments}') {
      mode = 'attachments';
      continue;
    }
    if (trimmed === '{Stickers}') {
      mode = 'stickers';
      continue;
    }
    if (trimmed === '{Reactions}') {
      mode = 'reactions';
      continue;
    }
    if (trimmed === '{Reply}' || trimmed === '{Forwarded Message}') {
      // Neither carries a payload we render specially; any content that follows
      // is captured as normal body text (A5: forwarded content is preserved).
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
      case 'stickers':
        if (trimmed === '') {
          mode = 'text';
          break;
        }
        if (trimmed.startsWith('http')) stickers.push(trimmed);
        break;
      case 'reactions':
        if (trimmed === '') {
          mode = 'text';
          break;
        }
        if (trimmed) reactions.push(trimmed);
        break;
      default:
        // Skip the forwarded-message metadata line (A5).
        if (/^Originally sent:/.test(trimmed)) break;
        textLines.push(line);
        break;
    }
  }
  flushMessage();
  return messages;
}
