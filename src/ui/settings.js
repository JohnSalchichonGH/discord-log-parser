// Settings state + persistence.
//
// The settings store is the SOURCE OF TRUTH for the whole wizard: the Preact
// <Configure> and <Export> controls read their values from `settings` and write
// back with `setSetting()`. An effect persists the store to localStorage and
// `applySavedSettings()` restores it on load. The processing/export code reads
// the snapshot object instead of scattered getElementById calls.

import { signal, effect } from '@preact/signals';

// Default values for every setting (mirrors the controls' initial values).
// Strings where the control yields a string (number inputs read as `.value`),
// booleans for toggles — so `parseInt`/truthiness downstream behave as before.
export const DEFAULTS = {
  maxTokens: '1375000',
  modelPreset: '1375000',
  filterLowActivity: false,
  minMessages: '10',
  filterBots: false,
  filterSystem: false,
  filterMediaOnly: false,
  redactNames: false,
  useRealNames: false,
  redactUrls: false,
  redactEmails: false,
  outputFormat: 'txt',
  chunkOutput: false,
  chunkOverlap: '500',
  useAccurateTokens: false,
  keywords: '',
  preamble: '',
  dateFrom: '',
  dateTo: '',
};

const STORAGE_KEY = 'dlp-settings';

// The reactive settings store. Empty until applySavedSettings()/snapshot runs;
// the persist effect skips the empty object so it can't clobber saved values
// before they're read on load.
export const settings = signal({});

// Read a single setting, falling back to its default — so Configure controls
// render correctly even before settings are loaded (e.g. in isolation tests).
export function getSetting(key) {
  const v = settings.value[key];
  return v === undefined ? DEFAULTS[key] : v;
}

// Update one setting (the Configure controls' onChange).
export function setSetting(key, value) {
  settings.value = { ...settings.value, [key]: value };
}

// Return the current settings merged over the defaults. The processing/export
// pipeline reads this.
export function snapshotSettings() {
  const s = { ...DEFAULTS, ...settings.value };
  settings.value = s;
  return s;
}

// Load persisted values (over the defaults) into the store. Returns the merged
// settings so the caller can seed any signals mirrored from them.
export function applySavedSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    /* corrupt or unavailable storage */
  }
  const merged = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (k in saved && saved[k] != null) merged[k] = saved[k];
  }
  settings.value = merged;
  return merged;
}

// Persist whenever the store changes (skips the initial empty object).
effect(() => {
  const v = settings.value;
  if (Object.keys(v).length === 0) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage may be unavailable (private mode) */
  }
});
