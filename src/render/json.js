// Renderer for structured JSON output.
//
// Redaction (D2) is applied to the message content/reply fields only, so author
// ids and ISO timestamps are never affected by the phone-number pattern.

import { redactString } from '../core/redact.js';

export function renderJSON(finalChunks, userMap, opts) {
  const msgs = finalChunks.map((c) => {
    // Only the FIRST part is a reply token; a body part starting with ">" is a
    // markdown blockquote and belongs in content.
    const isReply =
      c.hasReply !== false && (c.contentParts[0] || '').startsWith('>');
    const reply = isReply ? c.contentParts[0].replace(/^>\s*/, '') : null;
    return {
      timestamp: c.timestamp.toISOString(),
      author: opts.redactNames ? c.authorId : c.authorName,
      authorId: c.authorId,
      content: redactString(
        c.contentParts
          .filter((p, i) => !(i === 0 && isReply) && !p.startsWith('^'))
          .join('\n'),
        opts,
      ),
      replyTo: reply ? redactString(reply, opts) : null,
      reactions:
        c.contentParts.find((p) => p.startsWith('^'))?.replace(/^\^/, '') ||
        null,
    };
  });
  return JSON.stringify(
    {
      // userMap is uid -> displayName (#4)
      participants: Object.fromEntries(
        [...userMap.entries()].map(([uid, name]) => [
          uid,
          opts.redactNames ? uid : name,
        ]),
      ),
      messages: msgs,
    },
    null,
    2,
  );
}
