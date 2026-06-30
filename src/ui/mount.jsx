// Mounts the Preact-rendered parts of the shell. Grows as views migrate off the
// legacy app.js controller; for now it owns the header (+ theme toggle).

import { render } from 'preact';
import { Header } from './views/Header.jsx';
import { ParseSummary } from './views/ParseSummary.jsx';
import { ExportSummary } from './views/ExportSummary.jsx';
import { GoalPicker } from './views/GoalPicker.jsx';
import { ExploreTabs } from './views/ExploreTabs.jsx';
import { WizardSteps } from './views/WizardSteps.jsx';
import { Configure } from './views/Configure.jsx';
import { initUserFilter } from './app.js';

const headerHost = document.getElementById('app-header');
if (headerHost) render(<Header />, headerHost);

const wizardHost = document.getElementById('wizardNav');
if (wizardHost) render(<WizardSteps />, wizardHost);

const summaryHost = document.getElementById('parse-summary');
if (summaryHost) render(<ParseSummary />, summaryHost);

const exportHost = document.getElementById('export-summary');
if (exportHost) render(<ExportSummary />, exportHost);

const goalHost = document.getElementById('goal-picker');
if (goalHost) render(<GoalPicker />, goalHost);

const exploreHost = document.getElementById('explore-tabs');
if (exploreHost) render(<ExploreTabs />, exploreHost);

// Configure step. After it mounts (its user-filter island now exists in the
// DOM), let app.js wire the user-filter controls it still owns.
const configureHost = document.getElementById('configure-form');
if (configureHost) {
  render(<Configure />, configureHost);
  initUserFilter();
}
