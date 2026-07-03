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
        // The File handle, so content can be re-read on demand after it is
        // released (see ensureFileContents) — handles stay readable for the
        // life of the page and cost nothing to hold.
        file,
        channelId: meta.channelId,
        baseName: meta.baseName,
        sortOrder: file.lastModified,
        lastModified: file.lastModified,
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
        file,
        channelId: file.name,
        baseName: file.name,
        sortOrder: file.lastModified,
        lastModified: file.lastModified,
        afterDate: null,
        size: file.size,
        invalid: true,
        error: 'Could not read file.',
      });
    reader.readAsText(file);
  });
}

// Re-read any released content strings from their File handles. The content is
// released once the worker owns the parse (the common case); the main-thread
// (inline) paths — accurate-token processing, or a broken worker — call this
// first so getRawMessages can parse locally again.
export async function ensureFileContents(files) {
  await Promise.all(
    files.map(async (f) => {
      if (f.content == null && f.file) {
        f.content = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = (e) => resolve(e.target.result);
          r.onerror = () => reject(new Error('Could not re-read ' + f.name));
          r.readAsText(f.file);
        });
      }
    }),
  );
}

// Add a batch of File objects, skipping ones already loaded (same name + size),
// then refresh the derived author/summary state.
//
// Files are read and handed to the worker ONE AT A TIME, and each content
// string is released as soon as the worker has parsed it — so the peak memory
// during a 50-file upload is one file's text (plus its clone buffer), not the
// whole set held twice plus a giant single postMessage. Without a worker the
// contents are kept for the inline (main-thread) pipeline.
export async function addFiles(files) {
  const existing = loadedFiles.value;
  const fresh = files.filter(
    (file) =>
      !existing.find((f) => f.name === file.name && f.size === file.size),
  );
  for (const file of fresh) {
    const entry = await readFile(file);
    if (!entry.invalid) await offloadToWorker(entry);
    // Progressive list update — big batches appear as they load.
    loadedFiles.value = [...loadedFiles.value, entry];
  }
  await refresh();
}

// Hand one file's content to the worker (which parses and keeps the result),
// then release the main-thread copy; the File handle remains for re-reads. On
// failure the worker is marked broken and the content stays for inline use.
async function offloadToWorker(entry) {
  const w = getWorker();
  if (!w) return;
  try {
    await workerRequest(w, {
      type: 'addFile',
      key: fileKey(entry),
      content: entry.content,
      isTxt: entry.isTxt,
      isJson: entry.isJson,
    });
    entry.content = null;
  } catch {
    markWorkerBroken();
  }
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
async function inlineAuthors(valid) {
  await ensureFileContents(valid); // released copies re-read from File handles
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
      // Contents were already streamed per-file (addFile); this is just the
      // authoritative key list, so removals evict on the worker side too.
      const res = await workerRequest(w, {
        type: 'setFiles',
        files: valid.map((f) => ({ key: fileKey(f) })),
      });
      entries = res.authors;
    } catch {
      markWorkerBroken();
      entries = await inlineAuthors(valid);
    }
  } else {
    entries = await inlineAuthors(valid);
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
