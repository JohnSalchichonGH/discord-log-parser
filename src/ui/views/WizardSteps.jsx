// The four-step wizard nav, rendered reactively from the step signal. A
// completed step (before the current one) is clickable to go back; the forward
// path is via the panels' Continue buttons (which call goToStep). Replaces the
// static .wizard-step buttons that app.js used to toggle by hand.

import { step, goToStep } from '../nav.js';

const STEPS = [
  { n: 1, label: 'Upload' },
  { n: 2, label: 'Configure' },
  { n: 3, label: 'Review' },
  { n: 4, label: 'Export' },
];

export function WizardSteps() {
  const cur = step.value;
  return (
    <>
      {STEPS.map(({ n, label }) => {
        const state = n === cur ? 'active' : n < cur ? 'completed' : '';
        return (
          <button
            key={n}
            type="button"
            class={`wizard-step ${state}`.trim()}
            data-step={n}
            aria-current={n === cur ? 'step' : undefined}
            onClick={() => {
              if (n < cur) goToStep(n);
            }}
          >
            <span class="step-num">{n}</span>
            <span class="step-label">{label}</span>
          </button>
        );
      })}
    </>
  );
}
