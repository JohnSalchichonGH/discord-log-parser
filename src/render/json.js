// Renderer for structured JSON output. Extracted verbatim from legacy index.html.

export function renderJSON(finalChunks, userMap, opts) {
  const msgs = finalChunks.map((c) => ({
    timestamp: c.timestamp.toISOString(),
    author: opts.redactNames ? c.authorId : c.authorName,
    authorId: c.authorId,
    content: c.contentParts
      .filter((p) => !p.startsWith('>') && !p.startsWith('^'))
      .join('\n'),
    replyTo:
      c.contentParts.find((p) => p.startsWith('>'))?.replace(/^>\s*/, '') || null,
    reactions:
      c.contentParts.find((p) => p.startsWith('^'))?.replace(/^\^/, '') || null,
  }));
  let result = JSON.stringify(
    {
      participants: Object.fromEntries(
        [...userMap.entries()].map(([name, uid]) => [
          uid,
          opts.redactNames ? uid : name,
        ]),
      ),
      messages: msgs,
    },
    null,
    2,
  );
  if (opts.redactUrls) result = result.replace(/https?:\/\/[^\s"\\]+/g, '[URL]');
  return result;
}
