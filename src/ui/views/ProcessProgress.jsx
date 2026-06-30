// Processing progress bar + status line for the Review step, bound to the
// `processing` signal that ui/processing.js writes. Replaces the legacy
// #processProgress / #processStatus DOM the controller used to poke directly.

import { processing } from '../store.js';

// The thin bar at the top of the Review panel — visible (and animating its
// fill width) only while a run is active.
export function ProcessProgress() {
  const p = processing.value;
  return (
    <div class={'progress-bar' + (p.active ? ' active' : '')}>
      <div class="progress-fill" style={{ width: p.pct + '%' }} />
    </div>
  );
}

// The status line at the bottom of the Review panel. `kind` maps to the
// status-bar success/error classes; `data-engine` keeps the worker/inline
// diagnostic the old code exposed on the element.
export function ProcessStatus() {
  const p = processing.value;
  return (
    <div
      class={'status-bar' + (p.kind ? ' ' + p.kind : '')}
      role="status"
      aria-live="polite"
      data-engine={p.engine || undefined}
    >
      {p.status}
    </div>
  );
}
