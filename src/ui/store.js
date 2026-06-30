// Central reactive store (signals). The single source of truth for UI state,
// replacing the legacy "DOM is the state" approach in app.js. Grown
// incrementally as views migrate to Preact:
//   - theme            (here now; was app.js initTheme/toggleTheme)
//   - settings         (Phase 3, with the Configure UI)
//   - files / route / processing / outputs (later phases)

import { signal, effect } from '@preact/signals';

/* UPLOAD STATE — the uploaded files and the per-author bot/selection state, moved
   out of app.js so the Preact Upload step + user filter render from them and the
   processing pipeline reads them instead of the DOM.
   - loadedFiles: { name, content, isTxt, isJson, channelId, baseName, sortOrder,
                    afterDate, size, invalid, error } — all dropped/picked files.
   - botUsers / selectedUsers: author-name Sets (replaced wholesale on change so
     the signals stay reactive). selectedUsers backs the user-filter checkboxes.
   - authorEntries: [name, count][] from parsing the valid files (off-thread when
     the worker is up), sorted desc; the user filter renders from it. */
export const loadedFiles = signal([]);
export const botUsers = signal(new Set());
export const selectedUsers = signal(new Set());
export const authorEntries = signal([]);

/* PARSE SUMMARY — what the upload step found, so the user gets immediate "it
   understood my files" confidence. Null when no files are loaded. Shape:
   { messages, participants, files, channels }. Counts are raw (pre-dedup);
   the deduplicated totals surface later in the Review step. Set by app.js once
   the worker has parsed the uploads. */
export const parseSummary = signal(null);

/* EXPORT SUMMARY — set after processing so the Export step can state, up front,
   whether the output is complete or trimmed and how many messages it includes
   (the review's "biggest UX risk": don't let trimming be a silent surprise).
   Null until a run has produced outputs. Shape: { kept, total, budgetExceeded }. */
export const exportSummary = signal(null);

/* The currently selected output format, mirrored from the format <select> so the
   export confirmation can name it. */
export const exportFormat = signal('txt');

/* OUTPUT GOAL — "What are you making?" Drives which settings the Configure step
   shows (the AI/token controls collapse unless you're making compact text) and
   the default export format. 'custom' shows everything (the legacy behavior), so
   it's the safe default. */
export const goal = signal('custom');

/* EXPLORE TAB — which analytics view is shown on the Review step. The cards
   already exist in the DOM; app.js reflects this onto panel3[data-explore-tab]
   and CSS shows just the active one. */
export const exploreTab = signal('summary');

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
