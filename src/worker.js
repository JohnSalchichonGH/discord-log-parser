// Web Worker: runs the heavy parse + pipeline off the main thread so large
// exports don't freeze the UI. It is STATEFUL — it parses each file once and
// caches the result (keyed by the main thread's file key), so re-processing
// after a settings change reuses the cached parse (B2) without re-sending file
// contents.
//
// The worker uses the approximate (char/4) token counter only; the accurate BPE
// path runs on the main thread (see app.js), which keeps this bundle small and
// avoids dynamic imports inside an inlined worker.

import { buildGroups } from './core/grouping.js';
import { processGroup, getRawMessages } from './core/pipeline.js';
import { countTokens, disableAccurate } from './core/token-config.js';

disableAccurate(); // worker is approx-only

// key -> { content, isTxt, isJson, _raw }
const cache = new Map();

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'setFiles') {
      // Drop files no longer present; parse (and cache) any new ones.
      const keep = new Set(msg.files.map((f) => f.key));
      for (const k of [...cache.keys()]) if (!keep.has(k)) cache.delete(k);

      const authors = new Map();
      for (const f of msg.files) {
        let entry = cache.get(f.key);
        if (!entry) {
          entry = { content: f.content, isTxt: f.isTxt, isJson: f.isJson };
          getRawMessages(entry); // parses + memoizes entry._raw
          cache.set(f.key, entry);
        }
        for (const m of entry._raw)
          authors.set(m.authorName, (authors.get(m.authorName) || 0) + 1);
      }
      self.postMessage({ type: 'authors', authors: [...authors.entries()] });
    } else if (msg.type === 'process') {
      // Reconstruct file objects from cache + the meta the main thread sends.
      const files = [];
      for (const meta of msg.fileMeta) {
        const entry = cache.get(meta.key);
        if (!entry) throw new Error('worker cache miss: ' + meta.key);
        files.push({
          ...entry,
          channelId: meta.channelId,
          baseName: meta.baseName,
          sortOrder: meta.sortOrder,
          afterDate: meta.afterDate,
        });
      }

      const groups = buildGroups(files);
      const opts = { ...msg.opts, countTokens };
      const outputs = [];
      let totalMessages = 0,
        totalFiltered = 0,
        totalKept = 0,
        done = 0;
      for (const [, arr] of groups) {
        const r = processGroup(arr, opts);
        totalMessages += r.allMessagesCount;
        totalFiltered += r.filteredCount;
        totalKept += r.finalChunks.length;
        outputs.push({
          name: arr[0].baseName,
          finalChunks: r.finalChunks,
          userMap: r.userMap,
          totalRaw: r.allMessagesCount,
          filteredCount: r.filteredCount,
        });
        done++;
        self.postMessage({ type: 'progress', done, total: groups.size });
      }
      self.postMessage({
        type: 'done',
        outputs,
        totalMessages,
        totalFiltered,
        totalKept,
      });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: String((err && err.message) || err),
    });
  }
};
