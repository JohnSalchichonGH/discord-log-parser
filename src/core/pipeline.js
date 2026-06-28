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

// Build the shared identity (userMap + uidOf) across a set of files. Pass the
// result into getFilteredMessages/processGroup so every channel group resolves
// people against ONE global identity space — a person active in several channels
// is one identity, with one consistent (most-recent) name everywhere.
export function buildIdentity(files, useRealNames) {
  return buildUserMap(files.map(getRawMessages), useRealNames);
}

// Parse + dedup + apply the pre-filters (date/bots/system/media/whitelist),
// returning the full filtered conversation (NOT token-trimmed). Shared by the
// export pipeline (processGroup) and the Insights analytics so both see the
// same set of messages. When `identity` is supplied it is used instead of
// building a per-call (per-group) one, unifying identity across channels.
export function getFilteredMessages(sortedFiles, opts, identity) {
  const {
    userFilter,
    filterBots: doBotFilter,
    botSet,
    filterSystem: doSystemFilter,
    filterMediaOnly: doMediaFilter,
    dateFrom,
    dateTo,
    useRealNames,
  } = opts;

  // Phase 1: parse once (cached), build the shared userMap, assemble messages.
  const perFileRaw = sortedFiles.map(getRawMessages);
  const { userMap, uidOf } = identity || buildUserMap(perFileRaw, useRealNames);
  const perFileMsgs = perFileRaw.map((rawList) =>
    rawList.map((r) => assembleMessage(r, uidOf)),
  );
  // Canonicalize the display name to the identity's label, so a person who
  // appears under different strings across formats (TXT username vs HTML/JSON
  // nickname) shows under ONE consistent name everywhere downstream.
  for (const msgs of perFileMsgs)
    for (const m of msgs) m.authorName = userMap.get(m.authorId) || m.authorName;

  // Phase 2: deduplicate.
  //
  // HTML/JSON messages have stable snowflake ids -> exact dedup by id.
  //
  // TXT messages have neither a message id nor a user id, and their clock is
  // minute-resolution in an unknown timezone — so they can't be matched to their
  // HTML/JSON twin by id or exact time. Instead a keyless message is identified
  // by a content signature: resolved author id + UTC day + normalized text.
  // (Author identity is unified across formats via username aliasing in
  // buildUserMap, so the TXT and HTML/JSON copies share an author id.)
  //
  // Keeping the union without duplicates: an id-bearing message is authoritative.
  // A keyless message is kept only to the extent its per-file count EXCEEDS what
  // the id-bearing messages already cover for that signature — so a TXT copy of
  // an HTML/JSON message is dropped, but a message only the TXT captured (e.g.
  // since-deleted) still survives. Legit same-text repeats within a file are
  // preserved by counting the max occurrences in any single file (B5).
  const norm = (parts) =>
    parts
      .filter((p) => !p.startsWith('[') && !p.startsWith('> '))
      .map((p) => p.replace(/\^\{[^}]*\}/g, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const sigOf = (m) =>
    `${m.authorId}\t${m.timestamp.toISOString().slice(0, 10)}\t${norm(m.contentParts)}`;

  // Pass A: dedup id-bearing messages by snowflake id; tally their signatures.
  const seenIds = new Set();
  const keyedSig = new Map(); // signature -> count among kept id-bearing messages
  const keyed = [];
  for (const msgs of perFileMsgs)
    for (const m of msgs) {
      if (!m.messageId) continue;
      const idk = `id:${m.messageId}`;
      if (seenIds.has(idk)) continue;
      seenIds.add(idk);
      keyed.push(m);
      const s = sigOf(m);
      keyedSig.set(s, (keyedSig.get(s) || 0) + 1);
    }

  // Pass B: keyless cap per signature = max per-file occurrences (handles TXT/TXT
  // overlap + legit repeats), minus what id-bearing messages already cover.
  const allowed = new Map();
  for (const msgs of perFileMsgs) {
    const perFile = new Map();
    for (const m of msgs) {
      if (m.messageId) continue;
      const s = sigOf(m);
      perFile.set(s, (perFile.get(s) || 0) + 1);
    }
    for (const [s, c] of perFile) allowed.set(s, Math.max(allowed.get(s) || 0, c));
  }
  const keptKeyless = new Map();
  const allMessages = [...keyed];
  for (const msgs of perFileMsgs)
    for (const m of msgs) {
      if (m.messageId) continue;
      const s = sigOf(m);
      const cap = Math.max(0, (allowed.get(s) || 0) - (keyedSig.get(s) || 0));
      const used = keptKeyless.get(s) || 0;
      if (used >= cap) continue;
      keptKeyless.set(s, used + 1);
      allMessages.push(m);
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
  // Filter by stable author id (uid). Used by the Insights panel, which keys
  // users by id — robust when a user has different display names across merged
  // files (where filtering by name would miss messages).
  if (opts.userFilterIds && opts.userFilterIds.size > 0)
    filtered = filtered.filter((m) => opts.userFilterIds.has(m.authorId));

  return { filtered, userMap, allMessagesCount: allMessages.length };
}

export function processGroup(sortedFiles, opts, identity) {
  const { minMsgs, maxChars, keywords, countTokens, maxTokens } = opts;
  const { filtered, userMap, allMessagesCount } = getFilteredMessages(
    sortedFiles,
    opts,
    identity,
  );

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
    allMessagesCount,
    filteredCount: filtered.length,
    budgetExceeded,
  };
}
