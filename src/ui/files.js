// Upload-step logic, DOM-free. Reads the dropped/picked File objects, parses
// their headers, dedupes by name+size, and writes the results into the store
// (loadedFiles / authorEntries / parseSummary). The Preact Upload view +
// UserFilter render from those signals; this module owns the mutation.
//
// Moved verbatim from app.js's file-handling block (addFiles / removeFile /
// onAllFilesLoaded / populateUserFilter) — behavior is preserved, only the
// DOM-render bits became reactive store writes.

import { parseFilename, buildGroups } from '../core/grouping.js';
import { getRawMessages } from '../core/pipeline.js';
import { parseTxtHeader } from '../parsers/txt.js';
import { parseJsonHeader } from '../parsers/json.js';
import {
  getWorker,
  workerRequest,
  fileKey,
  markWorkerBroken,
} from './worker-client.js';
import {
  loadedFiles,
  authorEntries,
  selectedUsers,
  parseSummary,
} from './store.js';

// Only valid (successfully parsed) files take part in grouping, author
// collection, and processing.
export const validFiles = () => loadedFiles.value.filter((f) => !f.invalid);

// Read one File into a loadedFiles entry. JSON is validated at load time so
// malformed files surface loudly (E2) instead of silently producing nothing; a
// failed read (B1) records an invalid entry rather than rejecting, so one bad
// file can't stall the batch.
function readFile(file) {
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

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      let invalid = false,
        error = null;
      if (isTxt) {
        const hdr = parseTxtHeader(content);
        meta.channelId = hdr.channelId;
        meta.baseName = hdr.baseName;
      } else if (isJson) {
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
      resolve({
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
    };
    reader.onerror = () =>
      resolve({
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
    reader.readAsText(file);
  });
}

// Add a batch of File objects, skipping ones already loaded (same name + size),
// then refresh the derived author/summary state.
export async function addFiles(files) {
  const existing = loadedFiles.value;
  const fresh = files.filter(
    (file) =>
      !existing.find((f) => f.name === file.name && f.size === file.size),
  );
  if (fresh.length) {
    const entries = await Promise.all(fresh.map(readFile));
    loadedFiles.value = [...existing, ...entries];
  }
  await refresh();
}

export async function removeFile(idx) {
  const next = loadedFiles.value.slice();
  next.splice(idx, 1);
  loadedFiles.value = next;
  await refresh();
}

// Manual group merge: re-key the selected groups onto the first one's channelId
// + baseName so buildGroups folds them together.
export async function mergeGroups(selectedKeys) {
  if (selectedKeys.length < 2) return;
  const files = loadedFiles.value;
  const targetKey = selectedKeys[0];
  const targetFile = files.find((f) => f.channelId === targetKey);
  const targetBaseName = targetFile ? targetFile.baseName : 'Merged';
  loadedFiles.value = files.map((f) =>
    selectedKeys.includes(f.channelId)
      ? { ...f, channelId: targetKey, baseName: targetBaseName }
      : f,
  );
  await refresh();
}

// Author name → message count, computed on the main thread from cached parses.
function inlineAuthors(valid) {
  const m = new Map();
  for (const f of valid)
    for (const msg of getRawMessages(f))
      m.set(msg.authorName, (m.get(msg.authorName) || 0) + 1);
  return [...m.entries()];
}

// Recompute the author list + parse summary after the file set changes. Parsing
// happens once — off-thread in the worker when available (B3b), else inline on
// the main thread (B2 cache). The author list rebuilds from scratch, so the
// user-filter selection resets (matching the legacy innerHTML re-render).
async function refresh() {
  const valid = validFiles();
  if (!valid.length) {
    authorEntries.value = [];
    selectedUsers.value = new Set();
    parseSummary.value = null;
    return;
  }
  let entries;
  const w = getWorker();
  if (w) {
    try {
      const res = await workerRequest(w, {
        type: 'setFiles',
        files: valid.map((f) => ({
          key: fileKey(f),
          content: f.content,
          isTxt: f.isTxt,
          isJson: f.isJson,
        })),
      });
      entries = res.authors;
    } catch {
      markWorkerBroken();
      entries = inlineAuthors(valid);
    }
  } else {
    entries = inlineAuthors(valid);
  }
  authorEntries.value = entries.slice().sort((a, b) => b[1] - a[1]);
  selectedUsers.value = new Set();
  // Feed the Preact parse-summary card (counts are raw, pre-dedup; the Review
  // step shows deduplicated totals).
  parseSummary.value = {
    messages: entries.reduce((sum, [, c]) => sum + c, 0),
    participants: entries.length,
    files: valid.length,
    channels: buildGroups(valid).size,
  };
}
