// Analytics host for the Review step. Owns the wiring that drives the imperative
// chart renderers (ui/insights.js, ui/calendar.js, ui/wrapped.js) which are
// *hosted*, not rewritten: this module computes the analytics (off-thread in the
// worker when available) and renders into the static host skeletons
// (ui/views/Review/{Insights,Calendar,Wrapped}.jsx) by their legacy ids.
//
// Moved verbatim out of app.js as part of Phase 6 (Review → Preact). It holds:
//   - requestAnalytics / requestMessages   (worker-or-inline compute)
//   - the timezone toggle, the insight-user list, drill-down focus, refreshView
//   - the Wrapped recap (re-baked on theme/tz change) + PNG download
//
// initAnalyticsHost() is called by mount.jsx *after* the skeletons are rendered,
// so every getElementById target exists; it wires the controls and installs the
// effects that (re)load analytics whenever a new run lands.

import { escHtml } from '../core/format.js';
import { getFilteredConversation } from '../core/pipeline.js';
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
import {
  getWorker,
  workerRequest,
  fileKey,
  markWorkerBroken,
} from './worker-client.js';
import {
  theme,
  exploreTab,
  processedOutputs,
  processResult,
  insightContext,
} from './store.js';
import { effect, untracked } from '@preact/signals';

const $ = (id) => document.getElementById(id);

/* STATE — the analytics context for the current run. insightFiles/insightBaseOpts
   come from the store's insightContext; the rest is recomputed as the user
   filters, drills down, or flips the timezone. */
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
  const { filtered } = getFilteredConversation(files, opts);
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
  const { filtered, userMap } = getFilteredConversation(files, opts);
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
  const all = $('insightUserList').querySelectorAll('input');
  const checked = [...all].filter((b) => b.checked);
  // None or all selected → no filter (and no needless recompute); only a partial
  // selection actually filters the charts.
  if (checked.length === 0 || checked.length === all.length) return null;
  return new Set(checked.map((b) => b.value));
}

// Toggle the "crunching the numbers…" indicator while analytics compute (the
// worker round-trip can take a couple of seconds on a large conversation).
function setInsightBusy(on) {
  const el = $('insightBusy');
  if (el) el.hidden = !on;
}

// Initial load (and after reprocessing): compute the full analytics, populate
// the user list, then render the (unfiltered) view + network.
async function loadInsights() {
  if (!insightFiles.length || !insightBaseOpts) return null;
  setInsightBusy(true);
  insightFull = await requestAnalytics(
    insightFiles,
    insightBaseOpts,
    insightTz,
  );
  setInsightBusy(false);
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
  const focusId = ids && ids.size === 1 ? [...ids][0] : null;
  // Highlight the focused user in the network + partners FIRST — this reads the
  // already-computed full analytics, so clicking a node reacts instantly instead
  // of waiting on the (possibly slow) per-user chart recompute below.
  const hasNetwork = renderNetwork(insightFull, focusId, focusUser);
  $('insightNetworkSection').style.display = hasNetwork ? 'block' : 'none';
  renderPartners(insightFull, focusId);
  // Main charts: reuse the full analytics when unfiltered, else recompute for the
  // selection (a worker round-trip) with the busy indicator up.
  let view = insightFull;
  if (ids) {
    setInsightBusy(true);
    view = await requestAnalytics(
      insightFiles,
      { ...insightBaseOpts, userFilterIds: ids },
      insightTz,
    );
    setInsightBusy(false);
  }
  if (view) renderInsights(view);
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

async function setInsightTz(tz) {
  insightTz = tz;
  $('tzUtc').className =
    'btn ' + (tz === 'utc' ? 'btn-primary' : 'btn-secondary');
  $('tzLocal').className =
    'btn ' + (tz === 'local' ? 'btn-primary' : 'btn-secondary');
  // Recompute the full analytics under the new timezone, preserving selections.
  setInsightBusy(true);
  insightFull = await requestAnalytics(
    insightFiles,
    insightBaseOpts,
    insightTz,
  );
  setInsightBusy(false);
  await refreshView();
  setCalendarTz(insightTz); // re-bucket the explorer's days/hours
  renderWrappedRecap(); // peak-hour persona / busiest day depend on the tz
}

// Hide every analytics host card (used on reset / a no-data run).
function hideAnalyticsCards() {
  $('insightsCard').style.display = 'none';
  $('wrappedCard').style.display = 'none';
  $('messageExplorerCard').style.display = 'none';
}

// Wire the controls + install the effects. Called once, after mount.jsx has
// rendered the host skeletons so all the id targets exist.
export function initAnalyticsHost() {
  // Reflect the active Explore tab onto the Review panel so CSS reveals just the
  // matching analytics card.
  effect(() => {
    const panel = $('panel3');
    if (panel) panel.dataset.exploreTab = exploreTab.value;
  });

  // The Wrapped poster bakes in concrete theme colors, so re-render it whenever
  // the theme changes while it's visible.
  effect(() => {
    theme.value; // subscribe
    const card = $('wrappedCard');
    if (card && card.style.display !== 'none') renderWrappedRecap();
  });

  // (Re)load analytics when a run lands. Keyed on processedOutputs (written last
  // in the run), the rest read untracked so a later settings change can't
  // re-trigger a reload. processResult is null while a run is in flight / on a
  // throw, which hides the cards.
  effect(() => {
    processedOutputs.value; // the trigger
    untracked(() => {
      const result = processResult.value;
      if (!result) {
        hideAnalyticsCards();
        return;
      }
      const ctx = insightContext.value;
      if (ctx) {
        insightFiles = ctx.files;
        insightBaseOpts = ctx.opts;
      }
      if (result.totalMessages > 0) {
        $('insightsCard').style.display = 'block';
        loadInsights();
      } else {
        hideAnalyticsCards();
      }
    });
  });

  // Leaderboard drill-down (delegated, survives innerHTML re-renders): a click on
  // a row focuses that user. Network node clicks are handled inside the network
  // itself (wireNetwork) so they can be distinguished from pan drags.
  $('insightUsers').addEventListener('click', (e) => {
    const row = e.target.closest('[data-uid]');
    if (row) focusUser(row.getAttribute('data-uid'));
  });

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
}
