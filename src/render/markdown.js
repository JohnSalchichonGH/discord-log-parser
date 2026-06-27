// Renderer for Markdown output. Extracted verbatim from legacy index.html.

import { formatAMPMUtc, formatDayDividerUtc, utcDayKey } from '../core/time.js';

export function renderMarkdown(finalChunks, userMap, maxTokens, opts) {
  if (finalChunks.length === 0) return 'No messages found.';
  const stats = {};
  for (const c of finalChunks) stats[c.authorId] = (stats[c.authorId] || 0) + 1;
  const total = finalChunks.length;
  const out = [];
  if (opts.preamble?.trim()) {
    out.push(opts.preamble.trim());
    out.push('');
    out.push('---');
    out.push('');
  }
  out.push(`# Chat Log (~${maxTokens.toLocaleString()} token limit)`);
  out.push(`**Start:** ${finalChunks[0].timestamp.toUTCString()}`);
  out.push('');
  out.push('## Participants');
  [...userMap.entries()]
    .filter(([, uid]) => stats[uid])
    .sort((a, b) => {
      const ma = /^U(\d+)$/.exec(a[1]),
        mb = /^U(\d+)$/.exec(b[1]);
      if (ma && mb) return parseInt(ma[1]) - parseInt(mb[1]);
      return (stats[b[1]] || 0) - (stats[a[1]] || 0);
    })
    .forEach(([name, uid]) => {
      const c = stats[uid];
      const pct = ((c / total) * 100).toFixed(1);
      out.push(`- **${uid}**: ${opts.redactNames ? '' : name + ' '}(${c} msgs, ${pct}%)`);
    });
  out.push('');
  out.push('---');
  out.push('');

  let lastDate = null;
  for (const chunk of finalChunks) {
    const curDate = utcDayKey(chunk.timestamp);
    if (lastDate !== curDate) {
      out.push(`## ${formatDayDividerUtc(chunk.timestamp)}`);
      out.push('');
      lastDate = curDate;
    }
    const time = formatAMPMUtc(chunk.timestamp);
    const aid = chunk.authorId;
    out.push(`**[${time}] ${aid}:**`);
    chunk.contentParts.forEach((p) => {
      if (p.startsWith('>')) out.push(p);
      else out.push(p);
    });
    out.push('');
  }
  let result = out.join('\n');
  if (opts.redactUrls) result = result.replace(/https?:\/\/[^\s\]>)]+/g, '[URL]');
  if (opts.redactEmails) {
    result = result.replace(
      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      '[EMAIL]',
    );
    // D2: match TXT — also redact phone numbers.
    result = result.replace(
      /(\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
      '[PHONE]',
    );
  }
  return result;
}
