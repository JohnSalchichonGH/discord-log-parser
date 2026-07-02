// Review → Insights tab: a *static* host skeleton for the imperative analytics
// renderers (ui/insights.js). It renders the card markup — including the legacy
// `insight*` id holes the renderers populate via innerHTML — exactly once and
// never re-renders (it reads no signals), so the renderer output is never wiped
// by Preact reconciliation. All of the wiring (tz toggle, the user-filter list,
// drill-down, and the actual chart rendering) lives in ui/analytics-host.js,
// which drives this skeleton imperatively after mount.
//
// The card starts hidden; analytics-host reveals it (display:block) once a run
// has analytics to show, matching the legacy behavior.

export function Insights() {
  return (
    <div
      class="panel-card"
      id="insightsCard"
      data-explore-panel="insights"
      style="display: none"
    >
      <div class="card-title">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </svg>
        Insights
      </div>
      <div class="card-desc">
        Every message in your filters — before the token-budget trim and the
        low-activity cutoff — so counts here can exceed the exported total.
      </div>

      <div
        class="form-row"
        style="justify-content: space-between; align-items: center"
      >
        <div style="display: flex; gap: 6px; align-items: center">
          <span class="form-label" style="margin: 0">
            Timezone
          </span>
          <button
            class="btn btn-primary"
            id="tzUtc"
            type="button"
            style="padding: 5px 12px; font-size: 12px"
          >
            UTC
          </button>
          <button
            class="btn btn-secondary"
            id="tzLocal"
            type="button"
            style="padding: 5px 12px; font-size: 12px"
          >
            Local
          </button>
        </div>
        <div
          class="collapsible-header"
          id="insightUserHeader"
          style="padding: 0"
        >
          <span class="arrow">▶</span> Filter users
        </div>
      </div>
      <div class="collapsible-body" id="insightUserBody">
        <div class="user-list" id="insightUserList" />
        <div class="user-actions">
          <a id="insightUserAll">Select all</a>
          <a id="insightUserNone">Clear all</a>
        </div>
      </div>

      <div class="stats-grid" id="insightMetrics" />

      <div style="margin-top: 8px">
        <div class="form-label">Messages over time</div>
        <div id="insightTimeline" />
      </div>

      <div style="margin-top: 14px">
        <div class="form-label">Activity by day and hour</div>
        <div id="insightHeatmap" style="overflow-x: auto" />
      </div>

      <div id="insightNetworkSection" style="margin-top: 14px">
        <div class="form-label">
          Reply network
          <span style="color: var(--text-muted); font-weight: 400">
            {' '}
            — scroll to zoom, drag to pan, click a participant to focus
            (double-click to reset)
          </span>
        </div>
        <div id="insightNetwork" />
        <div id="insightPartners" style="display: none" />
      </div>

      <div class="cols-2" style="margin-top: 14px">
        <div>
          <div class="form-label">Top participants</div>
          <div id="insightUsers" />
        </div>
        <div>
          <div class="form-label">Top reactions</div>
          <div id="insightReactions" />
          <div class="form-label" style="margin-top: 10px">
            Media
          </div>
          <div id="insightMedia" />
        </div>
      </div>
    </div>
  );
}
