// Renderer for CSV output.
//
// D2: redaction is applied to the content cell (per-field, so the ISO timestamp
// and author id columns are never affected).

import { redactString } from '../core/redact.js';

export function renderCSV(finalChunks, userMap, opts) {
  const rows = [
    ['timestamp', 'author_id', 'author_name', 'content', 'reactions'],
  ];
  for (const c of finalChunks) {
    const content = redactString(
      c.contentParts.filter((p) => !p.startsWith('^')).join(' | '),
      opts,
    );
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
    .map((r) =>
      r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
    )
    .join('\n');
}
