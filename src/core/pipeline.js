// Core processing pipeline for a single channel group.
// Extracted verbatim from legacy index.html (processGroup).
//
// Phases: build shared userMap -> extract + dedup -> pre-filter
// (date/bots/system/media/whitelist) -> token-budget trim with keyword
// priority -> post-trim low-activity filter.

import { parseMessages as parseHtml } from '../parsers/html.js';
import { parseMessages as parseTxt } from '../parsers/txt.js';
import { parseMessages as parseJson } from '../parsers/json.js';
import { buildUserMap, assembleMessage } from './assemble.js';
import { messageCost, legendReserve, fitToBudget } from './budget.js';
import { renderTxt } from '../render/txt.js';

// Parse a file's raw (userMap-independent) messages once and memoize them on the
// file object, so re-processing after a settings change never re-parses (B2).
export function getRawMessages(f) {
  if (!f._raw) {
    f._raw = f.isJson
      ? parseJson(f.content)
      : f.isTxt
        ? parseTxt(f.content)
        : parseHtml(f.content);
  }
  return f._raw;
}

export function processGroup(sortedFiles, opts) {
  const {
    minMsgs,
    maxChars,
    userFilter,
    filterBots: doBotFilter,
    botSet,
    filterSystem: doSystemFilter,
    filterMediaOnly: doMediaFilter,
    dateFrom,
    dateTo,
    keywords,
    useRealNames,
    // Optional accurate-token budgeting: when both are provided the verify pass
    // measures real tokens against maxTokens instead of chars against maxChars.
    countTokens,
    maxTokens,
  } = opts;

  // Phase 1: parse once (cached), build the shared userMap, assemble messages.
  const perFileRaw = sortedFiles.map(getRawMessages);
  const { userMap, uidOf } = buildUserMap(perFileRaw, useRealNames);
  const perFileMsgs = perFileRaw.map((rawList) =>
    rawList.map((r) => assembleMessage(r, uidOf)),
  );

  // Phase 2: deduplicate.
  // HTML/JSON messages have stable snowflake ids -> exact dedup. TXT messages
  // have none, so we key on timestamp|author|full-content. To avoid collapsing
  // legitimately-repeated short messages (e.g. "ok" twice in the same minute,
  // B5), we allow each keyless message up to the maximum number of times it
  // appears in any single file (true cross-file overlap is still deduped).
  const keylessKey = (m) =>
    `ts:${m.timestamp.getTime()}|${m.authorName}|${m.contentParts.join('')}`;

  const allowed = new Map(); // keyless key -> max per-file occurrence count
  for (const msgs of perFileMsgs) {
    const perFile = new Map();
    for (const m of msgs) {
      if (m.messageId) continue;
      const k = keylessKey(m);
      perFile.set(k, (perFile.get(k) || 0) + 1);
    }
    for (const [k, c] of perFile)
      allowed.set(k, Math.max(allowed.get(k) || 0, c));
  }

  const seenIds = new Set();
  const keptKeyless = new Map(); // keyless key -> running kept count
  const allMessages = [];
  for (const msgs of perFileMsgs) {
    for (const m of msgs) {
      if (m.messageId) {
        const idk = `id:${m.messageId}`;
        if (seenIds.has(idk)) continue;
        seenIds.add(idk);
        allMessages.push(m);
      } else {
        const k = keylessKey(m);
        const used = keptKeyless.get(k) || 0;
        if (used >= (allowed.get(k) || 1)) continue;
        keptKeyless.set(k, used + 1);
        allMessages.push(m);
      }
    }
  }
  allMessages.sort((a, b) => a.timestamp - b.timestamp);

  // Phase 2.5: Apply pre-filters (date, bots, system, media-only, user whitelist)
  let filtered = allMessages;

  if (dateFrom) filtered = filtered.filter((m) => m.timestamp >= dateFrom);
  if (dateTo) filtered = filtered.filter((m) => m.timestamp <= dateTo);
  if (doBotFilter && botSet.size > 0)
    filtered = filtered.filter((m) => !botSet.has(m.authorName));
  if (doSystemFilter) filtered = filtered.filter((m) => !m.isSystem);
  if (doMediaFilter)
    filtered = filtered.filter((m) => {
      const hasText = m.contentParts.some(
        (p) => !p.startsWith('[') && !p.startsWith('^') && !p.startsWith('>'),
      );
      return hasText;
    });
  if (userFilter && userFilter.size > 0) {
    // userMap is uid -> displayName (#4); the whitelist holds display names.
    const matchedIds = new Set(
      [...userMap.entries()]
        .filter(([, name]) => userFilter.has(name))
        .map(([uid]) => uid),
    );
    filtered = filtered.filter((m) => matchedIds.has(m.authorId));
  }

  // Phase 3: Token-limit trim with keyword priority
  let priorityMsgs = [];
  let normalMsgs = [...filtered];

  if (keywords.length > 0) {
    const patterns = keywords.map((kw) => {
      const rm = kw.match(/^\/(.+)\/([gimsuy]*)$/);
      if (rm)
        try {
          return new RegExp(rm[1], rm[2] || 'i');
        } catch {
          /* ignore */
        }
      return new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    });
    priorityMsgs = [];
    normalMsgs = [];
    for (const m of filtered) {
      const fullText = m.contentParts.join(' ');
      if (patterns.some((p) => p.test(fullText))) priorityMsgs.push(m);
      else normalMsgs.push(m);
    }
  }

  // Budget: keyword-priority messages are ALWAYS kept (per the README); the
  // remaining budget is then filled with the newest normal messages. A
  // verify-and-retrim pass below drops oldest *non-priority* messages so the
  // output provably fits — and if the priority messages alone exceed the budget,
  // they are still all kept (budgetExceeded is reported so the UI can warn).
  let currentChars = legendReserve(userMap.size);
  const kept = [...priorityMsgs]; // keep every priority message
  for (const m of priorityMsgs) currentChars += messageCost(m);

  // Fill remaining with newest normal messages
  const reversedNormal = [...normalMsgs].reverse();
  const keptNormal = [];
  for (const m of reversedNormal) {
    const cost = messageCost(m);
    if (currentChars + cost > maxChars) break;
    currentChars += cost;
    keptNormal.push(m);
  }
  keptNormal.reverse();

  let finalChunks = [...kept, ...keptNormal].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  // A7 verify-and-retrim: measure the actual rendered TXT and drop oldest
  // non-priority messages until it fits within the budget. When an accurate
  // token counter is supplied (B4), measure tokens against maxTokens; otherwise
  // fall back to the char-based estimate against maxChars.
  const prioritySet = new Set(priorityMsgs);
  const limit = countTokens && maxTokens ? maxTokens : maxChars;
  const measure =
    countTokens && maxTokens
      ? (msgs) => countTokens(renderTxt(msgs, userMap, maxTokens, {}))
      : (msgs) => renderTxt(msgs, userMap, Math.round(maxChars / 4), {}).length;
  finalChunks = fitToBudget(finalChunks, limit, prioritySet, measure);
  // True when the retained (priority) messages still exceed the budget.
  const budgetExceeded = finalChunks.length > 0 && measure(finalChunks) > limit;

  // Post-trim: low activity filter
  if (minMsgs > 0) {
    const counts = {};
    for (const m of finalChunks)
      counts[m.authorId] = (counts[m.authorId] || 0) + 1;
    const excluded = new Set(
      Object.keys(counts).filter((uid) => counts[uid] < minMsgs),
    );
    if (excluded.size > 0)
      finalChunks = finalChunks.filter((m) => !excluded.has(m.authorId));
  }

  return {
    finalChunks,
    userMap,
    allMessagesCount: allMessages.length,
    filteredCount: filtered.length,
    budgetExceeded,
  };
}
