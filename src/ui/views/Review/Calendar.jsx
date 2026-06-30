// Review → Calendar tab: a *static* host skeleton for the message-explorer
// renderer (ui/calendar.js). Like the Insights host, it renders the legacy id
// holes (calGrid, dayView, …) once and never re-renders; analytics-host.js calls
// loadCalendar/setCalendarTz to populate and re-bucket it imperatively. Starts
// hidden — analytics-host reveals it only when there are messages to explore.

export function Calendar() {
  return (
    <div
      class="panel-card"
      id="messageExplorerCard"
      data-explore-panel="calendar"
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
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        Message explorer
      </div>
      <div class="card-desc">
        Pick a day to read the conversation. Click an hour to jump; scroll to
        load earlier and later messages.
      </div>
      <div class="explorer">
        <div class="explorer-cal">
          <div class="cal-nav">
            <button type="button" id="calPrev" aria-label="Previous month">
              ‹
            </button>
            <div id="calMonthLabel" />
            <button type="button" id="calNext" aria-label="Next month">
              ›
            </button>
          </div>
          <div id="calGrid" />
          <div class="cal-legend">
            <span>Less</span>
            <i style="--heat: 0.14" />
            <i style="--heat: 0.4" />
            <i style="--heat: 0.7" />
            <i style="--heat: 0.96" />
            <span>More</span>
          </div>
        </div>
        <div class="explorer-day">
          <div id="dayToolbar" class="day-toolbar" />
          <div id="dayView" class="day-view" />
        </div>
      </div>
    </div>
  );
}
