// Review → Technical tab: the per-user token-budget breakdown. Reactive Preact
// reading the processed outputs (processedOutputs) + the token budget from the
// settings store — the second half of the legacy renderStats. Re-renders when the
// budget changes (settings.value). The `id`/`data-explore-panel` are preserved so
// the Explore-tab CSS reveals it.

import { processResult, processedOutputs } from '../../store.js';
import { settings } from '../../settings.js';
import { flattenOutputs, userCounts } from './stats.js';
import { rankColor } from '../../colors.js';

// Characters a chunk contributes to the budget — the joined parts plus a small
// per-message overhead, matching the legacy estimate.
const chunkChars = (c) => c.contentParts.join('\n').length + 15;

export function Technical() {
  const result = processResult.value;
  if (!result) return null;
  const { chunks, userMap } = flattenOutputs(processedOutputs.value);
  const nameOf = (uid) => userMap.get(uid) || uid;

  const sorted = userCounts(chunks);
  const maxChars =
    Math.max(1, parseInt(settings.value.maxTokens) || 1375000) * 4;
  const totalChars = chunks.reduce((s, c) => s + chunkChars(c), 0);
  const usedPct = Math.round((totalChars / maxChars) * 100);

  const bars = sorted.slice(0, 10).map(([uid]) => ({
    uid,
    chars: chunks
      .filter((c) => c.authorId === uid)
      .reduce((s, c) => s + chunkChars(c), 0),
  }));

  return (
    <div class="panel-card" id="budgetCard" data-explore-panel="technical">
      <div class="card-title">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
        Token Budget Breakdown
      </div>
      <div id="budgetBars">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
          Budget used:{' '}
          <strong style="color:var(--text-primary);">{usedPct}%</strong> (~
          {Math.round(totalChars / 4).toLocaleString()} /{' '}
          {(maxChars / 4).toLocaleString()} tokens)
        </div>
        {bars.map((b, i) => {
          const pct = Math.max(1, (b.chars / maxChars) * 100);
          const color = rankColor(i);
          const tokens = Math.round(b.chars / 4);
          return (
            <div class="chart-bar-row" key={b.uid}>
              <span class="chart-bar-label" title={nameOf(b.uid)}>
                {nameOf(b.uid)}
              </span>
              <div class="chart-bar-track">
                <div
                  class="chart-bar-fill"
                  style={`width:${pct}%;background:${color};`}
                >
                  {tokens.toLocaleString()} tkn
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
