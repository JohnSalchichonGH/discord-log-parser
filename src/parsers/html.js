// Parser for DCE HTML exports.
// Extracted verbatim from legacy index.html (MessageGroupTemplate.cshtml structure).
//
// KNOWN ISSUES (tracked for later phases):
//  - Uses window.location.href as a URL base, so it is not yet Worker-safe.
//
// FIXED: messageId now comes from the clean `data-message-id` snowflake (A3),
// and timestamps are derived from that snowflake's embedded creation time
// (locale-independent, A1/A8), falling back to the rendered title only when a
// snowflake is unavailable (e.g. older exports).

import { parseTimestamp } from '../core/time.js';
import { snowflakeToDate } from '../core/snowflake.js';

export function collectAuthors(htmlString, userMap, counter) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  doc.querySelectorAll('.chatlog__message-group').forEach((group) => {
    const tag =
      group.querySelector('.chatlog__author') ||
      group.querySelector('.chatlog__system-notification-author');
    if (tag) {
      const name = tag.textContent.trim();
      if (name && !userMap.has(name)) userMap.set(name, `U${counter.value++}`);
    }
    group.querySelectorAll('.chatlog__reply-author').forEach((ra) => {
      const name = ra.textContent.trim();
      if (name && !userMap.has(name)) userMap.set(name, `U${counter.value++}`);
    });
  });
}

export function extractMessages(htmlString, userMap) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const messages = [];

  doc.querySelectorAll('.chatlog__message-group').forEach((group) => {
    const authorTag =
      group.querySelector('.chatlog__author') ||
      group.querySelector('.chatlog__system-notification-author');
    const authorName = authorTag ? authorTag.textContent.trim() : 'Unknown';
    const authorId = userMap.get(authorName) || authorName;

    group.querySelectorAll('.chatlog__message-container').forEach((container) => {
      // A3: prefer the clean snowflake in data-message-id; fall back to the
      // legacy container id (older exports used id="message-<id>").
      const rawId = container.id || '';
      const messageId =
        container.getAttribute('data-message-id') ||
        (rawId.startsWith('message-') ? rawId.slice(8) : rawId || null);

      // A1/A8: derive an exact UTC instant from the snowflake when possible;
      // otherwise fall back to parsing the locale-dependent timestamp title.
      let dtObj = snowflakeToDate(messageId);
      if (!dtObj) {
        const tsTag = container.querySelector(
          '.chatlog__timestamp, .chatlog__short-timestamp, .chatlog__system-notification-timestamp',
        );
        if (!tsTag || !tsTag.title) return;
        dtObj = parseTimestamp(tsTag.title);
      }
      if (!dtObj) return;

      const contentParts = [];
      const isSystem = !!container.querySelector(
        '.chatlog__system-notification-content',
      );

      // Reply
      const replyDiv = container.querySelector('.chatlog__reply');
      if (replyDiv) {
        const rAuthor = replyDiv.querySelector('.chatlog__reply-author');
        if (rAuthor) {
          const rName = rAuthor.textContent.trim();
          const rId = userMap.has(rName) ? userMap.get(rName) : rName;
          const rConDiv = replyDiv.querySelector('.chatlog__reply-content');
          let rSnippet = '…';
          if (rConDiv) {
            const raw = rConDiv.textContent.trim().replace(/\n/g, ' ');
            if (raw && !raw.includes('Click to see original'))
              rSnippet = raw.length > 80 ? raw.substring(0, 80) + '…' : raw;
          }
          contentParts.push(`> ${rId}: ${rSnippet}`);
        }
      }

      // Content
      const sysContent = container.querySelector(
        '.chatlog__system-notification-content',
      );
      if (sysContent) {
        contentParts.push(`[${sysContent.textContent.trim()}]`);
      } else {
        const msgContent = container.querySelector('.chatlog__markdown-preserve');
        if (msgContent) {
          const text = msgContent.textContent.trim();
          if (text) contentParts.push(text);
        }
      }

      // Attachments
      container.querySelectorAll('.chatlog__attachment').forEach((att) => {
        const href = att.href || (att.querySelector('img, video') || {}).src || '';
        if (!href) return;
        try {
          const urlObj = new URL(href, window.location.href);
          const pathname = decodeURIComponent(urlObj.pathname);
          const fname = pathname.split('/').pop().split('?')[0];
          const ext = fname.split('.').pop().toLowerCase();
          if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext))
            contentParts.push(`[${ext === 'gif' ? 'GIF' : 'IMG'}: ${fname}]`);
          else if (['mp4', 'mov', 'webm'].includes(ext))
            contentParts.push(`[VID: ${fname}]`);
          else contentParts.push(`[MEDIA: ${fname}]`);
        } catch {
          contentParts.push('[MEDIA: unknown]');
        }
      });

      // Embeds
      container.querySelectorAll('.chatlog__embed').forEach((embed) => {
        if (embed.querySelector('video')) {
          contentParts.push('[VID: Embedded Video]');
          return;
        }
        const provider = embed.querySelector('.chatlog__embed-provider');
        const title = embed.querySelector('.chatlog__embed-title');
        if (provider && provider.textContent.includes('YouTube'))
          contentParts.push(`[YT: ${title ? title.textContent.trim() : 'Video'}]`);
        else if (title) contentParts.push(`[EMBED: ${title.textContent.trim()}]`);
      });

      // Stickers
      if (container.querySelector('.chatlog__sticker'))
        contentParts.push('[STICKER]');

      // Reactions
      const reactions = container.querySelectorAll('.chatlog__reaction');
      if (reactions.length > 0) {
        const reactList = [];
        reactions.forEach((r) => {
          const img = r.querySelector('img');
          const alt = img ? img.alt : '?';
          const countTag = r.querySelector('.chatlog__reaction-count');
          reactList.push(`${alt}:${countTag ? countTag.textContent.trim() : '1'}`);
        });
        const formatted = `^{${reactList.join(', ')}}`;
        if (
          contentParts.length > 0 &&
          !contentParts[contentParts.length - 1].startsWith('[')
        )
          contentParts[contentParts.length - 1] += ' ' + formatted;
        else contentParts.push(formatted);
      }

      if (contentParts.length > 0)
        messages.push({
          messageId,
          authorName,
          authorId,
          timestamp: dtObj,
          contentParts,
          isSystem,
        });
    });
  });
  return messages;
}
