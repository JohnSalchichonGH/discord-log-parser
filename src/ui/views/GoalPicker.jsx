// "What are you making?" — the top of the Configure step. Picking a goal
// collapses the AI/token settings that don't apply (app.js reads `goal` and
// toggles panel2[data-goal]) and pre-selects a matching export format. 'Custom'
// keeps everything visible — the legacy behavior — so nothing is ever removed.

import { goal } from '../store.js';

const GOALS = [
  {
    id: 'complete',
    label: 'Complete transcript',
    desc: 'A readable HTML archive with every message. Best for reading, sharing, and keeping.',
  },
  {
    id: 'compact',
    label: 'Compact text',
    desc: 'Token-budgeted text for AI and long-context analysis.',
  },
  {
    id: 'data',
    label: 'Data export',
    desc: 'Structured JSON or CSV for spreadsheets and custom processing.',
  },
  {
    id: 'custom',
    label: 'Custom',
    desc: 'Show every setting and choose it all yourself.',
  },
];

export function GoalPicker() {
  const active = goal.value;
  return (
    <div class="goal-picker">
      <div class="goal-picker-q">What are you making?</div>
      <div
        class="goal-grid"
        role="radiogroup"
        aria-label="What are you making?"
      >
        {GOALS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={active === g.id ? 'true' : 'false'}
            class="goal-card"
            data-active={active === g.id ? 'true' : 'false'}
            onClick={() => (goal.value = g.id)}
          >
            <span class="goal-card-label">{g.label}</span>
            <span class="goal-card-desc">{g.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
