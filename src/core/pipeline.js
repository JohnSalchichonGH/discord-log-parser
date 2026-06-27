// Core processing pipeline for a single channel group.
// Extracted verbatim from legacy index.html (processGroup).
//
// Phases: build shared userMap -> extract + dedup -> pre-filter
// (date/bots/system/media/whitelist) -> token-budget trim with keyword
// priority -> post-trim low-activity filter.

import { collectAuthors, extractMessages } from '../parsers/html.js';
import { collectAuthorsTxt, extractMessagesTxt } from '../parsers/txt.js';

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
  } = opts;

  // Phase 1: Build shared userMap
  const userMap = new Map();
  const counter = { value: 1 };
  for (const f of sortedFiles)
    f.isTxt
      ? collectAuthorsTxt(f.content, userMap, counter)
      : collectAuthors(f.content, userMap, counter);

  // If useRealNames, replace UIDs with the actual display names
  if (useRealNames) {
    for (const name of userMap.keys()) userMap.set(name, name);
  }

  // Phase 2: Extract + deduplicate
  const seen = new Set();
  const allMessages = [];
  for (const f of sortedFiles) {
    const msgs = f.isTxt
      ? extractMessagesTxt(f.content, userMap)
      : extractMessages(f.content, userMap);
    for (const msg of msgs) {
      const key = msg.messageId
        ? `id:${msg.messageId}`
        : `ts:${msg.timestamp.getTime()}|${msg.authorName}|${(
            msg.contentParts[0] || ''
          ).substring(0, 30)}`;
      if (!seen.has(key)) {
        seen.add(key);
        allMessages.push(msg);
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
    const matchedIds = new Set(
      [...userMap.entries()]
        .filter(([name]) => userFilter.has(name))
        .map(([, uid]) => uid),
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

  // Budget: priority first, then newest normal
  const headerBudget = 400 * 4;
  let currentChars = headerBudget;
  const kept = [];

  // Always keep all priority messages (budget permitting)
  for (const m of priorityMsgs) {
    const cost = m.contentParts.join('\n').length + 15;
    if (currentChars + cost > maxChars) break;
    currentChars += cost;
    kept.push(m);
  }

  // Fill remaining with newest normal messages
  const reversedNormal = [...normalMsgs].reverse();
  const keptNormal = [];
  for (const m of reversedNormal) {
    const cost = m.contentParts.join('\n').length + 15;
    if (currentChars + cost > maxChars) break;
    currentChars += cost;
    keptNormal.push(m);
  }
  keptNormal.reverse();

  let finalChunks = [...kept, ...keptNormal].sort((a, b) => a.timestamp - b.timestamp);

  // Post-trim: low activity filter
  if (minMsgs > 0) {
    const counts = {};
    for (const m of finalChunks) counts[m.authorId] = (counts[m.authorId] || 0) + 1;
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
  };
}
