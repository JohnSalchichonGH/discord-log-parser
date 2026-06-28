// UI controller. Holds DOM wiring, wizard state, and event handlers, delegating
// all parsing/processing/rendering to the tested modules under src/. Behavior is
// preserved verbatim from the legacy index.html; only the pure logic moved out.

import { formatBytes, escHtml } from '../core/format.js';
import { parseFilename, buildGroups } from '../core/grouping.js';
import { localDate } from '../core/time.js';
import {
  processGroup,
  getRawMessages,
  getFilteredMessages,
} from '../core/pipeline.js';
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
import { parseTxtHeader } from '../parsers/txt.js';
import { parseJsonHeader } from '../parsers/json.js';
import { renderTxt } from '../render/txt.js';
import { renderJSON } from '../render/json.js';
import { renderMarkdown } from '../render/markdown.js';
import { renderCSV } from '../render/csv.js';
import {
  countTokens,
  hasAccurate,
  enableAccurate,
  disableAccurate,
} from '../core/token-config.js';
import DlpWorker from '../worker.js?worker&inline';

/* WEB WORKER (off-thread parse + pipeline; graceful main-thread fallback) */
let worker = null;
let workerBroken = false;
function getWorker() {
  if (workerBroken) return null;
  if (!worker && typeof Worker !== 'undefined') {
    try {
      worker = new DlpWorker();
    } catch {
      workerBroken = true;
    }
  }
  return worker;
}
// One request/response round-trip; progress messages go to onProgress. Each
// request carries a unique id and only reacts to replies with the matching id,
// so concurrent setFiles/process calls can't resolve each other's promises.
let workerReqId = 0;
function workerRequest(w, message, onProgress) {
  const id = ++workerReqId;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
    };
    const onMsg = (e) => {
      const d = e.data;
      if (d._id !== id) return; // a different request's reply
      if (d.type === 'progress') return onProgress && onProgress(d);
      cleanup();
      if (d.type === 'error') reject(new Error(d.message));
      else resolve(d);
    };
    const onErr = (e) => {
      cleanup();
      reject(new Error(e.message || 'worker error'));
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ ...message, _id: id });
  });
}
const fileKey = (f) => `${f.name}|${f.size}`;

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

/* STATE */
let loadedFiles = []; // { name, content, isTxt, channelId, baseName, sortOrder, afterDate, size }
let processedOutputs = []; // { name, text, chunks, stats }
let botUsers = new Set(); // author names tagged as bots

/* DOM REFS */
const $ = (id) => document.getElementById(id);

/* THEME */
function initTheme() {
  const saved = localStorage.getItem('dlp-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon();
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dlp-theme', next);
  updateThemeIcon();
  // The Wrapped poster bakes in concrete theme colors, so re-render on toggle.
  if ($('wrappedCard').style.display !== 'none') renderWrappedRecap();
}
function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  $('themeIcon').innerHTML = isDark
    ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
}
$('themeToggle').addEventListener('click', toggleTheme);
initTheme();

/* SETTINGS PERSISTENCE */
function saveSettings() {
  try {
    const s = {
      maxTokens: $('maxTokens').value,
      modelPreset: $('modelPreset').value,
      filterLowActivity: $('filterLowActivity').checked,
      minMessages: $('minMessages').value,
      filterBots: $('filterBots').checked,
      filterSystem: $('filterSystem').checked,
      filterMediaOnly: $('filterMediaOnly').checked,
      redactNames: $('redactNames').checked,
      useRealNames: $('useRealNames').checked,
      redactUrls: $('redactUrls').checked,
      redactEmails: $('redactEmails').checked,
      outputFormat: $('outputFormat').value,
      chunkOutput: $('chunkOutput').checked,
      chunkOverlap: $('chunkOverlap').value,
      useAccurateTokens: $('useAccurateTokens').checked,
      // E3: persist content fields so they survive a reload.
      keywords: $('keywordInput').value,
      preamble: $('customPreamble').value,
      dateFrom: $('dateFrom').value,
      dateTo: $('dateTo').value,
    };
    localStorage.setItem('dlp-settings', JSON.stringify(s));
  } catch (e) {}
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('dlp-settings'));
    if (!s) return;
    if (s.maxTokens) $('maxTokens').value = s.maxTokens;
    if (s.modelPreset) $('modelPreset').value = s.modelPreset;
    if (s.filterLowActivity)
      $('filterLowActivity').checked = s.filterLowActivity;
    if (s.minMessages) $('minMessages').value = s.minMessages;
    if (s.filterBots) $('filterBots').checked = s.filterBots;
    if (s.filterSystem) $('filterSystem').checked = s.filterSystem;
    if (s.filterMediaOnly) $('filterMediaOnly').checked = s.filterMediaOnly;
    if (s.redactNames) $('redactNames').checked = s.redactNames;
    if (s.useRealNames) $('useRealNames').checked = s.useRealNames;
    if (s.redactUrls) $('redactUrls').checked = s.redactUrls;
    if (s.redactEmails) $('redactEmails').checked = s.redactEmails;
    if (s.outputFormat) $('outputFormat').value = s.outputFormat;
    if (s.chunkOutput) $('chunkOutput').checked = s.chunkOutput;
    if (s.chunkOverlap) $('chunkOverlap').value = s.chunkOverlap;
    if (s.useAccurateTokens)
      $('useAccurateTokens').checked = s.useAccurateTokens;
    if (s.keywords) $('keywordInput').value = s.keywords;
    if (s.preamble) $('customPreamble').value = s.preamble;
    if (s.dateFrom) $('dateFrom').value = s.dateFrom;
    if (s.dateTo) $('dateTo').value = s.dateTo;
    updateTokenLabel();
    syncNameToggles(); // reflect any persisted real-names/anonymize state
    $('minMsgRow').style.display = s.filterLowActivity ? 'block' : 'none';
    $('chunkOptions').style.display = s.chunkOutput ? 'block' : 'none';
  } catch (e) {}
}

/* WIZARD NAVIGATION */
let currentStep = 1;
function goToStep(n) {
  if (n < 1 || n > 4) return;
  if (n > 1 && !loadedFiles.length) return;
  if (n > currentStep + 1) return; // can't skip forward

  document
    .querySelectorAll('.panel')
    .forEach((p) => p.classList.remove('active'));
  $('panel' + n).classList.add('active');

  document.querySelectorAll('.wizard-step').forEach((s) => {
    const sn = parseInt(s.dataset.step);
    s.classList.remove('active', 'completed');
    if (sn === n) s.classList.add('active');
    else if (sn < n) s.classList.add('completed');
    if (sn === n) s.setAttribute('aria-current', 'step');
    else s.removeAttribute('aria-current');
  });

  currentStep = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (n === 3) runProcessing();
}

document.querySelectorAll('.wizard-step').forEach((s) => {
  s.addEventListener('click', () => {
    const sn = parseInt(s.dataset.step);
    if (s.classList.contains('completed')) goToStep(sn);
  });
});

$('toStep2').addEventListener('click', () => goToStep(2));
$('toStep3').addEventListener('click', () => {
  saveSettings();
  goToStep(3);
});
$('toStep4').addEventListener('click', () => goToStep(4));
$('backTo1').addEventListener('click', () => goToStep(1));
$('backTo2').addEventListener('click', () => goToStep(2));
$('backTo3').addEventListener('click', () => goToStep(3));

/* TOKEN LABEL UPDATES */
function updateTokenLabel() {
  const t = Math.max(1000, parseInt($('maxTokens').value) || 1375000);
  const c = t * 4;
  $('maxCharsLabel').textContent =
    c >= 1e6 ? (c / 1e6).toFixed(1) + 'M' : (c / 1e3).toFixed(0) + 'K';
}
$('maxTokens').addEventListener('input', updateTokenLabel);
$('modelPreset').addEventListener('change', function () {
  if (this.value !== 'custom') {
    $('maxTokens').value = this.value;
    updateTokenLabel();
  }
});

/* UI TOGGLE WIRING */
$('filterLowActivity').addEventListener('change', function () {
  $('minMsgRow').style.display = this.checked ? 'block' : 'none';
});
$('chunkOutput').addEventListener('change', function () {
  $('chunkOptions').style.display = this.checked ? 'block' : 'none';
});

// E4: "Use real names" and "Anonymize header" are opposites — enabling one
// would otherwise defeat the other. Keep them mutually exclusive.
function syncNameToggles(changed) {
  const real = $('useRealNames'),
    redact = $('redactNames');
  if (changed === 'real' && real.checked) redact.checked = false;
  if (changed === 'redact' && redact.checked) real.checked = false;
  redact.closest('.toggle-row').classList.toggle('is-disabled', real.checked);
  real.closest('.toggle-row').classList.toggle('is-disabled', redact.checked);
}
$('useRealNames').addEventListener('change', () => syncNameToggles('real'));
$('redactNames').addEventListener('change', () => syncNameToggles('redact'));

// Accurate tokenizer toggle — present only in the accurate build.
if (hasAccurate()) {
  $('accurateTokensRow').style.display = '';
  $('useAccurateTokens').addEventListener('change', function () {
    // Start loading early so the counter is ready by preview time.
    if (this.checked) enableAccurate();
    else disableAccurate();
  });
}
// Resolve once the selected token counter is loaded (BPE load is async).
function ensureCounterReady() {
  const cb = $('useAccurateTokens');
  if (cb && cb.checked) return enableAccurate();
  disableAccurate();
  return Promise.resolve();
}

$('userFilterHeader').addEventListener('click', function () {
  this.classList.toggle('open');
  $('userFilterBody').classList.toggle('open');
});
$('userSelectAll').addEventListener('click', (e) => {
  e.preventDefault();
  $('userFilterList')
    .querySelectorAll('input[type=checkbox]')
    .forEach((cb) => (cb.checked = true));
  updateUserFilterCount();
});
$('userClearAll').addEventListener('click', (e) => {
  e.preventDefault();
  $('userFilterList')
    .querySelectorAll('input[type=checkbox]')
    .forEach((cb) => (cb.checked = false));
  updateUserFilterCount();
});
function updateUserFilterCount() {
  const checked = $('userFilterList').querySelectorAll('input:checked').length;
  $('userFilterCount').textContent = checked
    ? `${checked} selected`
    : 'none selected = everyone';
  $('userFilterCount').className = checked ? 'tag tag-accent' : 'tag tag-muted';
}

/* FILE HANDLING — DROP ZONE + FILE INPUT */
const dropZone = $('dropZone');
const fileInput = $('fileInput');

['dragenter', 'dragover'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  });
});
dropZone.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files).filter((f) => {
    const n = f.name.toLowerCase();
    return n.endsWith('.html') || n.endsWith('.txt') || n.endsWith('.json');
  });
  if (files.length) addFiles(files);
});
fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length) addFiles(files);
  fileInput.value = ''; // allow re-selecting same files
});

function addFiles(files) {
  let pending = files.length;
  files.forEach((file) => {
    if (loadedFiles.find((f) => f.name === file.name && f.size === file.size)) {
      if (--pending === 0) onAllFilesLoaded();
      return;
    }
    const lower = file.name.toLowerCase();
    const isTxt = lower.endsWith('.txt');
    const isJson = lower.endsWith('.json');
    const meta = isTxt
      ? {
          channelId: file.name,
          baseName: file.name.replace(/\.txt$/i, ''),
          afterDate: null,
        }
      : isJson
        ? {
            channelId: file.name,
            baseName: file.name.replace(/\.json$/i, ''),
            afterDate: null,
          }
        : parseFilename(file.name);
    const reader = new FileReader();
    reader.onload = function (e) {
      const content = e.target.result;
      let invalid = false,
        error = null;
      if (isTxt) {
        const hdr = parseTxtHeader(content);
        meta.channelId = hdr.channelId;
        meta.baseName = hdr.baseName;
      } else if (isJson) {
        // JSON is validated at load time so malformed files surface loudly
        // (E2) instead of silently producing nothing.
        try {
          const hdr = parseJsonHeader(content);
          meta.channelId = hdr.channelId;
          meta.baseName = hdr.baseName;
          meta.afterDate = hdr.afterDate;
        } catch (err) {
          invalid = true;
          error = err.message;
        }
      }
      loadedFiles.push({
        name: file.name,
        isTxt,
        isJson,
        content,
        channelId: meta.channelId,
        baseName: meta.baseName,
        sortOrder: file.lastModified,
        afterDate: meta.afterDate,
        size: file.size,
        invalid,
        error,
      });
      if (--pending === 0) onAllFilesLoaded();
    };
    // B1: a failed read must not leave `pending` stuck; record it and continue.
    reader.onerror = function () {
      loadedFiles.push({
        name: file.name,
        isTxt,
        isJson,
        content: '',
        channelId: file.name,
        baseName: file.name,
        sortOrder: file.lastModified,
        afterDate: null,
        size: file.size,
        invalid: true,
        error: 'Could not read file.',
      });
      if (--pending === 0) onAllFilesLoaded();
    };
    reader.readAsText(file);
  });
}

function removeFile(idx) {
  loadedFiles.splice(idx, 1);
  if (loadedFiles.length === 0) {
    dropZone.classList.remove('has-files');
    $('fileListContainer').style.display = 'none';
    $('toStep2').disabled = true;
    renderDropZoneEmpty();
  } else {
    onAllFilesLoaded();
  }
}

function renderDropZoneEmpty() {
  dropZone.innerHTML = `
    <svg class="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    <div class="drop-label">Drop files here or click to browse</div>
    <div class="drop-hint">.json, .html, or .txt files from DiscordChatExporter</div>
    <input type="file" id="fileInput" accept=".html,.txt,.json" multiple aria-label="Upload .json, .html, or .txt Discord export files">
  `;
  const newInput = dropZone.querySelector('input');
  newInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length) addFiles(files);
    newInput.value = '';
  });
}

function onAllFilesLoaded() {
  // Render file list
  const listEl = $('fileList');
  listEl.innerHTML = '';
  loadedFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    const errNote = f.invalid
      ? `<span class="file-size" style="color:var(--danger);" title="${escHtml(f.error || 'Invalid file')}">⚠ ${escHtml(f.error || 'Invalid file')}</span>`
      : `<span class="file-size">${formatBytes(f.size)}</span>`;
    item.innerHTML = `
      <svg class="file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="file-name">${escHtml(f.name)}</span>
      ${errNote}
      <button class="file-remove" type="button" data-idx="${i}" title="Remove" aria-label="Remove ${escHtml(f.name)}">✕</button>
    `;
    listEl.appendChild(item);
  });

  // Only valid files take part in grouping, author collection, and processing.
  const validFiles = loadedFiles.filter((f) => !f.invalid);
  listEl.querySelectorAll('.file-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(parseInt(btn.dataset.idx));
    });
  });

  // Merge groups preview
  const groups = buildGroups(validFiles);
  const mgEl = $('mergeGroups');
  mgEl.innerHTML = '';
  const groupKeys = [];
  for (const [key, arr] of groups) {
    groupKeys.push(key);
    const box = document.createElement('div');
    box.className = 'merge-group';
    box.dataset.groupKey = key;
    const titleText =
      escHtml(arr[0].baseName) +
      (arr.length > 1 ? ` — ${arr.length} files → merged` : '');
    let html = `<label class="merge-header"><input type="checkbox" class="merge-group-cb" data-key="${escHtml(key)}"><span class="merge-title">${titleText}</span></label>`;
    for (const f of arr) {
      const modDate = new Date(f.sortOrder).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const badge = f.afterDate
        ? `<span class="badge badge-dated">after ${escHtml(f.afterDate)}</span>`
        : `<span class="badge badge-base">mod: ${modDate}</span>`;
      html += `<div class="merge-file">${escHtml(f.name)} ${badge}</div>`;
    }
    box.innerHTML = html;
    mgEl.appendChild(box);
  }

  const toolbar = $('mergeToolbar');
  toolbar.classList.toggle('visible', groups.size > 1);
  updateMergeToolbar();
  mgEl.querySelectorAll('.merge-group-cb').forEach((cb) => {
    cb.addEventListener('change', function () {
      this.closest('.merge-group').classList.toggle('selected', this.checked);
      updateMergeToolbar();
    });
  });

  // Populate the user filter (author list). Parsing happens once — off-thread in
  // the worker when available (B3b), else inline on the main thread (B2 cache).
  populateUserFilter(validFiles);

  dropZone.classList.add('has-files');
  $('fileListContainer').style.display = 'block';
  // Can only continue if at least one valid file loaded.
  $('toStep2').disabled = validFiles.length === 0;
}

// Author name → message count, computed on the main thread from cached parses.
function inlineAuthors(validFiles) {
  const m = new Map();
  for (const f of validFiles)
    for (const msg of getRawMessages(f))
      m.set(msg.authorName, (m.get(msg.authorName) || 0) + 1);
  return [...m.entries()];
}

async function populateUserFilter(validFiles) {
  let entries;
  const w = getWorker();
  if (w) {
    try {
      const res = await workerRequest(w, {
        type: 'setFiles',
        files: validFiles.map((f) => ({
          key: fileKey(f),
          content: f.content,
          isTxt: f.isTxt,
          isJson: f.isJson,
        })),
      });
      entries = res.authors;
    } catch {
      workerBroken = true;
      entries = inlineAuthors(validFiles);
    }
  } else {
    entries = inlineAuthors(validFiles);
  }
  renderUserFilter(entries);
}

function renderUserFilter(entries) {
  const listUF = $('userFilterList');
  listUF.innerHTML = '';
  entries
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      const item = document.createElement('label');
      item.className = 'user-item';
      const isBot = botUsers.has(name);
      item.innerHTML = `
      <input type="checkbox" value="${escHtml(name)}">
      <span class="user-name">${escHtml(name)}</span>
      <span class="user-count">${count}</span>
      <span class="bot-tag ${isBot ? 'active' : ''}" data-name="${escHtml(name)}" title="Click to tag/untag as bot">${isBot ? 'BOT' : 'bot?'}</span>
    `;
      item
        .querySelector('input')
        .addEventListener('change', updateUserFilterCount);
      item.querySelector('.bot-tag').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const n = this.dataset.name;
        if (botUsers.has(n)) {
          botUsers.delete(n);
          this.classList.remove('active');
          this.textContent = 'bot?';
        } else {
          botUsers.add(n);
          this.classList.add('active');
          this.textContent = 'BOT';
        }
      });
      listUF.appendChild(item);
    });
  updateUserFilterCount();
}

/* MANUAL GROUP MERGING */
function updateMergeToolbar() {
  const checked = document.querySelectorAll('.merge-group-cb:checked');
  const count = checked.length;
  $('mergeSelCount').textContent = count;
  $('mergeBtn').disabled = count < 2;
  $('mergeBtnText').textContent =
    count < 2 ? 'Select 2+ to merge' : `Merge ${count} groups`;
}

$('mergeBtn').addEventListener('click', () => {
  const checked = [...document.querySelectorAll('.merge-group-cb:checked')];
  if (checked.length < 2) return;

  const selectedKeys = checked.map((cb) => cb.dataset.key);
  const targetKey = selectedKeys[0];
  const targetFile = loadedFiles.find((f) => f.channelId === targetKey);
  const targetBaseName = targetFile ? targetFile.baseName : 'Merged';

  for (const f of loadedFiles) {
    if (selectedKeys.includes(f.channelId)) {
      f.channelId = targetKey;
      f.baseName = targetBaseName;
    }
  }

  onAllFilesLoaded();
});

/* PROCESSING PIPELINE */
function runProcessing() {
  const statusEl = $('processStatus');
  statusEl.textContent = 'Processing…';
  statusEl.className = 'status-bar';
  $('statsCard').style.display = 'none';
  $('budgetCard').style.display = 'none';
  $('previewCard').style.display = 'none';
  $('insightsCard').style.display = 'none';
  $('toStep4').disabled = true;

  const progress = $('processProgress');
  const fill = $('progressFill');
  progress.classList.add('active');
  fill.style.width = '10%';

  // Ensure the selected token counter (approx or accurate BPE) is loaded first.
  ensureCounterReady()
    .then(async () => {
      // Yield once so the "Processing…" status paints before any inline work.
      await new Promise((r) => setTimeout(r, 20));

      const maxTokens = Math.max(
        1000,
        parseInt($('maxTokens').value) || 1375000,
      );
      const maxChars = maxTokens * 4;
      const doFilter = $('filterLowActivity').checked;
      const minMsgs = doFilter
        ? Math.max(1, parseInt($('minMessages').value) || 10)
        : 0;
      const userFilterCbs = [
        ...$('userFilterList').querySelectorAll('input:checked'),
      ].map((cb) => cb.value);
      const userFilter =
        userFilterCbs.length > 0 ? new Set(userFilterCbs) : null;
      const dateFromVal = $('dateFrom').value
        ? localDate($('dateFrom').value, false)
        : null;
      const dateToVal = $('dateTo').value
        ? localDate($('dateTo').value, true)
        : null;
      const keywordsRaw = $('keywordInput').value.trim();
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
        filterBots: $('filterBots').checked,
        botSet: botUsers,
        filterSystem: $('filterSystem').checked,
        filterMediaOnly: $('filterMediaOnly').checked,
        dateFrom: dateFromVal,
        dateTo: dateToVal,
        keywords,
        useRealNames: $('useRealNames').checked,
      };

      fill.style.width = '40%';

      const validFiles = loadedFiles.filter((f) => !f.invalid);
      const useAccurate = !!(
        $('useAccurateTokens') && $('useAccurateTokens').checked
      );
      const { outputs, totalMessages, totalFiltered, totalKept, engine } =
        await computeOutputs(validFiles, opts, useAccurate);
      // Diagnostic: which path produced the result ('worker' or 'inline').
      statusEl.dataset.engine = engine;

      processedOutputs = outputs;
      const allFinalChunks = [];
      const allUserMap = new Map();
      for (const po of outputs) {
        for (const c of po.finalChunks) allFinalChunks.push(c);
        for (const [k, v] of po.userMap) allUserMap.set(k, v);
      }

      fill.style.width = '75%';

      renderStats(
        totalMessages,
        totalFiltered,
        totalKept,
        allFinalChunks,
        allUserMap,
      );

      if (processedOutputs.length > 0) {
        // B6: let the user preview/copy any channel group, not just the first.
        const sel = $('previewGroup');
        sel.innerHTML = processedOutputs
          .map((po, i) => `<option value="${i}">${escHtml(po.name)}</option>`)
          .join('');
        sel.style.display = processedOutputs.length > 1 ? '' : 'none';
        sel.value = '0';
        renderPreview(0);
        $('previewCard').style.display = 'block';
      }

      // Insights dashboard (analytics over the full filtered conversation).
      insightFiles = validFiles;
      insightBaseOpts = opts;
      if (totalMessages > 0) {
        $('insightsCard').style.display = 'block';
        loadInsights();
      }

      fill.style.width = '100%';
      setTimeout(() => {
        progress.classList.remove('active');
        fill.style.width = '0%';
      }, 600);
      if (totalMessages === 0) {
        // E2: a silent empty result usually means the parser couldn't read the
        // export (e.g. a non-US locale broke HTML/TXT date parsing). Say so.
        statusEl.textContent =
          'No messages found. If these are non-US-locale .html/.txt exports, re-export as JSON (timestamps are locale-independent).';
        statusEl.className = 'status-bar error';
      } else if (outputs.some((o) => o.budgetExceeded)) {
        // Keyword-priority messages alone exceed the budget; they are all kept,
        // so the output is larger than the selected limit.
        statusEl.textContent = `Processed ${totalMessages.toLocaleString()} → ${totalKept.toLocaleString()} kept — ⚠ priority messages exceed the token budget (output is larger than the limit).`;
        statusEl.className = 'status-bar';
      } else {
        statusEl.textContent = `Processed ${totalMessages.toLocaleString()} messages → ${totalKept.toLocaleString()} kept`;
        statusEl.className = 'status-bar success';
      }
      $('toStep4').disabled = false;
    })
    .catch((err) => {
      console.error(err);
      statusEl.textContent = 'Error: ' + err.message;
      statusEl.className = 'status-bar error';
      progress.classList.remove('active');
    });
}

// Run the parse + pipeline off-thread in the worker when possible (B3b), falling
// back to the main thread. The accurate-token path always runs inline (the
// worker is approx-only). Returns { outputs, totalMessages, totalFiltered,
// totalKept } with outputs[].finalChunks (Date timestamps) + userMap (Map)
// preserved by structured clone.
async function computeOutputs(validFiles, opts, useAccurate) {
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
      workerBroken = true; // fall through to inline
    }
  }

  const groups = buildGroups(validFiles);
  const fullOpts = { ...opts, countTokens };
  const outputs = [];
  let totalMessages = 0,
    totalFiltered = 0,
    totalKept = 0;
  for (const [, arr] of groups) {
    const r = processGroup(arr, fullOpts);
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

// Render the live preview for one processed channel group (B6).
function renderPreview(idx) {
  const po = processedOutputs[idx];
  if (!po) return;
  const maxTokens = Math.max(1000, parseInt($('maxTokens').value) || 1375000);
  const renderOpts = {
    preamble: $('customPreamble').value,
    redactNames: $('redactNames').checked,
    redactUrls: $('redactUrls').checked,
    redactEmails: $('redactEmails').checked,
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
  const tokenLabel =
    $('useAccurateTokens') && $('useAccurateTokens').checked ? '' : '~';
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
      workerBroken = true;
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
      workerBroken = true;
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

function renderStats(totalRaw, totalFiltered, totalKept, chunks, _userMap) {
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
      <span class="chart-bar-label">${escHtml(uid)}</span>
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
  const maxChars = Math.max(1, parseInt($('maxTokens').value) || 1375000) * 4;
  let budgetHtml = '';
  budgetBars.forEach((b, i) => {
    const pct = Math.max(1, (b.chars / maxChars) * 100);
    const color = BAR_COLORS[i % BAR_COLORS.length];
    const tokens = Math.round(b.chars / 4);
    budgetHtml += `<div class="chart-bar-row">
      <span class="chart-bar-label">${escHtml(b.uid)}</span>
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
  if (processedOutputs.length === 0) return;
  const idx = parseInt($('previewGroup').value) || 0;
  const po = processedOutputs[idx] || processedOutputs[0];
  const maxTokens = Math.max(1000, parseInt($('maxTokens').value) || 1375000);
  const renderOpts = {
    preamble: $('customPreamble').value,
    redactNames: $('redactNames').checked,
    redactUrls: $('redactUrls').checked,
    redactEmails: $('redactEmails').checked,
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
  if (processedOutputs.length === 0) return;
  const format = $('outputFormat').value;
  const maxTokens = Math.max(1000, parseInt($('maxTokens').value) || 1375000);
  const doChunk = $('chunkOutput').checked;
  const overlap = parseInt($('chunkOverlap').value) || 500;
  const renderOpts = {
    preamble: $('customPreamble').value,
    redactNames: $('redactNames').checked,
    redactUrls: $('redactUrls').checked,
    redactEmails: $('redactEmails').checked,
  };

  let dlCount = 0;

  for (const po of processedOutputs) {
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

// Load saved settings on init
loadSettings();
