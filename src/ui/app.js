// UI controller. Holds DOM wiring, wizard state, and event handlers, delegating
// all parsing/processing/rendering to the tested modules under src/. Behavior is
// preserved verbatim from the legacy index.html; only the pure logic moved out.

import { escHtml } from '../core/format.js';
import { getFilteredMessages } from '../core/pipeline.js';
import { computeAnalytics } from '../core/analytics.js';
import {
  renderInsights,
  renderNetwork,
  renderPartners,
  resetNetView,
} from './insights.js';
import { loadCalendar, setCalendarTz } from './calendar.js';
import { computeWrapped } from '../core/wrapped.js';
import { renderWrapped, downloadWrappedPng } from './wrapped.js';
import { chunkMessages } from '../core/chunking.js';
import { renderTxt } from '../render/txt.js';
import { renderJSON } from '../render/json.js';
import { renderMarkdown } from '../render/markdown.js';
import { renderCSV } from '../render/csv.js';
import { renderHTML } from '../render/html.js';
import { countTokens } from '../core/token-config.js';
import {
  getWorker,
  workerRequest,
  fileKey,
  markWorkerBroken,
} from './worker-client.js';
import {
  theme,
  exportFormat,
  goal,
  exploreTab,
  loadedFiles,
  processedOutputs,
  processResult,
  insightContext,
} from './store.js';
import { settings, snapshotSettings, applySavedSettings } from './settings.js';
import { runProcessing } from './processing.js';
import { configureNav, goToStep } from './nav.js';
import { effect, untracked } from '@preact/signals';

/* CONSTANTS */
const BAR_COLORS = [
  '#6c9eff',
  '#5ccf7f',
  '#e09a5c',
  '#e06c6c',
  '#a78bfa',
  '#f472b6',
  '#56c8e8',
  '#4dd4a0',
  '#f0a060',
  '#b89cff',
  '#40d0d0',
  '#8cd460',
  '#e88080',
  '#70b0ff',
  '#d088f0',
];

/* STATE — loadedFiles, botUsers, the user-filter selection, and the processed
   outputs/result now live in the signals store (ui/store.js). ui/processing.js
   runs the pipeline and writes them; this controller renders the (still-legacy)
   Review cards + handles preview/copy/download from those signals. */

/* DOM REFS */
const $ = (id) => document.getElementById(id);

/* THEME — owned by the store (ui/store.js) and rendered by the Preact Header.
   The Wrapped poster bakes in concrete theme colors, so re-render it whenever
   the theme changes while it's visible. */
effect(() => {
  theme.value; // subscribe
  const card = $('wrappedCard');
  if (card && card.style.display !== 'none') renderWrappedRecap();
});

/* SETTINGS PERSISTENCE — state lives in the signals store (ui/settings.js) and
   the Configure controls (ui/views/Configure.jsx) render from it. Restore the
   persisted store, then run the load-time side effects the still-legacy Export
   controls (panel4) need. */
function restoreSettings() {
  const s = applySavedSettings();
  exportFormat.value = $('outputFormat').value; // keep the store in sync
  $('chunkOptions').style.display = s.chunkOutput ? 'block' : 'none';
}

/* WIZARD NAVIGATION — the step signal + goToStep live in ui/nav.js (rendered by
   the Preact stepper). Inject this controller's two dependencies. */
configureNav({
  canAdvance: () => loadedFiles.value.length > 0,
  onEnterReview: () => runProcessing(),
});

// Enable "Continue" once at least one valid file is loaded (the Upload step's
// file list is rendered by Preact; this button stays legacy DOM for now).
effect(() => {
  const valid = loadedFiles.value.filter((f) => !f.invalid);
  const btn = $('toStep2');
  if (btn) btn.disabled = valid.length === 0;
});

$('toStep2').addEventListener('click', () => goToStep(2));
$('toStep3').addEventListener('click', () => {
  snapshotSettings(); // capture + persist current settings
  goToStep(3);
});
$('toStep4').addEventListener('click', () => goToStep(4));
$('backTo1').addEventListener('click', () => goToStep(1));
$('backTo2').addEventListener('click', () => goToStep(2));
$('backTo3').addEventListener('click', () => goToStep(3));

/* EXPORT-STEP WIRING — panel4 controls are still legacy DOM (the Configure
   controls moved to the Preact form bound to the settings store). */
$('chunkOutput').addEventListener('change', function () {
  $('chunkOptions').style.display = this.checked ? 'block' : 'none';
});

// Mirror the selected output format into the store so the Preact export
// confirmation can name it.
exportFormat.value = $('outputFormat').value;
$('outputFormat').addEventListener('change', function () {
  exportFormat.value = this.value;
});

// The output goal (Configure step) collapses the AI/token settings that don't
// apply (styles.css hides .ai-setting via #panel2[data-goal]) and pre-selects a
// matching export format. 'custom' shows everything.
const GOAL_FORMAT = { complete: 'html', compact: 'txt', data: 'json' };
effect(() => {
  const g = goal.value;
  const panel = $('panel2');
  if (panel) panel.dataset.goal = g;
  const fmt = GOAL_FORMAT[g];
  const sel = $('outputFormat');
  if (fmt && sel && sel.value !== fmt) {
    sel.value = fmt;
    exportFormat.value = fmt;
  }
});

// Reflect the active Explore tab onto the Review panel so CSS reveals just the
// matching analytics card (the cards are still rendered by the legacy code).
effect(() => {
  const panel = $('panel3');
  if (panel) panel.dataset.exploreTab = exploreTab.value;
});

// Enable "Continue to Export" once a run has produced a result — including an
// empty one (the user may still want to inspect/export nothing). processResult
// is reset to null while a run is in flight and stays null if the run threw, so
// it's disabled in exactly those two cases (matching the legacy behavior).
effect(() => {
  const btn = $('toStep4');
  if (btn) btn.disabled = processResult.value === null;
});

/* LEGACY REVIEW RENDER — ui/processing.js runs the pipeline and writes the
   result to the store (processedOutputs/processResult/insightContext, all in one
   batch). This effect reflects it onto the still-legacy Review cards (stats,
   budget, preview, insights); Phase 6 moves these to Preact. processResult is
   null while a run is in flight, which hides the cards. Only processedOutputs is
   a tracked dependency — the rest runs untracked so a later settings change (the
   render helpers read settings.value) can't re-trigger a full re-render. */
effect(() => {
  processedOutputs.value; // the trigger
  untracked(() => {
    const outputs = processedOutputs.value;
    const result = processResult.value;
    if (!result) {
      $('statsCard').style.display = 'none';
      $('budgetCard').style.display = 'none';
      $('previewCard').style.display = 'none';
      $('insightsCard').style.display = 'none';
      return;
    }
    const { totalMessages, totalFiltered, totalKept } = result;
    const allFinalChunks = [];
    const allUserMap = new Map();
    for (const po of outputs) {
      for (const c of po.finalChunks) allFinalChunks.push(c);
      for (const [k, v] of po.userMap) allUserMap.set(k, v);
    }
    renderStats(
      totalMessages,
      totalFiltered,
      totalKept,
      allFinalChunks,
      allUserMap,
    );

    if (outputs.length > 0) {
      // B6: let the user preview/copy any channel group, not just the first.
      const sel = $('previewGroup');
      sel.innerHTML = outputs
        .map((po, i) => `<option value="${i}">${escHtml(po.name)}</option>`)
        .join('');
      sel.style.display = outputs.length > 1 ? '' : 'none';
      sel.value = '0';
      renderPreview(0);
      $('previewCard').style.display = 'block';
    }

    // Insights dashboard (analytics over the full filtered conversation).
    const ctx = insightContext.value;
    if (ctx) {
      insightFiles = ctx.files;
      insightBaseOpts = ctx.opts;
    }
    if (totalMessages > 0) {
      $('insightsCard').style.display = 'block';
      loadInsights();
    }
  });
});

// Render the live preview for one processed channel group (B6).
function renderPreview(idx) {
  const po = processedOutputs.value[idx];
  if (!po) return;
  const cfg = snapshotSettings();
  const maxTokens = Math.max(1000, parseInt(cfg.maxTokens) || 1375000);
  const renderOpts = {
    preamble: cfg.preamble,
    redactNames: cfg.redactNames,
    redactUrls: cfg.redactUrls,
    redactEmails: cfg.redactEmails,
  };
  const previewText = renderTxt(
    po.finalChunks,
    po.userMap,
    maxTokens,
    renderOpts,
  );
  const lines = previewText.split('\n');
  const maxPreviewLines = 300;
  $('previewContent').textContent =
    lines.length > maxPreviewLines
      ? lines.slice(0, maxPreviewLines).join('\n') +
        `\n\n… (${lines.length - maxPreviewLines} more lines)`
      : previewText;
  const chars = previewText.length;
  const estTokens = countTokens(previewText);
  const tokenLabel = settings.value.useAccurateTokens ? '' : '~';
  $('previewInfo').textContent =
    `${lines.length} lines · ${chars.toLocaleString()} chars · ${tokenLabel}${estTokens.toLocaleString()} tokens`;
}
$('previewGroup').addEventListener('change', function () {
  renderPreview(parseInt(this.value) || 0);
});

/* INSIGHTS (analytics dashboard) */
let insightFiles = [];
let insightBaseOpts = null;
let insightTz = 'utc';
// Full analytics with NO user filter — the network graph and reply-partners
// panel always reflect the whole conversation; only the main charts respond to
// the per-user filter / drill-down focus.
let insightFull = null;
// Retained message DTOs (for the calendar + Wrapped recap) so the recap can be
// recomputed when the timezone or theme changes without another worker round-trip.
let browseMessages = null;

// Compute analytics over the full filtered conversation — off-thread in the
// worker when available, else inline on the main thread.
async function requestAnalytics(files, opts, tz) {
  const w = getWorker();
  if (w) {
    try {
      const res = await workerRequest(w, {
        type: 'analyze',
        fileMeta: files.map((f) => ({
          key: fileKey(f),
          channelId: f.channelId,
          baseName: f.baseName,
          sortOrder: f.sortOrder,
          afterDate: f.afterDate,
        })),
        opts,
        tz,
      });
      return res.stats;
    } catch {
      markWorkerBroken();
    }
  }
  const { filtered } = getFilteredMessages(files, opts);
  return computeAnalytics(filtered, { tz });
}

// Fetch the full filtered conversation as lightweight message DTOs (+ userMap)
// for the message-explorer calendar — off-thread when the worker is available.
async function requestMessages(files, opts) {
  const w = getWorker();
  if (w) {
    try {
      const res = await workerRequest(w, {
        type: 'messages',
        fileMeta: files.map((f) => ({
          key: fileKey(f),
          channelId: f.channelId,
          baseName: f.baseName,
          sortOrder: f.sortOrder,
          afterDate: f.afterDate,
        })),
        opts,
      });
      return { messages: res.messages, userMap: new Map(res.userMap) };
    } catch {
      markWorkerBroken();
    }
  }
  const { filtered, userMap } = getFilteredMessages(files, opts);
  return {
    messages: filtered.map((m) => ({
      authorId: m.authorId,
      authorName: m.authorName,
      ts: m.timestamp.getTime(),
      parts: m.contentParts,
      isSystem: m.isSystem,
    })),
    userMap,
  };
}

// Selected users as a set of stable author ids (uids), not display names —
// names are unreliable across merged files where a user can appear under
// different nicknames.
function selectedInsightUserIds() {
  const boxes = [...$('insightUserList').querySelectorAll('input:checked')];
  return boxes.length ? new Set(boxes.map((b) => b.value)) : null;
}

// Initial load (and after reprocessing): compute the full analytics, populate
// the user list, then render the (unfiltered) view + network.
async function loadInsights() {
  if (!insightFiles.length || !insightBaseOpts) return null;
  insightFull = await requestAnalytics(
    insightFiles,
    insightBaseOpts,
    insightTz,
  );
  if (insightFull) {
    resetNetView(); // fresh dataset → start the network at default zoom/pan
    populateInsightUserList(insightFull.users);
    await refreshView();
  }
  // Message explorer: fetch the full conversation once and hand it to the
  // calendar (which buckets by day/hour client-side).
  requestMessages(insightFiles, insightBaseOpts).then(
    ({ messages, userMap }) => {
      browseMessages = messages;
      // Show the card BEFORE loading so the day view has a real height when the
      // calendar measures it (otherwise it over-fills against a 0px viewport).
      $('messageExplorerCard').style.display = 'block';
      const has = loadCalendar(messages, userMap, insightTz);
      if (!has) $('messageExplorerCard').style.display = 'none';
      renderWrappedRecap();
    },
  );
  return insightFull;
}

// Build the Wrapped recap poster from the current analytics + messages.
function renderWrappedRecap() {
  if (!insightFull || !browseMessages || !browseMessages.length) {
    $('wrappedCard').style.display = 'none';
    return;
  }
  const data = computeWrapped(browseMessages, insightFull, insightTz);
  renderWrapped('wrappedPoster', data, { tz: insightTz });
  $('wrappedCard').style.display = 'block';
}

// Render the main charts for the current selection, plus the always-full
// network/partners with the focused user highlighted (a single selected user).
async function refreshView() {
  if (!insightFull) return null;
  const ids = selectedInsightUserIds();
  // No filter → reuse the full analytics (avoids a redundant recompute).
  const view = ids
    ? await requestAnalytics(
        insightFiles,
        {
          ...insightBaseOpts,
          userFilterIds: ids,
        },
        insightTz,
      )
    : insightFull;
  if (view) renderInsights(view);
  const focusId = ids && ids.size === 1 ? [...ids][0] : null;
  // The network/partners always reflect the full conversation. Hide the whole
  // section (header included) when there are no reply relationships to graph.
  const hasNetwork = renderNetwork(insightFull, focusId, focusUser);
  $('insightNetworkSection').style.display = hasNetwork ? 'block' : 'none';
  renderPartners(insightFull, focusId);
  return view;
}

// Drill down to a single user (toggle: clicking the sole-focused user clears it).
function focusUser(uid) {
  const boxes = [...$('insightUserList').querySelectorAll('input')];
  if (!boxes.length) return;
  const checked = boxes.filter((b) => b.checked).map((b) => b.value);
  const soleFocus = checked.length === 1 && checked[0] === uid;
  boxes.forEach((b) => (b.checked = soleFocus ? true : b.value === uid));
  refreshView();
}

function populateInsightUserList(users) {
  const list = $('insightUserList');
  list.innerHTML = users
    .map(
      (u) =>
        `<label class="user-item"><input type="checkbox" value="${escHtml(u.id)}"><span class="user-name">${escHtml(u.name)}</span><span class="user-count">${u.count.toLocaleString()}</span></label>`,
    )
    .join('');
  list
    .querySelectorAll('input')
    .forEach((cb) => cb.addEventListener('change', refreshView));
}

// Leaderboard drill-down (delegated, survives innerHTML re-renders): a click on
// a row focuses that user. Network node clicks are handled inside the network
// itself (wireNetwork) so they can be distinguished from pan drags.
$('insightUsers').addEventListener('click', (e) => {
  const row = e.target.closest('[data-uid]');
  if (row) focusUser(row.getAttribute('data-uid'));
});

async function setInsightTz(tz) {
  insightTz = tz;
  $('tzUtc').className =
    'btn ' + (tz === 'utc' ? 'btn-primary' : 'btn-secondary');
  $('tzLocal').className =
    'btn ' + (tz === 'local' ? 'btn-primary' : 'btn-secondary');
  // Recompute the full analytics under the new timezone, preserving selections.
  insightFull = await requestAnalytics(
    insightFiles,
    insightBaseOpts,
    insightTz,
  );
  await refreshView();
  setCalendarTz(insightTz); // re-bucket the explorer's days/hours
  renderWrappedRecap(); // peak-hour persona / busiest day depend on the tz
}
$('tzUtc').addEventListener('click', () => setInsightTz('utc'));
$('tzLocal').addEventListener('click', () => setInsightTz('local'));
$('wrappedDownload').addEventListener('click', () =>
  downloadWrappedPng('wrappedPoster', 'conversation-wrapped.png'),
);
$('insightUserHeader').addEventListener('click', function () {
  this.classList.toggle('open');
  $('insightUserBody').classList.toggle('open');
});
$('insightUserAll').addEventListener('click', (e) => {
  e.preventDefault();
  $('insightUserList')
    .querySelectorAll('input')
    .forEach((cb) => (cb.checked = true));
  refreshView();
});
$('insightUserNone').addEventListener('click', (e) => {
  e.preventDefault();
  $('insightUserList')
    .querySelectorAll('input')
    .forEach((cb) => (cb.checked = false));
  refreshView();
});

function renderStats(totalRaw, totalFiltered, totalKept, chunks, userMap) {
  const nameOf = (uid) => (userMap && userMap.get(uid)) || uid;
  const dateRange =
    chunks.length > 0
      ? `${chunks[0].timestamp.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })} — ${chunks[chunks.length - 1].timestamp.toLocaleDateString(
          'en-US',
          {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          },
        )}`
      : 'N/A';
  const uniqueUsers = new Set(chunks.map((c) => c.authorId)).size;
  const avgLen =
    chunks.length > 0
      ? Math.round(
          chunks.reduce((s, c) => s + c.contentParts.join(' ').length, 0) /
            chunks.length,
        )
      : 0;
  const chars = chunks.reduce(
    (s, c) => s + c.contentParts.join('\n').length + 15,
    0,
  );

  $('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${totalRaw.toLocaleString()}</div><div class="stat-label">Total msgs</div></div>
    <div class="stat-card"><div class="stat-value">${totalKept.toLocaleString()}</div><div class="stat-label">Kept</div></div>
    <div class="stat-card"><div class="stat-value">${uniqueUsers}</div><div class="stat-label">Users</div></div>
    <div class="stat-card"><div class="stat-value">${avgLen}</div><div class="stat-label">Avg chars/msg</div></div>
    <div class="stat-card" style="grid-column: span 2;"><div class="stat-value" style="font-size:15px;">${dateRange}</div><div class="stat-label">Date range</div></div>
  `;

  const userCounts = {};
  for (const c of chunks)
    userCounts[c.authorId] = (userCounts[c.authorId] || 0) + 1;
  const sorted = Object.entries(userCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;
  const topN = sorted.slice(0, 15);

  let chartHtml = '';
  topN.forEach(([uid, count], i) => {
    const pct = Math.max(2, (count / maxCount) * 100);
    const color = BAR_COLORS[i % BAR_COLORS.length];
    chartHtml += `<div class="chart-bar-row">
      <span class="chart-bar-label">${escHtml(nameOf(uid))}</span>
      <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%;background:${color};">${count}</div></div>
    </div>`;
  });
  if (sorted.length > 15)
    chartHtml += `<div style="text-align:center;font-size:12px;color:var(--text-muted);margin-top:6px;">+${sorted.length - 15} more users</div>`;
  $('userChart').innerHTML = chartHtml;
  $('statsCard').style.display = 'block';

  const budgetBars = [];
  for (const [uid] of sorted.slice(0, 10)) {
    const userChars = chunks
      .filter((c) => c.authorId === uid)
      .reduce((s, c) => s + c.contentParts.join('\n').length + 15, 0);
    budgetBars.push({ uid, chars: userChars });
  }
  const maxChars =
    Math.max(1, parseInt(settings.value.maxTokens) || 1375000) * 4;
  let budgetHtml = '';
  budgetBars.forEach((b, i) => {
    const pct = Math.max(1, (b.chars / maxChars) * 100);
    const color = BAR_COLORS[i % BAR_COLORS.length];
    const tokens = Math.round(b.chars / 4);
    budgetHtml += `<div class="chart-bar-row">
      <span class="chart-bar-label">${escHtml(nameOf(b.uid))}</span>
      <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%;background:${color};">${tokens.toLocaleString()} tkn</div></div>
    </div>`;
  });
  const usedPct = Math.round((chars / maxChars) * 100);
  budgetHtml =
    `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">Budget used: <strong style="color:var(--text-primary);">${usedPct}%</strong> (~${Math.round(chars / 4).toLocaleString()} / ${(maxChars / 4).toLocaleString()} tokens)</div>` +
    budgetHtml;
  $('budgetBars').innerHTML = budgetHtml;
  $('budgetCard').style.display = 'block';
}

/* COPY PREVIEW */
$('copyPreview').addEventListener('click', () => {
  const outputs = processedOutputs.value;
  if (outputs.length === 0) return;
  const idx = parseInt($('previewGroup').value) || 0;
  const po = outputs[idx] || outputs[0];
  const cfg = snapshotSettings();
  const maxTokens = Math.max(1000, parseInt(cfg.maxTokens) || 1375000);
  const renderOpts = {
    preamble: cfg.preamble,
    redactNames: cfg.redactNames,
    redactUrls: cfg.redactUrls,
    redactEmails: cfg.redactEmails,
  };
  const text = renderTxt(po.finalChunks, po.userMap, maxTokens, renderOpts);
  navigator.clipboard.writeText(text).then(() => {
    const btn = $('copyPreview');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy all'), 1500);
  });
});

/* DOWNLOAD */
$('downloadBtn').addEventListener('click', () => {
  const outputs = processedOutputs.value;
  if (outputs.length === 0) return;
  const cfg = snapshotSettings();
  const format = cfg.outputFormat;
  const maxTokens = Math.max(1000, parseInt(cfg.maxTokens) || 1375000);
  const doChunk = cfg.chunkOutput;
  const overlap = parseInt(cfg.chunkOverlap) || 500;
  const renderOpts = {
    preamble: cfg.preamble,
    redactNames: cfg.redactNames,
    redactUrls: cfg.redactUrls,
    redactEmails: cfg.redactEmails,
  };

  let dlCount = 0;

  for (const po of outputs) {
    if (doChunk) {
      const chunks = chunkMessages(po.finalChunks, maxTokens, overlap);
      chunks.forEach((chunkMsgs, i) => {
        let text, ext;
        switch (format) {
          case 'json':
            text = renderJSON(chunkMsgs, po.userMap, renderOpts);
            ext = 'json';
            break;
          case 'md':
            text = renderMarkdown(chunkMsgs, po.userMap, maxTokens, renderOpts);
            ext = 'md';
            break;
          case 'csv':
            text = renderCSV(chunkMsgs, po.userMap, renderOpts);
            ext = 'csv';
            break;
          case 'html':
            text = renderHTML(chunkMsgs, po.userMap, maxTokens, renderOpts);
            ext = 'html';
            break;
          default:
            text = renderTxt(chunkMsgs, po.userMap, maxTokens, renderOpts);
            ext = 'txt';
            break;
        }
        setTimeout(
          () =>
            downloadFile(text, `${safeFilename(po.name)}_chunk${i + 1}.${ext}`),
          dlCount * 400,
        );
        dlCount++;
      });
    } else {
      let text, ext;
      switch (format) {
        case 'json':
          text = renderJSON(po.finalChunks, po.userMap, renderOpts);
          ext = 'json';
          break;
        case 'md':
          text = renderMarkdown(
            po.finalChunks,
            po.userMap,
            maxTokens,
            renderOpts,
          );
          ext = 'md';
          break;
        case 'csv':
          text = renderCSV(po.finalChunks, po.userMap, renderOpts);
          ext = 'csv';
          break;
        case 'html':
          text = renderHTML(po.finalChunks, po.userMap, maxTokens, renderOpts);
          ext = 'html';
          break;
        default:
          text = renderTxt(po.finalChunks, po.userMap, maxTokens, renderOpts);
          ext = 'txt';
          break;
      }
      setTimeout(
        () => downloadFile(text, `${safeFilename(po.name)}_processed.${ext}`),
        dlCount * 400,
      );
      dlCount++;
    }
  }

  $('downloadStatus').textContent = `${dlCount} file(s) downloading…`;
  $('downloadStatus').className = 'status-bar success';
});

/* UTILITIES */
// Strip path separators, Windows-reserved and control characters, leading dots,
// and trailing dots/spaces from a base filename so downloads can't escape paths
// or produce invalid names.
function safeFilename(name) {
  return (
    String(name)
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '')
      .slice(0, 120) || 'export'
  );
}

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Restore saved settings on init
restoreSettings();
