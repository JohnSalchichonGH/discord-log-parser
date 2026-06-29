// Renderer for CSV output.
//
// D2: redaction is applied to the content cell (per-field, so the ISO timestamp
// and author id columns are never affected).

import { redactString } from '../core/redact.js';

// Quote a cell and neutralize spreadsheet formula injection: a cell that starts
// with =, +, -, @, tab, or CR is evaluated as a formula by Excel/Sheets. Discord
// message content is untrusted, so prefix such cells with an apostrophe to force
// them to be treated as text.
function csvCell(value) {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

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
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
