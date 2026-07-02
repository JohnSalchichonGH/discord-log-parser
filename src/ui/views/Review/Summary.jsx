// Review → Summary tab: the headline stat cards + per-user message leaderboard.
// Reactive Preact, reading the run totals (processResult) and the processed
// outputs (processedOutputs) from the store — replacing the legacy renderStats
// half that lived in app.js. Renders nothing until a run has produced a result
// (which keeps the card hidden, matching the old display:none behavior). The
// `id`/`data-explore-panel` are preserved so the Explore-tab CSS still reveals it.

import { processResult, processedOutputs } from '../../store.js';
import { BAR_COLORS, flattenOutputs, userCounts } from './stats.js';

const dateFmt = (ts) =>
  ts.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function Summary() {
  const result = processResult.value;
  if (!result) return null;
  const { totalMessages, totalKept } = result;
  const { chunks, userMap } = flattenOutputs(processedOutputs.value);
  const nameOf = (uid) => userMap.get(uid) || uid;

  const dateRange =
    chunks.length > 0
      ? `${dateFmt(chunks[0].timestamp)} — ${dateFmt(chunks[chunks.length - 1].timestamp)}`
      : 'N/A';
  const uniqueUsers = new Set(chunks.map((c) => c.authorId)).size;
  const avgLen =
    chunks.length > 0
      ? Math.round(
          chunks.reduce((s, c) => s + c.contentParts.join(' ').length, 0) /
            chunks.length,
        )
      : 0;

  const sorted = userCounts(chunks);
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;
  const topN = sorted.slice(0, 15);

  return (
    <div class="panel-card" id="statsCard" data-explore-panel="summary">
      <div class="card-title">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
        Statistics
      </div>
      <div class="stats-grid" id="statsGrid">
        <div class="stat-card">
          <div class="stat-value">{totalMessages.toLocaleString()}</div>
          <div class="stat-label">Total msgs</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{totalKept.toLocaleString()}</div>
          <div class="stat-label">Kept</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{uniqueUsers}</div>
          <div class="stat-label">Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{avgLen}</div>
          <div class="stat-label">Avg chars/msg</div>
        </div>
        <div class="stat-card" style="grid-column: span 2;">
          <div class="stat-value" style="font-size:15px;">
            {dateRange}
          </div>
          <div class="stat-label">Date range</div>
        </div>
      </div>
      <div id="userChart">
        {topN.map(([uid, count], i) => {
          const pct = Math.max(2, (count / maxCount) * 100);
          const color = BAR_COLORS[i % BAR_COLORS.length];
          return (
            <div class="chart-bar-row" key={uid}>
              <span class="chart-bar-label" title={nameOf(uid)}>
                {nameOf(uid)}
              </span>
              <div class="chart-bar-track">
                <div
                  class="chart-bar-fill"
                  style={`width:${pct}%;background:${color};`}
                >
                  {count}
                </div>
              </div>
            </div>
          );
        })}
        {sorted.length > 15 && (
          <div style="text-align:center;font-size:12px;color:var(--text-muted);margin-top:6px;">
            +{sorted.length - 15} more users
          </div>
        )}
      </div>
    </div>
  );
}
