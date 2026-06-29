// Parser for DCE HTML exports. Parses ONCE into userMap-independent raw messages
// (see core/assemble.js).
//
// Uses htmlparser2 (DOM-free) + css-select instead of the browser DOMParser, so
// this runs in a Web Worker and avoids building a heavy browser DOM for large
// exports. The query logic mirrors the previous querySelectorAll code, so
// behavior is pinned by the existing HTML fixture/tests.
//
// messageId comes from the clean `data-message-id` snowflake (A3); timestamps
// are derived from that snowflake's embedded creation time (locale-independent,
// A1/A8), falling back to the rendered title only for older exports.

import { parseDocument } from 'htmlparser2';
import { selectAll, selectOne } from 'css-select';
import { textContent, getAttributeValue } from 'domutils';
import { parseTimestamp } from '../core/time.js';
import { snowflakeToDate } from '../core/snowflake.js';

const text = (el) => (el ? textContent(el).trim() : '');
const attr = (el, name) => (el ? getAttributeValue(el, name) : undefined);

// Extract a filename from an attachment href without needing window.location
// (worker-safe). Absolute URLs parse directly; relative paths are handled too.
function fileNameFromHref(href) {
  let pathname;
  try {
    pathname = new URL(href).pathname;
  } catch {
    pathname = href.split('?')[0].split('#')[0];
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    /* keep as-is */
  }
  return pathname.split('/').pop().split('?')[0];
}

export function parseMessages(htmlString) {
  const doc = parseDocument(htmlString);
  const messages = [];

  for (const group of selectAll('.chatlog__message-group', doc)) {
    const authorTag =
      selectOne('.chatlog__author', group) ||
      selectOne('.chatlog__system-notification-author', group);
    const authorName = authorTag ? text(authorTag) : 'Unknown';
    // Stable identity (#4): the author span carries data-user-id. Reply-author
    // markup has no id, so replies fall back to matching by display name.
    const authorKey = attr(authorTag, 'data-user-id') || null;
    // The author span's title is the username (e.g. "alice#0001") — distinct
    // from the displayed nickname. Used to link id-less TXT authors (written by
    // username) to this identity.
    const authorUsername = (attr(authorTag, 'title') || '').trim() || null;

    for (const container of selectAll('.chatlog__message-container', group)) {
      // A3: prefer the clean snowflake in data-message-id; fall back to the
      // legacy container id (older exports used id="message-<id>").
      const rawId = attr(container, 'id') || '';
      const messageId =
        attr(container, 'data-message-id') ||
        (rawId.startsWith('message-') ? rawId.slice(8) : rawId || null);

      // A1/A8: derive an exact UTC instant from the snowflake when possible;
      // otherwise fall back to parsing the locale-dependent timestamp title.
      let timestamp = snowflakeToDate(messageId);
      if (!timestamp) {
        const tsTag = selectOne(
          '.chatlog__timestamp, .chatlog__short-timestamp, .chatlog__system-notification-timestamp',
          container,
        );
        const title = attr(tsTag, 'title');
        if (!title) continue;
        timestamp = parseTimestamp(title);
      }
      if (!timestamp) continue;

      const sysContentEl = selectOne(
        '.chatlog__system-notification-content',
        container,
      );
      const isSystem = !!sysContentEl;

      // Reply
      let replyToName = null,
        replySnippet = null,
        replyToMessageId = null;
      const replyDiv = selectOne('.chatlog__reply', container);
      if (replyDiv) {
        const rAuthor = selectOne('.chatlog__reply-author', replyDiv);
        if (rAuthor) {
          replyToName = text(rAuthor);
          // The reply link carries the referenced message's snowflake in its
          // onclick (`scrollToMessage(event,'<id>')`) — the exact target, more
          // reliable than the displayed nickname (which may be an old name).
          const rLink = selectOne('.chatlog__reply-link', replyDiv);
          const onclick = rLink ? attr(rLink, 'onclick') || '' : '';
          const idm = onclick.match(/(\d{17,21})/);
          if (idm) replyToMessageId = idm[1];
          const rConDiv = selectOne('.chatlog__reply-content', replyDiv);
          replySnippet = '…';
          if (rConDiv) {
            const raw = text(rConDiv).replace(/\n/g, ' ');
            // A6: both placeholder strings DCE emits for content-less replies.
            const isPlaceholder =
              raw.includes('Click to see original') ||
              raw.includes('Click to see attachment');
            if (raw && !isPlaceholder)
              replySnippet = raw.length > 80 ? raw.substring(0, 80) + '…' : raw;
          }
        }
      }

      const parts = [];

      // Content
      if (sysContentEl) {
        parts.push(`[${text(sysContentEl)}]`);
      } else {
        const msgContent = selectOne('.chatlog__markdown-preserve', container);
        const t = text(msgContent);
        if (t) parts.push(t);
      }

      // Attachments
      for (const att of selectAll('.chatlog__attachment', container)) {
        const href =
          attr(att, 'href') || attr(selectOne('img, video', att), 'src') || '';
        if (!href) continue;
        const fname = fileNameFromHref(href);
        const ext = fname.split('.').pop().toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext))
          parts.push(`[${ext === 'gif' ? 'GIF' : 'IMG'}: ${fname}]`);
        else if (['mp4', 'mov', 'webm'].includes(ext))
          parts.push(`[VID: ${fname}]`);
        else parts.push(`[MEDIA: ${fname}]`);
      }

      // Embeds
      for (const embed of selectAll('.chatlog__embed', container)) {
        if (selectOne('video', embed)) {
          parts.push('[VID: Embedded Video]');
          continue;
        }
        const provider = selectOne('.chatlog__embed-provider', embed);
        const title = selectOne('.chatlog__embed-title', embed);
        if (provider && text(provider).includes('YouTube'))
          parts.push(`[YT: ${title ? text(title) : 'Video'}]`);
        else if (title) parts.push(`[EMBED: ${text(title)}]`);
      }

      // Stickers
      if (selectOne('.chatlog__sticker', container)) parts.push('[STICKER]');

      // Reactions
      let reactions = null;
      const reactionEls = selectAll('.chatlog__reaction', container);
      if (reactionEls.length > 0) {
        const reactList = reactionEls.map((r) => {
          const img = selectOne('img', r);
          const alt = img ? (getAttributeValue(img, 'alt') ?? '') : '?';
          const countEl = selectOne('.chatlog__reaction-count', r);
          return `${alt}:${countEl ? text(countEl) : '1'}`;
        });
        reactions = `^{${reactList.join(', ')}}`;
      }

      if (parts.length > 0 || replyToName != null || reactions)
        messages.push({
          messageId,
          authorKey,
          authorName,
          authorUsername,
          timestamp,
          isSystem,
          replyToKey: null, // reply markup has no user id
          replyToMessageId,
          replyToName,
          replySnippet,
          parts,
          reactions,
        });
    }
  }
  return messages;
}
