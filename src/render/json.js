// Renderer for structured JSON output.
//
// Redaction (D2) is applied to the message content/reply fields only, so author
// ids and ISO timestamps are never affected by the phone-number pattern.

import { redactString } from '../core/redact.js';

export function renderJSON(finalChunks, userMap, opts) {
  const msgs = finalChunks.map((c) => {
    const reply =
      c.contentParts.find((p) => p.startsWith('>'))?.replace(/^>\s*/, '') ||
      null;
    return {
      timestamp: c.timestamp.toISOString(),
      author: opts.redactNames ? c.authorId : c.authorName,
      authorId: c.authorId,
      content: redactString(
        c.contentParts
          .filter((p) => !p.startsWith('>') && !p.startsWith('^'))
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
