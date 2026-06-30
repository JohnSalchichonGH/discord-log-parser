// Central reactive store (signals). The single source of truth for UI state,
// replacing the legacy "DOM is the state" approach in app.js. Grown
// incrementally as views migrate to Preact:
//   - theme            (here now; was app.js initTheme/toggleTheme)
//   - settings         (Phase 3, with the Configure UI)
//   - files / route / processing / outputs (later phases)

import { signal, effect } from '@preact/signals';

/* THEME — persisted to localStorage; the effect keeps <html data-theme> and
   storage in sync whenever the signal changes. */
function readTheme() {
  try {
    return localStorage.getItem('dlp-theme');
  } catch {
    return null;
  }
}

export const theme = signal(readTheme() || 'dark');

effect(() => {
  document.documentElement.setAttribute('data-theme', theme.value);
  try {
    localStorage.setItem('dlp-theme', theme.value);
  } catch {
    /* storage may be unavailable (private mode) */
  }
});

export function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
}
