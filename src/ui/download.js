// Export helpers shared by the Preact Export step and the Output Preview
// (Transcript) card. The format switch, the safe-filename sanitizer, and the
// blob download were moved here from app.js (Phase 7) so the views stay thin.

import { renderTxt } from '../render/txt.js';
import { renderJSON } from '../render/json.js';
import { renderMarkdown } from '../render/markdown.js';
import { renderCSV } from '../render/csv.js';
import { renderHTML } from '../render/html.js';

// Derive the max-token budget + render options from a settings snapshot — the
// shared inputs every renderer below needs (and the live preview reuses).
export function exportConfig(cfg) {
  const maxTokens = Math.max(1000, parseInt(cfg.maxTokens) || 1375000);
  const renderOpts = {
    preamble: cfg.preamble,
    redactNames: cfg.redactNames,
    redactUrls: cfg.redactUrls,
    redactEmails: cfg.redactEmails,
  };
  return { maxTokens, renderOpts };
}

// Render one set of messages to text in the requested format. Returns the text
// plus the file extension so callers can name downloads consistently.
export function renderOutput(format, msgs, userMap, maxTokens, renderOpts) {
  switch (format) {
    case 'json':
      return { text: renderJSON(msgs, userMap, renderOpts), ext: 'json' };
    case 'md':
      return {
        text: renderMarkdown(msgs, userMap, maxTokens, renderOpts),
        ext: 'md',
      };
    case 'csv':
      return { text: renderCSV(msgs, userMap, renderOpts), ext: 'csv' };
    case 'html':
      return {
        text: renderHTML(msgs, userMap, maxTokens, renderOpts),
        ext: 'html',
      };
    default:
      return {
        text: renderTxt(msgs, userMap, maxTokens, renderOpts),
        ext: 'txt',
      };
  }
}

// Strip path separators, Windows-reserved and control characters, leading dots,
// and trailing dots/spaces from a base filename so downloads can't escape paths
// or produce invalid names. (\x00-\x1f spells the ASCII control range without a
// literal \u escape, which the editor's JSON layer mangles into a NUL byte.)
export function safeFilename(name) {
  return (
    String(name)
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '')
      .slice(0, 120) || 'export'
  );
}

export function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
