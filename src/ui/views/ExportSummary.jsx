// Export-step confirmation. States plainly whether the export is complete or
// trimmed and how many messages it includes, so trimming is never a silent
// surprise. Reactive to the processed result + the selected format.

import { exportSummary, exportFormat } from '../store.js';

const FORMAT_LABEL = {
  txt: 'Compact TXT',
  json: 'JSON',
  md: 'Markdown',
  csv: 'CSV',
  html: 'HTML transcript',
};

const fmt = (n) => n.toLocaleString();

export function ExportSummary() {
  const s = exportSummary.value;
  if (!s) return null;
  const complete = s.kept >= s.total && !s.budgetExceeded;
  const excluded = Math.max(0, s.total - s.kept);
  return (
    <div class={`export-summary ${complete ? 'is-complete' : 'is-trimmed'}`}>
      <div class="export-summary-head">
        <span class="export-summary-mode">
          {complete ? 'Complete transcript' : 'Trimmed to fit'}
        </span>
        <span class="export-summary-fmt">
          {FORMAT_LABEL[exportFormat.value] || exportFormat.value}
        </span>
      </div>
      <div class="export-summary-detail">
        {complete ? (
          <>
            All <strong>{fmt(s.total)}</strong> messages are included.
          </>
        ) : s.budgetExceeded ? (
          <>
            Keyword-priority messages alone exceed the token budget, so all{' '}
            <strong>{fmt(s.kept)}</strong> kept messages are included and the
            output runs larger than the limit.
          </>
        ) : (
          <>
            <strong>{fmt(s.kept)}</strong> of <strong>{fmt(s.total)}</strong>{' '}
            messages are included — <strong>{fmt(excluded)}</strong> were
            excluded by your filters or the token budget.
          </>
        )}
      </div>
    </div>
  );
}
