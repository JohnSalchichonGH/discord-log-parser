// Review → Wrapped tab: a *static* host skeleton for the Wrapped recap renderer
// (ui/wrapped.js). It owns the #wrappedPoster hole + the Download-PNG button;
// analytics-host.js bakes the themed SVG into the poster (renderWrappedRecap) and
// wires the download (downloadWrappedPng). Renders once, never re-renders, so the
// imperative SVG survives. Starts hidden until there's a recap to show.

export function Wrapped() {
  return (
    <div
      class="panel-card"
      id="wrappedCard"
      data-explore-panel="wrapped"
      style="display: none"
    >
      <div class="card-title" style="justify-content: space-between">
        <span style="display: flex; align-items: center; gap: 10px">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21 8 14 2 9.4h7.6z" />
          </svg>
          Wrapped
        </span>
        <button
          class="btn btn-secondary"
          id="wrappedDownload"
          type="button"
          style="padding: 6px 12px; font-size: 12px"
        >
          ⬇ Download PNG
        </button>
      </div>
      <div class="card-desc">A shareable recap of this conversation.</div>
      <div id="wrappedPoster" class="wrapped-poster" />
    </div>
  );
}
