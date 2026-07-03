// Processing orchestration, extracted from app.js (Phase 5). Reads the loaded
// files + settings from the signals store, runs the parse/filter/budget pipeline
// (off-thread in the worker when possible, inline otherwise), and writes the
// result — outputs, totals, export summary, insight context, and progress/status
// — back to the store. No direct DOM access lives here; the progress bar + status
// render from the `processing` signal (ui/views/ProcessProgress.jsx) and the
// legacy Review cards render from `processedOutputs`/`processResult` via an
// effect in app.js (until they migrate to Preact in Phase 6).

import { localDate } from '../core/time.js';
import { charsForTokens } from '../core/tokens.js';
import { buildGroups } from '../core/grouping.js';
import { processGroup, buildIdentity } from '../core/pipeline.js';
import { ensureFileContents } from './files.js';
import {
  countTokens,
  enableAccurate,
  disableAccurate,
} from '../core/token-config.js';
import {
  getWorker,
  workerRequest,
  fileKey,
  markWorkerBroken,
} from './worker-client.js';
import {
  loadedFiles,
  botUsers,
  selectedUsers,
  processedOutputs,
  processResult,
  insightContext,
  processing,
  exportSummary,
} from './store.js';
import { settings, snapshotSettings } from './settings.js';
import { batch } from '@preact/signals';

// Resolve once the selected token counter is loaded (BPE load is async). The
// accurate toggle lives in the Preact Configure form (it calls enable/disable
// eagerly so the counter is ready by preview time); this guards the processing
// path against the store's current value.
function ensureCounterReady() {
  if (settings.value.useAccurateTokens) return enableAccurate();
  disableAccurate();
  return Promise.resolve();
}

// Advance the progress bar without disturbing the rest of the status state.
function setProgress(pct) {
  processing.value = { ...processing.value, pct };
}

/* PROCESSING PIPELINE — called by nav's onEnterReview when the user reaches the
   Review step. */
export function runProcessing() {
  // Reset: show the progress bar and clear the previous result so the legacy
  // Review cards hide while the run is in flight.
  batch(() => {
    processing.value = {
      active: true,
      pct: 10,
      status: 'Processing…',
      kind: '',
      engine: '',
    };
    processedOutputs.value = [];
    processResult.value = null;
  });

  // Ensure the selected token counter (approx or accurate BPE) is loaded first.
  return ensureCounterReady()
    .then(async () => {
      // Yield once so the "Processing…" status paints before any inline work.
      await new Promise((r) => setTimeout(r, 20));

      const cfg = snapshotSettings();
      const maxTokens = Math.max(1000, parseInt(cfg.maxTokens) || 1375000);
      // Sizes the greedy fill only; the verify pass measures real (estimated
      // or BPE) tokens against maxTokens.
      const maxChars = charsForTokens(maxTokens);
      const minMsgs = cfg.filterLowActivity
        ? Math.max(1, parseInt(cfg.minMessages) || 10)
        : 0;
      // Selected author names from the Preact user filter (empty = everyone).
      const userFilter =
        selectedUsers.value.size > 0 ? new Set(selectedUsers.value) : null;
      const dateFromVal = cfg.dateFrom ? localDate(cfg.dateFrom, false) : null;
      const dateToVal = cfg.dateTo ? localDate(cfg.dateTo, true) : null;
      const keywordsRaw = cfg.keywords.trim();
      const keywords = keywordsRaw
        ? keywordsRaw
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
        : [];

      // opts must be structured-cloneable (no functions) so it can post to the
      // worker; the counter is injected separately on each side.
      const opts = {
        minMsgs,
        maxTokens,
        maxChars,
        userFilter,
        filterBots: cfg.filterBots,
        botSet: botUsers.value,
        filterSystem: cfg.filterSystem,
        filterMediaOnly: cfg.filterMediaOnly,
        dateFrom: dateFromVal,
        dateTo: dateToVal,
        keywords,
        useRealNames: cfg.useRealNames,
      };

      setProgress(40);

      const validFiles = loadedFiles.value.filter((f) => !f.invalid);
      const useAccurate = !!cfg.useAccurateTokens;
      const { outputs, totalMessages, totalFiltered, totalKept, engine } =
        await computeOutputs(validFiles, opts, useAccurate);

      setProgress(75);

      // Publish the result. Setting processResult before processedOutputs (in one
      // batch) lets the legacy Review effect read the totals when outputs land.
      batch(() => {
        exportSummary.value =
          totalMessages > 0
            ? {
                kept: totalKept,
                total: totalMessages,
                budgetExceeded: outputs.some((o) => o.budgetExceeded),
              }
            : null;
        insightContext.value = { files: validFiles, opts };
        processResult.value = { totalMessages, totalFiltered, totalKept };
        processedOutputs.value = outputs;
      });

      // Final status: the diagnostic engine, the human-readable message, and the
      // status-bar kind. Keep the bar at 100% briefly, then retract it.
      let status, kind;
      if (totalMessages === 0) {
        // E2: a silent empty result usually means the parser couldn't read the
        // export (e.g. a non-US locale broke HTML/TXT date parsing). Say so.
        status =
          'No messages found. If these are non-US-locale .html/.txt exports, re-export as JSON (timestamps are locale-independent).';
        kind = 'error';
      } else if (outputs.some((o) => o.budgetExceeded)) {
        // Keyword-priority messages alone exceed the budget; they are all kept,
        // so the output is larger than the selected limit.
        status = `Processed ${totalMessages.toLocaleString()} → ${totalKept.toLocaleString()} kept — ⚠ priority messages exceed the token budget (output is larger than the limit).`;
        kind = '';
      } else {
        status = `Processed ${totalMessages.toLocaleString()} messages → ${totalKept.toLocaleString()} kept`;
        kind = 'success';
      }
      processing.value = { active: true, pct: 100, status, kind, engine };
      setTimeout(() => {
        processing.value = { ...processing.value, active: false, pct: 0 };
      }, 600);
    })
    .catch((err) => {
      console.error(err);
      processing.value = {
        active: false,
        pct: 0,
        status: 'Error: ' + err.message,
        kind: 'error',
        engine: '',
      };
    });
}

// Run the parse + pipeline off-thread in the worker when possible (B3b), falling
// back to the main thread. The accurate-token path always runs inline (the
// worker is approx-only). Returns { outputs, totalMessages, totalFiltered,
// totalKept } with outputs[].finalChunks (Date timestamps) + userMap (Map)
// preserved by structured clone.
export async function computeOutputs(validFiles, opts, useAccurate) {
  const w = !useAccurate ? getWorker() : null;
  if (w) {
    try {
      const res = await workerRequest(w, {
        type: 'process',
        fileMeta: validFiles.map((f) => ({
          key: fileKey(f),
          channelId: f.channelId,
          baseName: f.baseName,
          sortOrder: f.sortOrder,
          afterDate: f.afterDate,
        })),
        opts,
      });
      return { ...res, engine: 'worker' };
    } catch {
      markWorkerBroken(); // fall through to inline
    }
  }

  // Inline (main-thread) path: content strings may have been released once the
  // worker took the parse — re-read them from the File handles first.
  await ensureFileContents(validFiles);
  const groups = buildGroups(validFiles);
  const fullOpts = { ...opts, countTokens };
  // One global identity across all files (matches the worker path).
  const identity = buildIdentity(validFiles, fullOpts.useRealNames);
  const outputs = [];
  let totalMessages = 0,
    totalFiltered = 0,
    totalKept = 0;
  for (const [, arr] of groups) {
    const r = processGroup(arr, fullOpts, identity);
    totalMessages += r.allMessagesCount;
    totalFiltered += r.filteredCount;
    totalKept += r.finalChunks.length;
    outputs.push({
      name: arr[0].baseName,
      finalChunks: r.finalChunks,
      userMap: r.userMap,
      totalRaw: r.allMessagesCount,
      filteredCount: r.filteredCount,
      budgetExceeded: r.budgetExceeded,
    });
  }
  return { outputs, totalMessages, totalFiltered, totalKept, engine: 'inline' };
}
