// Parser for DCE HTML exports. Parses the document ONCE into userMap-independent
// raw messages (see core/assemble.js); author-id mapping happens later.
//
// messageId comes from the clean `data-message-id` snowflake (A3); timestamps
// are derived from that snowflake's embedded creation time (locale-independent,
// A1/A8), falling back to the rendered title only for older exports.
//
// Uses window.location.href as a URL base, so it is not yet Worker-safe.

import { parseTimestamp } from '../core/time.js';
import { snowflakeToDate } from '../core/snowflake.js';

export function parseMessages(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const messages = [];

  doc.querySelectorAll('.chatlog__message-group').forEach((group) => {
    const authorTag =
      group.querySelector('.chatlog__author') ||
      group.querySelector('.chatlog__system-notification-author');
    const authorName = authorTag ? authorTag.textContent.trim() : 'Unknown';

    group
      .querySelectorAll('.chatlog__message-container')
      .forEach((container) => {
        // A3: prefer the clean snowflake in data-message-id; fall back to the
        // legacy container id (older exports used id="message-<id>").
        const rawId = container.id || '';
        const messageId =
          container.getAttribute('data-message-id') ||
          (rawId.startsWith('message-') ? rawId.slice(8) : rawId || null);

        // A1/A8: derive an exact UTC instant from the snowflake when possible;
        // otherwise fall back to parsing the locale-dependent timestamp title.
        let timestamp = snowflakeToDate(messageId);
        if (!timestamp) {
          const tsTag = container.querySelector(
            '.chatlog__timestamp, .chatlog__short-timestamp, .chatlog__system-notification-timestamp',
          );
          if (!tsTag || !tsTag.title) return;
          timestamp = parseTimestamp(tsTag.title);
        }
        if (!timestamp) return;

        const isSystem = !!container.querySelector(
          '.chatlog__system-notification-content',
        );

        // Reply
        let replyToName = null,
          replySnippet = null;
        const replyDiv = container.querySelector('.chatlog__reply');
        if (replyDiv) {
          const rAuthor = replyDiv.querySelector('.chatlog__reply-author');
          if (rAuthor) {
            replyToName = rAuthor.textContent.trim();
            const rConDiv = replyDiv.querySelector('.chatlog__reply-content');
            replySnippet = '…';
            if (rConDiv) {
              const raw = rConDiv.textContent.trim().replace(/\n/g, ' ');
              // A6: both placeholder strings DCE emits for content-less replies.
              const isPlaceholder =
                raw.includes('Click to see original') ||
                raw.includes('Click to see attachment');
              if (raw && !isPlaceholder)
                replySnippet =
                  raw.length > 80 ? raw.substring(0, 80) + '…' : raw;
            }
          }
        }

        const parts = [];

        // Content
        const sysContent = container.querySelector(
          '.chatlog__system-notification-content',
        );
        if (sysContent) {
          parts.push(`[${sysContent.textContent.trim()}]`);
        } else {
          const msgContent = container.querySelector(
            '.chatlog__markdown-preserve',
          );
          if (msgContent) {
            const text = msgContent.textContent.trim();
            if (text) parts.push(text);
          }
        }

        // Attachments
        container.querySelectorAll('.chatlog__attachment').forEach((att) => {
          const href =
            att.href || (att.querySelector('img, video') || {}).src || '';
          if (!href) return;
          try {
            const urlObj = new URL(href, window.location.href);
            const pathname = decodeURIComponent(urlObj.pathname);
            const fname = pathname.split('/').pop().split('?')[0];
            const ext = fname.split('.').pop().toLowerCase();
            if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext))
              parts.push(`[${ext === 'gif' ? 'GIF' : 'IMG'}: ${fname}]`);
            else if (['mp4', 'mov', 'webm'].includes(ext))
              parts.push(`[VID: ${fname}]`);
            else parts.push(`[MEDIA: ${fname}]`);
          } catch {
            parts.push('[MEDIA: unknown]');
          }
        });

        // Embeds
        container.querySelectorAll('.chatlog__embed').forEach((embed) => {
          if (embed.querySelector('video')) {
            parts.push('[VID: Embedded Video]');
            return;
          }
          const provider = embed.querySelector('.chatlog__embed-provider');
          const title = embed.querySelector('.chatlog__embed-title');
          if (provider && provider.textContent.includes('YouTube'))
            parts.push(`[YT: ${title ? title.textContent.trim() : 'Video'}]`);
          else if (title) parts.push(`[EMBED: ${title.textContent.trim()}]`);
        });

        // Stickers
        if (container.querySelector('.chatlog__sticker'))
          parts.push('[STICKER]');

        // Reactions
        let reactions = null;
        const reactionEls = container.querySelectorAll('.chatlog__reaction');
        if (reactionEls.length > 0) {
          const reactList = [];
          reactionEls.forEach((r) => {
            const img = r.querySelector('img');
            const alt = img ? img.alt : '?';
            const countTag = r.querySelector('.chatlog__reaction-count');
            reactList.push(
              `${alt}:${countTag ? countTag.textContent.trim() : '1'}`,
            );
          });
          reactions = `^{${reactList.join(', ')}}`;
        }

        if (parts.length > 0 || replyToName != null || reactions)
          messages.push({
            messageId,
            authorName,
            timestamp,
            isSystem,
            replyToName,
            replySnippet,
            parts,
            reactions,
          });
      });
  });
  return messages;
}
