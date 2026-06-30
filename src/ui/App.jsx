// The application shell, composed in Preact. Replaces the static markup that used
// to live in index.html: it renders the header, the wizard stepper, and the four
// step panels (Upload / Configure / Review / Export), each delegating to its
// view. App itself reads NO signals, so it renders exactly once — which is what
// keeps the Review step's static chart-host skeletons (driven imperatively by
// ui/analytics-host.js) from being wiped by a re-render. Every reactive piece is
// a child component reading its own store signals.
//
// Panel visibility (.panel.active), the goal→data-goal collapse, and the
// Explore-tab reveal stay imperative effects (ui/nav.js, ui/bootstrap.js,
// ui/analytics-host.js) that toggle classes/attributes on these stable DOM nodes
// — so navigation never forces this tree to reconcile.

import { Header } from './views/Header.jsx';
import { WizardSteps } from './views/WizardSteps.jsx';
import { Upload } from './views/Upload.jsx';
import { ParseSummary } from './views/ParseSummary.jsx';
import { GoalPicker } from './views/GoalPicker.jsx';
import { Configure } from './views/Configure.jsx';
import { ProcessProgress, ProcessStatus } from './views/ProcessProgress.jsx';
import { ExploreTabs } from './views/ExploreTabs.jsx';
import { ReviewPanels } from './views/Review/ReviewPanels.jsx';
import { Export } from './views/Export.jsx';
import { goToStep } from './nav.js';
import { snapshotSettings } from './settings.js';
import { loadedFiles, processResult, downloadStatus } from './store.js';

const ChevronRight = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ChevronLeft = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

// Upload → Configure. Enabled once at least one valid file is loaded.
function ContinueButton() {
  const valid = loadedFiles.value.filter((f) => !f.invalid);
  return (
    <button
      class="btn btn-primary"
      id="toStep2"
      disabled={valid.length === 0}
      onClick={() => goToStep(2)}
    >
      Continue
      <ChevronRight />
    </button>
  );
}

// Review → Export. Enabled once a run has produced a result (even an empty one);
// processResult is null while a run is in flight / on a throw, so it stays
// disabled in exactly those cases — matching the legacy behavior.
function ExportButton() {
  return (
    <button
      class="btn btn-primary"
      id="toStep4"
      disabled={processResult.value === null}
      onClick={() => goToStep(4)}
    >
      Export
      <ChevronRight />
    </button>
  );
}

function DownloadStatus() {
  const s = downloadStatus.value;
  return (
    <div
      class={'status-bar' + (s.kind ? ' ' + s.kind : '')}
      id="downloadStatus"
      role="status"
      aria-live="polite"
    >
      {s.text}
    </div>
  );
}

export function App() {
  return (
    <div class="app-shell">
      <Header />

      <nav class="wizard-steps" id="wizardNav" aria-label="Progress">
        <WizardSteps />
      </nav>

      {/* STEP 1: UPLOAD */}
      <section class="panel active" id="panel1">
        <Upload />
        <ParseSummary />
        <div class="btn-row">
          <div />
          <div class="btn-row-right">
            <ContinueButton />
          </div>
        </div>
      </section>

      {/* STEP 2: CONFIGURE */}
      <section class="panel" id="panel2">
        <GoalPicker />
        <Configure />
        <div class="btn-row">
          <button
            class="btn btn-secondary"
            id="backTo1"
            onClick={() => goToStep(1)}
          >
            <ChevronLeft />
            Back
          </button>
          <div class="btn-row-right">
            <button
              class="btn btn-primary"
              id="toStep3"
              onClick={() => {
                snapshotSettings(); // capture + persist current settings
                goToStep(3);
              }}
            >
              Preview &amp; Stats
              <ChevronRight />
            </button>
          </div>
        </div>
      </section>

      {/* STEP 3: REVIEW */}
      <section class="panel" id="panel3">
        <ProcessProgress />
        <div id="explore-tabs">
          <ExploreTabs />
        </div>
        <ReviewPanels />
        <div class="btn-row">
          <button
            class="btn btn-secondary"
            id="backTo2"
            onClick={() => goToStep(2)}
          >
            <ChevronLeft />
            Back
          </button>
          <div class="btn-row-right">
            <ExportButton />
          </div>
        </div>
        <ProcessStatus />
      </section>

      {/* STEP 4: EXPORT */}
      <section class="panel" id="panel4">
        <Export />
        <div class="btn-row">
          <button
            class="btn btn-secondary"
            id="backTo3"
            onClick={() => goToStep(3)}
          >
            <ChevronLeft />
            Back
          </button>
        </div>
        <DownloadStatus />
      </section>
    </div>
  );
}
