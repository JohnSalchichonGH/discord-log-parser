// Wizard navigation, extracted from app.js. The current step lives in a signal
// (so the Preact stepper renders reactively); `goToStep` keeps the original
// guards. The two app-specific dependencies — "do we have files yet?" and "run
// processing on entering Review" — are injected via configureNav so this module
// doesn't depend on the legacy controller.

import { signal, effect } from '@preact/signals';

export const step = signal(1);

let canAdvance = () => false;
let onEnterReview = () => {};

export function configureNav(opts) {
  if (opts.canAdvance) canAdvance = opts.canAdvance;
  if (opts.onEnterReview) onEnterReview = opts.onEnterReview;
}

export function goToStep(n) {
  if (n < 1 || n > 4) return;
  if (n > 1 && !canAdvance()) return; // need at least one file
  if (n > step.value + 1) return; // can't skip forward
  step.value = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (n === 3) onEnterReview();
}

// Drive the legacy panels' visibility from the step signal (the panels are still
// plain DOM in index.html).
effect(() => {
  const n = step.value;
  for (let i = 1; i <= 4; i++) {
    const p = document.getElementById('panel' + i);
    if (p) p.classList.toggle('active', i === n);
  }
});
