// Review → Transcript tab: the live Output Preview. Reactive Preact, reading the
// processed outputs from the store and rendering the selected channel group as
// compact text (B6: any group, not just the first). Replaces the legacy
// previewCard markup + renderPreview/copyPreview handlers that lived in app.js.
// The id/data-explore-panel are preserved so the Explore-tab CSS still reveals
// it; the card stays hidden until a run has produced outputs.

import { useState } from 'preact/hooks';
import { processResult, processedOutputs } from '../../store.js';
import { getSetting } from '../../settings.js';
import { exportConfig } from '../../download.js';
import { renderTxt } from '../../../render/txt.js';
import { countTokens } from '../../../core/token-config.js';

const MAX_PREVIEW_LINES = 300;

export function Transcript() {
  const result = processResult.value;
  const outputs = processedOutputs.value;
  // Selected channel group; clamped below so a reprocess that drops groups can't
  // leave a stale out-of-range index.
  const [sel, setSel] = useState(0);
  const [copyLabel, setCopyLabel] = useState('Copy all');

  if (!result || outputs.length === 0) return null;

  const idx = sel < outputs.length ? sel : 0;
  const po = outputs[idx];
  // Read settings reactively (without mutating the store — calling the persisting
  // snapshot during render would loop), so the preview re-renders live as the
  // redaction/budget settings change.
  const cfg = {
    maxTokens: getSetting('maxTokens'),
    preamble: getSetting('preamble'),
    redactNames: getSetting('redactNames'),
    redactUrls: getSetting('redactUrls'),
    redactEmails: getSetting('redactEmails'),
    useAccurateTokens: getSetting('useAccurateTokens'),
  };
  const { maxTokens, renderOpts } = exportConfig(cfg);
  const previewText = renderTxt(
    po.finalChunks,
    po.userMap,
    maxTokens,
    renderOpts,
  );

  const lines = previewText.split('\n');
  const shown =
    lines.length > MAX_PREVIEW_LINES
      ? lines.slice(0, MAX_PREVIEW_LINES).join('\n') +
        `\n\n… (${lines.length - MAX_PREVIEW_LINES} more lines)`
      : previewText;

  const tokenLabel = cfg.useAccurateTokens ? '' : '~';
  const info = `${lines.length} lines · ${previewText.length.toLocaleString()} chars · ${tokenLabel}${countTokens(previewText).toLocaleString()} tokens`;

  const onCopy = () => {
    navigator.clipboard.writeText(previewText).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy all'), 1500);
    });
  };

  return (
    <div class="panel-card" id="previewCard" data-explore-panel="transcript">
      <div class="card-title">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        Output Preview
      </div>
      <div class="preview-container">
        <div class="preview-toolbar">
          <span class="preview-info" id="previewInfo">
            {info}
          </span>
          <div style="display: flex; gap: 8px; align-items: center">
            {outputs.length > 1 && (
              <select
                id="previewGroup"
                style="padding: 4px 8px; font-size: 12px; width: auto;"
                aria-label="Channel to preview"
                value={String(idx)}
                onChange={(e) => setSel(parseInt(e.currentTarget.value) || 0)}
              >
                {outputs.map((o, i) => (
                  <option value={String(i)} key={i}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <button
              class="btn btn-secondary"
              style="padding: 5px 12px; font-size: 12px"
              id="copyPreview"
              onClick={onCopy}
            >
              {copyLabel}
            </button>
          </div>
        </div>
        <div class="preview-scroll" id="previewScroll">
          <pre id="previewContent">{shown}</pre>
        </div>
      </div>
    </div>
  );
}
