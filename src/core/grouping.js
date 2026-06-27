// Channel grouping and DCE filename parsing.
// Extracted verbatim from legacy index.html.
//
// NOTE (Phase 1 / bug A3): parseFilename keys HTML files by the numeric channel
// snowflake in `[...]`. The dated-partial pattern relies on DCE's default
// "(after YYYY-MM-DD)" filename suffix (ExportRequest.GetDefaultOutputFileName).
// Custom --output names can break this; that is addressed in a later phase.

export function parseFilename(filename) {
  const datedRe = /^(.+\[(\d+)\])\s*\(after (\d{4}-\d{2}-\d{2})\)\.html$/i;
  const baseRe = /^(.+\[(\d+)\])\.html$/i;
  let m;
  if ((m = filename.match(datedRe)))
    return {
      channelId: m[2],
      baseName: m[1].trim(),
      sortOrder: new Date(m[3]).getTime(),
      afterDate: m[3],
    };
  if ((m = filename.match(baseRe)))
    return { channelId: m[2], baseName: m[1].trim(), sortOrder: 0, afterDate: null };
  return {
    channelId: filename,
    baseName: filename.replace(/\.html$/i, ''),
    sortOrder: 0,
    afterDate: null,
  };
}

// Group loaded files by channelId; each group's files are sorted oldest-first
// by sortOrder (modification date for base files, the "after" date for partials).
export function buildGroups(files) {
  const groups = new Map();
  for (const f of files) {
    if (!groups.has(f.channelId)) groups.set(f.channelId, []);
    groups.get(f.channelId).push(f);
  }
  for (const [, arr] of groups) arr.sort((a, b) => a.sortOrder - b.sortOrder);
  return groups;
}
