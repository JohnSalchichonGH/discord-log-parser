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
import {
  processGroup,
  getRawMessages,
  getFilteredConversation,
  buildIdentity,
} from './core/pipeline.js';
import { computeAnalytics } from './core/analytics.js';
import { countTokens, disableAccurate } from './core/token-config.js';

disableAccurate(); // worker is approx-only

// key -> { content, isTxt, isJson, _raw }
const cache = new Map();

// Rebuild file objects from the cached parse + the grouping metadata the main
// thread sends, so buildGroups/getFilteredConversation can split by channel.
function reconstructFiles(fileMeta) {
  return fileMeta.map((meta) => {
    const entry = cache.get(meta.key);
    if (!entry) throw new Error('worker cache miss: ' + meta.key);
    return {
      ...entry,
      channelId: meta.channelId,
      baseName: meta.baseName,
      sortOrder: meta.sortOrder,
      afterDate: meta.afterDate,
    };
  });
}

self.onmessage = (e) => {
  const msg = e.data;
  // Echo the request id on every reply so the main thread can match responses
  // to the correct in-flight request (prevents cross-talk between setFiles and
  // process when both are pending).
  const _id = msg._id;
  const post = (obj) => self.postMessage({ ...obj, _id });
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
      post({ type: 'authors', authors: [...authors.entries()] });
    } else if (msg.type === 'process') {
      // Reconstruct file objects from cache + the meta the main thread sends.
      const files = reconstructFiles(msg.fileMeta);

      const groups = buildGroups(files);
      const opts = { ...msg.opts, countTokens };
      // One global identity across ALL files, so a person active in several
      // channels is a single identity with one consistent name everywhere.
      const identity = buildIdentity(files, opts.useRealNames);
      const outputs = [];
      let totalMessages = 0,
        totalFiltered = 0,
        totalKept = 0,
        done = 0;
      for (const [, arr] of groups) {
        const r = processGroup(arr, opts, identity);
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
        done++;
        post({ type: 'progress', done, total: groups.size });
      }
      post({
        type: 'done',
        outputs,
        totalMessages,
        totalFiltered,
        totalKept,
      });
    } else if (msg.type === 'analyze') {
      // Analytics over the FULL filtered conversation across all files, built
      // with the SAME per-channel grouping + one shared identity as the export
      // (so totals reconcile), independent of the token-budget trim.
      const files = reconstructFiles(msg.fileMeta);
      const { filtered } = getFilteredConversation(files, msg.opts);
      post({
        type: 'analytics',
        stats: computeAnalytics(filtered, { tz: msg.tz }),
      });
    } else if (msg.type === 'messages') {
      // Full (timestamp-sorted) filtered conversation as lightweight DTOs, for
      // the message-explorer calendar. Sent once per processing run; the UI
      // buckets by day/hour client-side (so the tz toggle needs no round-trip).
      const files = reconstructFiles(msg.fileMeta);
      const { filtered, userMap } = getFilteredConversation(files, msg.opts);
      post({
        type: 'messages',
        messages: filtered.map((m) => ({
          authorId: m.authorId,
          authorName: m.authorName,
          ts: m.timestamp.getTime(),
          parts: m.contentParts,
          isSystem: m.isSystem,
        })),
        userMap: [...userMap.entries()],
      });
    }
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
};
