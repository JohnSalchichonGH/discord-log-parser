// "We understood your files" card on the Upload step. Renders the raw counts
// the worker found right after parsing, so the user gets immediate confidence
// before configuring anything. Hidden until files are loaded.

import { parseSummary } from '../store.js';
import { StatCard } from '../components/StatCard.jsx';

const fmt = (n) => n.toLocaleString();

export function ParseSummary() {
  const s = parseSummary.value;
  if (!s) return null;
  return (
    <div class="parse-summary">
      <div class="parse-summary-title">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
        Conversation found
      </div>
      <div class="parse-summary-grid">
        <StatCard value={fmt(s.messages)} label="messages" />
        <StatCard value={fmt(s.participants)} label="participants" />
        <StatCard
          value={fmt(s.files)}
          label={s.files === 1 ? 'file' : 'files'}
        />
        <StatCard
          value={fmt(s.channels)}
          label={s.channels === 1 ? 'channel' : 'channels'}
        />
      </div>
    </div>
  );
}
