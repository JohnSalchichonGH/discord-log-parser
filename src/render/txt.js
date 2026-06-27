// Renderer for the compact, LLM-optimized TXT format (the default output).
// Extracted verbatim from legacy index.html (renderTxt).
//
// Redaction is applied here as a final regex pass (kept per-renderer for now;
// unifying redaction across all renderers is a Phase 2 task, D2).

import {
  ABSOLUTE_TIME_THRESHOLD,
  SESSION_BREAK_THRESHOLD,
  formatAMPMUtc,
  formatDayDividerUtc,
  formatLongDuration,
  formatTimeDelta,
  utcDayKey,
} from '../core/time.js';

export function renderTxt(finalChunks, userMap, maxTokens, opts) {
  if (finalChunks.length === 0) return 'No messages found or file empty.';

  const stats = {};
  for (const c of finalChunks) stats[c.authorId] = (stats[c.authorId] || 0) + 1;
  const total = finalChunks.length;

  const out = [];
  // Custom preamble
  if (opts.preamble && opts.preamble.trim()) {
    out.push(opts.preamble.trim());
    out.push('');
  }

  out.push(
    `# LLM-Optimized Chat Log (Limit: ~${maxTokens.toLocaleString()} tokens)`,
  );
  out.push(`# Start: ${finalChunks[0].timestamp.toUTCString()}`);
  out.push('# Participants:');

  const sortedUsers = Array.from(userMap.entries())
    .filter(([, uid]) => stats[uid])
    .sort((a, b) => {
      const ma = /^U(\d+)$/.exec(a[1]),
        mb = /^U(\d+)$/.exec(b[1]);
      if (ma && mb) return parseInt(ma[1]) - parseInt(mb[1]);
      return (stats[b[1]] || 0) - (stats[a[1]] || 0);
    });

  sortedUsers.forEach(([name, uid]) => {
    const c = stats[uid];
    const pct = ((c / total) * 100).toFixed(1);
    if (opts.redactNames) out.push(`# ${uid}: (${c} msgs, ${pct}%)`);
    else out.push(`# ${uid}: ${name} (${c} msgs, ${pct}%)`);
  });
  out.push('');

  let lastAid = null,
    lastTs = null,
    lastDate = null;

  finalChunks.forEach((chunk) => {
    const { authorId: aid, timestamp: ts } = chunk;
    const curDate = utcDayKey(ts);
    let timeStr;
    if (lastDate !== curDate) {
      out.push(`\n=== ${formatDayDividerUtc(ts)} ===`);
      timeStr = `[${formatAMPMUtc(ts)}]`;
      lastAid = null;
    } else if (lastTs) {
      const delta = ts - lastTs;
      if (delta > SESSION_BREAK_THRESHOLD) {
        out.push(`\n=== SESSION BREAK (${formatLongDuration(delta)}) ===`);
        timeStr = `[${formatAMPMUtc(ts)}]`;
        lastAid = null;
      } else if (delta > ABSOLUTE_TIME_THRESHOLD) {
        timeStr = `[${formatAMPMUtc(ts)}]`;
      } else {
        timeStr = formatTimeDelta(delta);
      }
    } else {
      timeStr = `[${formatAMPMUtc(ts)}]`;
    }

    let parts = chunk.contentParts;
    if (parts[0] && parts[0].startsWith('^') && out.length > 0) {
      const prev = out[out.length - 1];
      if (!prev.startsWith('===') && !prev.endsWith(':')) {
        out[out.length - 1] += ' ' + parts[0];
        parts = parts.slice(1);
      }
    }
    if (parts.length === 0) {
      lastTs = ts;
      lastDate = curDate;
      return;
    }
    if (aid !== lastAid) {
      out.push(`\n${timeStr} ${aid}:`);
      lastAid = aid;
    }
    parts.forEach((p) => out.push(`  ${p}`));
    lastTs = ts;
    lastDate = curDate;
  });

  let result = out.join('\n');

  // Redaction passes
  if (opts.redactUrls) result = result.replace(/https?:\/\/[^\s\]]+/g, '[URL]');
  if (opts.redactEmails) {
    result = result.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[EMAIL]',
    );
    result = result.replace(
      /(\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
      '[PHONE]',
    );
  }

  return result;
}
