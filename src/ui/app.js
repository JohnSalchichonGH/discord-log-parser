// UI controller. Holds the remaining legacy DOM wiring: the wizard buttons, the
// Export-step controls (panel4), and the Output Preview (Transcript) card with
// its copy/download handlers. The Upload/Configure/Review analytics + the
// Summary/Technical cards are Preact-rendered (ui/views/**, ui/analytics-host.js);
// parsing/processing/rendering live in the tested modules under src/.

import { escHtml } from '../core/format.js';
import { chunkMessages } from '../core/chunking.js';
import { renderTxt } from '../render/txt.js';
import { renderJSON } from '../render/json.js';
import { renderMarkdown } from '../render/markdown.js';
import { renderCSV } from '../render/csv.js';
import { renderHTML } from '../render/html.js';
import { countTokens } from '../core/token-config.js';
import {
  exportFormat,
  goal,
  loadedFiles,
  processedOutputs,
  processResult,
} from './store.js';
import { settings, snapshotSettings, applySavedSettings } from './settings.js';
import { runProcessing } from './processing.js';
import { configureNav, goToStep } from './nav.js';
import { effect, untracked } from '@preact/signals';

/* STATE — loadedFiles, the processed outputs/result, and the analytics context
   all live in the signals store (ui/store.js); ui/processing.js runs the pipeline
   and writes them. The Review analytics are owned by ui/analytics-host.js and the
   Preact Summary/Technical cards; this controller only renders the (still-legacy)
   Output Preview + handles copy/download from those signals. */

/* DOM REFS */
const $ = (id) => document.getElementById(id);

/* SETTINGS PERSISTENCE — state lives in the signals store (ui/settings.js) and
   the Configure controls (ui/views/Configure.jsx) render from it. Restore the
   persisted store, then run the load-time side effects the still-legacy Export
   controls (panel4) need. */
function restoreSettings() {
  const s = applySavedSettings();
  exportFormat.value = $('outputFormat').value; // keep the store in sync
  $('chunkOptions').style.display = s.chunkOutput ? 'block' : 'none';
}

/* WIZARD NAVIGATION — the step signal + goToStep live in ui/nav.js (rendered by
   the Preact stepper). Inject this controller's two dependencies. */
configureNav({
  canAdvance: () => loadedFiles.value.length > 0,
  onEnterReview: () => runProcessing(),
});

// Enable "Continue" once at least one valid file is loaded (the Upload step's
// file list is rendered by Preact; this button stays legacy DOM for now).
effect(() => {
  const valid = loadedFiles.value.filter((f) => !f.invalid);
  const btn = $('toStep2');
  if (btn) btn.disabled = valid.length === 0;
});

$('toStep2').addEventListener('click', () => goToStep(2));
$('toStep3').addEventListener('click', () => {
  snapshotSettings(); // capture + persist current settings
  goToStep(3);
});
$('toStep4').addEventListener('click', () => goToStep(4));
$('backTo1').addEventListener('click', () => goToStep(1));
$('backTo2').addEventListener('click', () => goToStep(2));
$('backTo3').addEventListener('click', () => goToStep(3));

/* EXPORT-STEP WIRING — panel4 controls are still legacy DOM (the Configure
   controls moved to the Preact form bound to the settings store). */
$('chunkOutput').addEventListener('change', function () {
  $('chunkOptions').style.display = this.checked ? 'block' : 'none';
});

// Mirror the selected output format into the store so the Preact export
// confirmation can name it.
exportFormat.value = $('outputFormat').value;
$('outputFormat').addEventListener('change', function () {
  exportFormat.value = this.value;
});

// The output goal (Configure step) collapses the AI/token settings that don't
// apply (styles.css hides .ai-setting via #panel2[data-goal]) and pre-selects a
// matching export format. 'custom' shows everything.
const GOAL_FORMAT = { complete: 'html', compact: 'txt', data: 'json' };
effect(() => {
  const g = goal.value;
  const panel = $('panel2');
  if (panel) panel.dataset.goal = g;
  const fmt = GOAL_FORMAT[g];
  const sel = $('outputFormat');
  if (fmt && sel && sel.value !== fmt) {
    sel.value = fmt;
    exportFormat.value = fmt;
  }
});

// Enable "Continue to Export" once a run has produced a result — including an
// empty one (the user may still want to inspect/export nothing). processResult
// is reset to null while a run is in flight and stays null if the run threw, so
// it's disabled in exactly those two cases (matching the legacy behavior).
effect(() => {
  const btn = $('toStep4');
  if (btn) btn.disabled = processResult.value === null;
});

/* LEGACY OUTPUT PREVIEW (Transcript tab) — ui/processing.js writes
   processedOutputs/processResult; this reflects the preview onto the still-legacy
   preview card (the Summary/Technical/insights cards moved to Preact in Phase 6).
   processResult is null while a run is in flight, which hides the card. Only
   processedOutputs is tracked — the rest runs untracked so a later settings
   change (renderPreview reads settings.value) can't re-trigger it. */
effect(() => {
  processedOutputs.value; // the trigger
  untracked(() => {
    const outputs = processedOutputs.value;
    const result = processResult.value;
    if (!result || outputs.length === 0) {
      $('previewCard').style.display = 'none';
      return;
    }
    // B6: let the user preview/copy any channel group, not just the first.
    const sel = $('previewGroup');
    sel.innerHTML = outputs
      .map((po, i) => `<option value="${i}">${escHtml(po.name)}</option>`)
      .join('');
    sel.style.display = outputs.length > 1 ? '' : 'none';
    sel.value = '0';
    renderPreview(0);
    $('previewCard').style.display = 'block';
  });
});

// Render the live preview for one processed channel group (B6).
function renderPreview(idx) {
  const po = processedOutputs.value[idx];
  if (!po) return;
  const cfg = snapshotSettings();
  const maxTokens = Math.max(1000, parseInt(cfg.maxTokens) || 1375000);
  const renderOpts = {
    preamble: cfg.preamble,
    redactNames: cfg.redactNames,
    redactUrls: cfg.redactUrls,
    redactEmails: cfg.redactEmails,
  };
  const previewText = renderTxt(
    po.finalChunks,
    po.userMap,
    maxTokens,
    renderOpts,
  );
  const lines = previewText.split('\n');
  const maxPreviewLines = 300;
  $('previewContent').textContent =
    lines.length > maxPreviewLines
      ? lines.slice(0, maxPreviewLines).join('\n') +
        `\n\n… (${lines.length - maxPreviewLines} more lines)`
      : previewText;
  const chars = previewText.length;
  const estTokens = countTokens(previewText);
  const tokenLabel = settings.value.useAccurateTokens ? '' : '~';
  $('previewInfo').textContent =
    `${lines.length} lines · ${chars.toLocaleString()} chars · ${tokenLabel}${estTokens.toLocaleString()} tokens`;
}
$('previewGroup').addEventListener('change', function () {
  renderPreview(parseInt(this.value) || 0);
});

/* COPY PREVIEW */
$('copyPreview').addEventListener('click', () => {
  const outputs = processedOutputs.value;
  if (outputs.length === 0) return;
  const idx = parseInt($('previewGroup').value) || 0;
  const po = outputs[idx] || outputs[0];
  const cfg = snapshotSettings();
  const maxTokens = Math.max(1000, parseInt(cfg.maxTokens) || 1375000);
  const renderOpts = {
    preamble: cfg.preamble,
    redactNames: cfg.redactNames,
    redactUrls: cfg.redactUrls,
    redactEmails: cfg.redactEmails,
  };
  const text = renderTxt(po.finalChunks, po.userMap, maxTokens, renderOpts);
  navigator.clipboard.writeText(text).then(() => {
    const btn = $('copyPreview');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy all'), 1500);
  });
});

/* DOWNLOAD */
$('downloadBtn').addEventListener('click', () => {
  const outputs = processedOutputs.value;
  if (outputs.length === 0) return;
  const cfg = snapshotSettings();
  const format = cfg.outputFormat;
  const maxTokens = Math.max(1000, parseInt(cfg.maxTokens) || 1375000);
  const doChunk = cfg.chunkOutput;
  const overlap = parseInt(cfg.chunkOverlap) || 500;
  const renderOpts = {
    preamble: cfg.preamble,
    redactNames: cfg.redactNames,
    redactUrls: cfg.redactUrls,
    redactEmails: cfg.redactEmails,
  };

  let dlCount = 0;

  for (const po of outputs) {
    if (doChunk) {
      const chunks = chunkMessages(po.finalChunks, maxTokens, overlap);
      chunks.forEach((chunkMsgs, i) => {
        let text, ext;
        switch (format) {
          case 'json':
            text = renderJSON(chunkMsgs, po.userMap, renderOpts);
            ext = 'json';
            break;
          case 'md':
            text = renderMarkdown(chunkMsgs, po.userMap, maxTokens, renderOpts);
            ext = 'md';
            break;
          case 'csv':
            text = renderCSV(chunkMsgs, po.userMap, renderOpts);
            ext = 'csv';
            break;
          case 'html':
            text = renderHTML(chunkMsgs, po.userMap, maxTokens, renderOpts);
            ext = 'html';
            break;
          default:
            text = renderTxt(chunkMsgs, po.userMap, maxTokens, renderOpts);
            ext = 'txt';
            break;
        }
        setTimeout(
          () =>
            downloadFile(text, `${safeFilename(po.name)}_chunk${i + 1}.${ext}`),
          dlCount * 400,
        );
        dlCount++;
      });
    } else {
      let text, ext;
      switch (format) {
        case 'json':
          text = renderJSON(po.finalChunks, po.userMap, renderOpts);
          ext = 'json';
          break;
        case 'md':
          text = renderMarkdown(
            po.finalChunks,
            po.userMap,
            maxTokens,
            renderOpts,
          );
          ext = 'md';
          break;
        case 'csv':
          text = renderCSV(po.finalChunks, po.userMap, renderOpts);
          ext = 'csv';
          break;
        case 'html':
          text = renderHTML(po.finalChunks, po.userMap, maxTokens, renderOpts);
          ext = 'html';
          break;
        default:
          text = renderTxt(po.finalChunks, po.userMap, maxTokens, renderOpts);
          ext = 'txt';
          break;
      }
      setTimeout(
        () => downloadFile(text, `${safeFilename(po.name)}_processed.${ext}`),
        dlCount * 400,
      );
      dlCount++;
    }
  }

  $('downloadStatus').textContent = `${dlCount} file(s) downloading…`;
  $('downloadStatus').className = 'status-bar success';
});

/* UTILITIES */
// Strip path separators, Windows-reserved and control characters, leading dots,
// and trailing dots/spaces from a base filename so downloads can't escape paths
// or produce invalid names.
function safeFilename(name) {
  return (
    String(name)
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '')
      .slice(0, 120) || 'export'
  );
}

function downloadFile(content, filename) {
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

// Restore saved settings on init
restoreSettings();
