// Renderer for CSV output. Extracted verbatim from legacy index.html.
//
// NOTE (Phase 2 / bug D2): unlike the other renderers, CSV applies no redaction
// pass, so redactUrls/redactEmails currently do not affect CSV output.

export function renderCSV(finalChunks, userMap, opts) {
  const rows = [['timestamp', 'author_id', 'author_name', 'content', 'reactions']];
  for (const c of finalChunks) {
    const content = c.contentParts.filter((p) => !p.startsWith('^')).join(' | ');
    const reactions = c.contentParts.find((p) => p.startsWith('^')) || '';
    rows.push([
      c.timestamp.toISOString(),
      c.authorId,
      opts.redactNames ? '' : c.authorName,
      content,
      reactions,
    ]);
  }
  return rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
