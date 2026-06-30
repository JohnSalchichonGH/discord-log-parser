// PHASE 0 SPIKE — throwaway. Proves Preact JSX + @preact/signals compile,
// bundle into the single file, and run under the strict (no-eval) CSP without
// disturbing the existing app. Removed once the real shell lands.

import { render } from 'preact';
import { signal, computed } from '@preact/signals';

const n = signal(40);
const doubled = computed(() => n.value * 2);

function Spike() {
  return <span data-spike="ok">{doubled.value}</span>;
}

const host = document.createElement('div');
host.id = '_preact_spike';
host.style.display = 'none';
document.body.appendChild(host);
render(<Spike />, host);

// Expose for verification (preview_eval).
window.__spike = { mounted: true, value: () => host.textContent };
