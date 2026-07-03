// Web Worker: runs the heavy parse + pipeline off the main thread so large
// exports don't freeze the UI. It is STATEFUL — it parses each file once and
// caches the result (keyed by the main thread's file key), so re-processing
// after a settings change reuses the cached parse (B2) without re-sending file
// contents. On top of that it caches the ASSEMBLED conversation (parse +
// identity + dedup — the expensive phases, which depend only on the files and
// useRealNames), so process/analyze/messages and every per-user filter or
// timezone flip reuse one assembly instead of re-running the whole pipeline
// per request.
//
// The worker uses the approximate (char/4) token counter only; the accurate BPE
// path runs on the main thread (see app.js), which keeps this bundle small and
// avoids dynamic imports inside an inlined worker.

import { buildGroups } from './core/grouping.js';
import {
  getRawMessages,
  buildIdentity,
  assembleGroup,
  applyMessageFilters,
  trimGroup,
} from './core/pipeline.js';
import { computeAnalytics } from './core/analytics.js';
import { countTokens, disableAccurate } from './core/token-config.js';

disableAccurate(); // worker is approx-only

// key -> { content, isTxt, isJson, _raw }
const cache = new Map();

// Rebuild file objects from the cached parse + the grouping metadata the main
// thread sends, so buildGroups can split by channel.
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

// Single-entry cache of the assembled (deduped, identity-resolved, per-group)
// conversation. Everything downstream — pre-filters, token trim, analytics,
// message DTOs — derives from it cheaply. Keyed by the file set + useRealNames,
// the only inputs assembly depends on; filters/dates/tz changes are cache hits.
// Single-entry keeps memory bounded (one assembly alive at a time).
let assembled = null; // { key, userMap, groups: [{ name, allMessages, userMap }] }

function assembledKey(fileMeta, useRealNames) {
  return (
    fileMeta
      .map((m) => m.key)
      .sort()
      .join('\n') + `\n#useRealNames=${!!useRealNames}`
  );
}

function getAssembled(fileMeta, useRealNames) {
  const key = assembledKey(fileMeta, useRealNames);
  if (assembled && assembled.key === key) return assembled;
  const files = reconstructFiles(fileMeta);
  const groups = buildGroups(files);
  // One global identity across ALL files, so a person active in several
  // channels is a single identity with one consistent name everywhere.
  const identity = buildIdentity(files, useRealNames);
  const out = [];
  for (const [, arr] of groups) {
    const { allMessages, userMap } = assembleGroup(arr, useRealNames, identity);
    out.push({ name: arr[0].baseName, allMessages, userMap });
  }
  assembled = { key, userMap: identity.userMap, groups: out };
  return assembled;
}

// The filtered conversation across all groups, time-sorted (what analytics and
// the message explorer consume).
function filteredConversation(fileMeta, opts) {
  const asm = getAssembled(fileMeta, opts.useRealNames);
  const filtered = [];
  for (const g of asm.groups)
    for (const m of applyMessageFilters(g.allMessages, opts, g.userMap))
      filtered.push(m);
  filtered.sort((a, b) => a.timestamp - b.timestamp);
  return { filtered, userMap: asm.userMap };
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
      // Drop files no longer present; parse (and cache) any new ones. The
      // assembled conversation is invalidated by its key when files change, but
      // evict eagerly so removed files' assembly doesn't linger in memory.
      const keep = new Set(msg.files.map((f) => f.key));
      for (const k of [...cache.keys()]) if (!keep.has(k)) cache.delete(k);
      assembled = null;

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
      const opts = { ...msg.opts, countTokens };
      const asm = getAssembled(msg.fileMeta, opts.useRealNames);
      const outputs = [];
      let totalMessages = 0,
        totalFiltered = 0,
        totalKept = 0,
        done = 0;
      for (const g of asm.groups) {
        const filtered = applyMessageFilters(g.allMessages, opts, g.userMap);
        const { finalChunks, budgetExceeded } = trimGroup(
          filtered,
          opts,
          g.userMap,
        );
        totalMessages += g.allMessages.length;
        totalFiltered += filtered.length;
        totalKept += finalChunks.length;
        outputs.push({
          name: g.name,
          finalChunks,
          userMap: g.userMap,
          totalRaw: g.allMessages.length,
          filteredCount: filtered.length,
          budgetExceeded,
        });
        done++;
        post({ type: 'progress', done, total: asm.groups.length });
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
      const { filtered } = filteredConversation(msg.fileMeta, msg.opts);
      post({
        type: 'analytics',
        stats: computeAnalytics(filtered, { tz: msg.tz }),
      });
    } else if (msg.type === 'messages') {
      // Full (timestamp-sorted) filtered conversation as lightweight DTOs, for
      // the message-explorer calendar. Sent once per processing run; the UI
      // buckets by day/hour client-side (so the tz toggle needs no round-trip).
      const { filtered, userMap } = filteredConversation(
        msg.fileMeta,
        msg.opts,
      );
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
