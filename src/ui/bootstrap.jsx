// App bootstrap — the thin wiring that replaced the old app.js controller once
// every step moved to Preact. It injects the wizard-nav dependencies, restores
// persisted settings, mounts <App> into #app, and starts the analytics host that
// drives the imperative chart renderers. Everything else lives in the views +
// store.

import { render } from 'preact';
import { effect, untracked } from '@preact/signals';
import { App } from './App.jsx';
import { configureNav } from './nav.js';
import { runProcessing } from './processing.js';
import { applySavedSettings, getSetting, setSetting } from './settings.js';
import { goal, loadedFiles, exportFormat } from './store.js';
import { initAnalyticsHost } from './analytics-host.js';

// Wizard navigation needs two app-specific dependencies: "do we have files yet?"
// (gates advancing past Upload) and "run processing on entering Review".
configureNav({
  canAdvance: () => loadedFiles.value.length > 0,
  onEnterReview: () => runProcessing(),
});

// Restore persisted settings into the store, then mirror the saved output format
// onto the export-confirmation signal.
const saved = applySavedSettings();
exportFormat.value = saved.outputFormat;

// Mount the Preact shell. App reads no signals, so this renders once; the
// reactive children subscribe to the store on their own.
render(<App />, document.getElementById('app'));

// The output goal collapses the AI/token settings that don't apply (styles.css
// hides .ai-setting via #panel2[data-goal]) and pre-selects a matching export
// format. Tracked on `goal` only — the format read/write runs untracked so a
// later manual format change in the Export step isn't reverted. Registered after
// mount so #panel2 exists for the first run.
const GOAL_FORMAT = { complete: 'html', compact: 'txt', data: 'json' };
effect(() => {
  const g = goal.value;
  const panel = document.getElementById('panel2');
  if (panel) panel.dataset.goal = g;
  untracked(() => {
    const fmt = GOAL_FORMAT[g];
    if (fmt && getSetting('outputFormat') !== fmt) {
      setSetting('outputFormat', fmt);
      exportFormat.value = fmt;
    }
  });
});

// Start the analytics host AFTER mount so every getElementById target the chart
// renderers wire (insightUserList, tzUtc, wrappedPoster, …) already exists.
initAnalyticsHost();
