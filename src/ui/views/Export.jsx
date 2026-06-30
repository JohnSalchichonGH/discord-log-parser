// The Export step (panel4): the complete-vs-trimmed confirmation, the output
// format + chunking controls (bound to the settings store), and the Download
// button. Replaces the legacy panel4 markup + the download handler in app.js;
// the format switch / filename sanitize / blob download live in ui/download.js.

import { exportFormat, processedOutputs, downloadStatus } from '../store.js';
import { getSetting, setSetting, snapshotSettings } from '../settings.js';
import { ExportSummary } from './ExportSummary.jsx';
import {
  exportConfig,
  renderOutput,
  safeFilename,
  downloadFile,
} from '../download.js';
import { chunkMessages } from '../../core/chunking.js';

const FORMATS = [
  { value: 'txt', label: 'Compact TXT (LLM-optimized)' },
  { value: 'json', label: 'JSON (structured data)' },
  { value: 'md', label: 'Markdown' },
  { value: 'csv', label: 'CSV' },
  { value: 'html', label: 'HTML (readable transcript)' },
];

// Stream the processed outputs to disk in the chosen format. Downloads are
// spaced out (the browser blocks a burst of programmatic clicks) and chunked
// when requested. Returns the file count for the status line.
function downloadAll() {
  const outputs = processedOutputs.value;
  if (outputs.length === 0) return 0;
  const cfg = snapshotSettings();
  const format = cfg.outputFormat;
  const { maxTokens, renderOpts } = exportConfig(cfg);
  const doChunk = cfg.chunkOutput;
  const overlap = parseInt(cfg.chunkOverlap) || 500;

  let dlCount = 0;
  for (const po of outputs) {
    if (doChunk) {
      const chunks = chunkMessages(po.finalChunks, maxTokens, overlap);
      chunks.forEach((chunkMsgs, i) => {
        const { text, ext } = renderOutput(
          format,
          chunkMsgs,
          po.userMap,
          maxTokens,
          renderOpts,
        );
        const delay = dlCount * 400;
        setTimeout(
          () =>
            downloadFile(text, `${safeFilename(po.name)}_chunk${i + 1}.${ext}`),
          delay,
        );
        dlCount++;
      });
    } else {
      const { text, ext } = renderOutput(
        format,
        po.finalChunks,
        po.userMap,
        maxTokens,
        renderOpts,
      );
      const delay = dlCount * 400;
      setTimeout(
        () => downloadFile(text, `${safeFilename(po.name)}_processed.${ext}`),
        delay,
      );
      dlCount++;
    }
  }
  return dlCount;
}

export function Export() {
  const format = getSetting('outputFormat');
  const chunkOutput = getSetting('chunkOutput');

  const onFormat = (e) => {
    const v = e.currentTarget.value;
    setSetting('outputFormat', v);
    exportFormat.value = v; // the confirmation labels the format from here
  };

  const onDownload = () => {
    const n = downloadAll();
    downloadStatus.value = {
      text: `${n} file(s) downloading…`,
      kind: 'success',
    };
  };

  return (
    <div class="panel-card">
      <div class="card-title">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Export Options
      </div>

      <ExportSummary />

      <div class="form-group">
        <label class="form-label" for="outputFormat">
          Output format
        </label>
        <select id="outputFormat" value={format} onChange={onFormat}>
          {FORMATS.map((f) => (
            <option value={f.value} key={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <label class="toggle-row">
        <input
          type="checkbox"
          id="chunkOutput"
          checked={chunkOutput}
          onChange={(e) => setSetting('chunkOutput', e.currentTarget.checked)}
        />
        <span class="toggle-switch" />
        <span>
          <span class="toggle-label">Split into chunks</span>
          <span class="toggle-desc">
            For context windows smaller than your data
          </span>
        </span>
      </label>
      {chunkOutput && (
        <div id="chunkOptions" style="margin: 8px 0 14px 48px">
          <div class="form-group">
            <label class="form-label" for="chunkOverlap">
              Overlap (messages shared between chunks)
            </label>
            <input
              type="number"
              id="chunkOverlap"
              value={getSetting('chunkOverlap')}
              min="0"
              max="5000"
              class="inline-num"
              style="width: 100px !important"
              onInput={(e) => setSetting('chunkOverlap', e.currentTarget.value)}
            />
          </div>
        </div>
      )}

      <hr class="section-divider" />

      <div style="text-align: center; padding: 12px 0">
        <button
          class="btn btn-success"
          id="downloadBtn"
          style="font-size: 16px; padding: 14px 32px"
          onClick={onDownload}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </button>
      </div>
    </div>
  );
}
