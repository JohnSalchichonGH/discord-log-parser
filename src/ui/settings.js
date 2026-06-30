// Settings state + persistence, extracted from app.js's saveSettings/loadSettings.
//
// The Configure/Export inputs remain the interactive controls, but their values
// now live in a signals-backed `settings` store: `snapshotSettings()` reads the
// DOM fresh into the store (so it captures programmatic changes too, exactly like
// the old saveSettings), an effect persists the store to localStorage, and
// `applySavedSettings()` restores it on load. The processing/export code reads
// the snapshot object instead of scattered getElementById calls.

import { signal, effect } from '@preact/signals';

const $ = (id) => document.getElementById(id);

// [ domId, storeKey, 'value' | 'checked' ]. storeKey differs from domId only for
// keywords/preamble.
const FIELDS = [
  ['maxTokens', 'maxTokens', 'value'],
  ['modelPreset', 'modelPreset', 'value'],
  ['filterLowActivity', 'filterLowActivity', 'checked'],
  ['minMessages', 'minMessages', 'value'],
  ['filterBots', 'filterBots', 'checked'],
  ['filterSystem', 'filterSystem', 'checked'],
  ['filterMediaOnly', 'filterMediaOnly', 'checked'],
  ['redactNames', 'redactNames', 'checked'],
  ['useRealNames', 'useRealNames', 'checked'],
  ['redactUrls', 'redactUrls', 'checked'],
  ['redactEmails', 'redactEmails', 'checked'],
  ['outputFormat', 'outputFormat', 'value'],
  ['chunkOutput', 'chunkOutput', 'checked'],
  ['chunkOverlap', 'chunkOverlap', 'value'],
  ['useAccurateTokens', 'useAccurateTokens', 'checked'],
  ['keywordInput', 'keywords', 'value'],
  ['customPreamble', 'preamble', 'value'],
  ['dateFrom', 'dateFrom', 'value'],
  ['dateTo', 'dateTo', 'value'],
];

const STORAGE_KEY = 'dlp-settings';

// The reactive settings snapshot (storeKey -> value). Empty until first snapshot.
export const settings = signal({});

// Read every input's current value into the store and return it.
export function snapshotSettings() {
  const s = {};
  for (const [id, key, type] of FIELDS) {
    const el = $(id);
    if (el) s[key] = el[type];
  }
  settings.value = s;
  return s;
}

// Restore persisted values onto the inputs (where present), then snapshot so the
// store mirrors the DOM. Returns the snapshot.
export function applySavedSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    /* corrupt or unavailable storage */
  }
  for (const [id, key, type] of FIELDS) {
    const el = $(id);
    if (el && key in saved && saved[key] != null) el[type] = saved[key];
  }
  return snapshotSettings();
}

// Persist whenever the snapshot changes (skips the initial empty object).
effect(() => {
  const v = settings.value;
  if (Object.keys(v).length === 0) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage may be unavailable (private mode) */
  }
});
