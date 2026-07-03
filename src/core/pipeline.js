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
import { buildGroups } from './grouping.js';
import {
  messageCost,
  legendReserve,
  fitToBudget,
  topUpToBudget,
} from './budget.js';
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

// Normalized text for cross-format matching (dedup signatures, the identity
// bridge, and TXT clock anchoring). HTML exports carry RENDERED text (markdown
// stripped by the renderer, custom/unicode emoji as <img> that contribute no
// text), while JSON/TXT carry RAW markdown — so the same message reads
// "**hi** :pog:" in one file and "hi" in another. Strip markdown syntax,
// collapse [label](url) to its label, and drop emoji shortcodes/pictographs so
// all three formats normalize to the same string. Signature-only: message
// content is never modified.
const EMOJI_RE = /\p{Extended_Pictographic}|[\u{FE0F}\u{200D}]/gu;
function normText(parts) {
  return (
    parts
      // Collapse markdown links BEFORE the media-token filter: a message that
      // STARTS with "[label](url)" would otherwise be mistaken for a media
      // token (they also start with "[") and dropped from the signature.
      .map((p) => p.replace(/\[([^\]]*)\]\(\S*?\)/g, '$1'))
      .filter((p) => !p.startsWith('[') && !p.startsWith('> '))
      .map((p) => p.replace(/\^\{[^}]*\}/g, ''))
      .join(' ')
      .replace(/:[a-z0-9_+-]+:/gi, '')
      .replace(EMOJI_RE, '')
      .replace(/[*_~`|\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
}
// Memoized per assembled message (text parts never change after assembly; the
// phases that rewrite reply tokens only touch "> " parts, which normText skips).
// WeakMap rather than a property so the memo is never structured-cloned to the
// main thread and dies with the message objects.
const normCache = new WeakMap();
function normOf(m) {
  let t = normCache.get(m);
  if (t === undefined) normCache.set(m, (t = normText(m.contentParts)));
  return t;
}
// Texts this long are effectively unique per author+day; shorter ones ("lol",
// "ok") collide by coincidence, so evidence-style matching only counts these.
const DISTINCTIVE_LEN = 12;

// Parse + assemble + dedup ONE channel group into its full conversation (the
// expensive phases 1–2), WITHOUT the pre-filters. The result depends only on
// the files and the identity model (useRealNames) — every pre-filter
// (date/bots/system/media/whitelist) is applied after dedup — so callers (the
// worker) can cache it and re-apply cheap filters per request. When `identity`
// is supplied it is used instead of building a per-call one, unifying identity
// across channels.
export function assembleGroup(sortedFiles, useRealNames, identity) {
  // Phase 1: parse once (cached), build the shared userMap, assemble messages.
  const perFileRaw = sortedFiles.map(getRawMessages);
  const { userMap, uidOf } = identity || buildUserMap(perFileRaw, useRealNames);
  const perFileMsgs = perFileRaw.map((rawList) =>
    rawList.map((r) => assembleMessage(r, uidOf)),
  );

  // Phase 1.4: anchor each TXT file's clock to true UTC. TXT timestamps are the
  // EXPORT machine's local wall clock, but parseTimestamp can only read them as
  // the VIEWER's local time — if those timezones differ, every TXT message is
  // shifted, which breaks ordering AND the UTC-day dedup key (duplicates leak in
  // near midnight). Estimate each TXT file's offset from its own id-bearing
  // twins: for messages whose (author + distinctive text) matches an id-bearing
  // message nearby, take the median time delta, rounded to 5 minutes (real
  // timezone offsets are multiples of 15). Only applied when the samples agree
  // (>= 10 matches, >= 60% within ±90s of the estimate — the slack covers TXT's
  // truncated seconds), so a file is never shifted on flimsy evidence; TXT-only
  // groups are left untouched (nothing to anchor to).
  const hasTxtFiles = sortedFiles.some((f) => f.isTxt);
  const hasKeyedFiles = sortedFiles.some((f) => !f.isTxt);
  if (hasTxtFiles && hasKeyedFiles) {
    const byAuthorText = new Map(); // authorId \t text -> id-bearing times (ms)
    for (let i = 0; i < perFileMsgs.length; i++) {
      if (sortedFiles[i].isTxt) continue;
      for (const m of perFileMsgs[i]) {
        const t = normOf(m);
        if (t.length < DISTINCTIVE_LEN) continue;
        const k = m.authorId + '\t' + t;
        let arr = byAuthorText.get(k);
        if (!arr) byAuthorText.set(k, (arr = []));
        arr.push(m.timestamp.getTime());
      }
    }
    const DAY_WINDOW = 26 * 3600e3; // widest plausible tz gap, plus slack
    for (let i = 0; i < perFileMsgs.length; i++) {
      if (!sortedFiles[i].isTxt) continue;
      const deltas = [];
      for (const m of perFileMsgs[i]) {
        const t = normOf(m);
        if (t.length < DISTINCTIVE_LEN) continue;
        const cands = byAuthorText.get(m.authorId + '\t' + t);
        if (!cands) continue;
        const ts = m.timestamp.getTime();
        let best = null;
        for (const c of cands) {
          const d = ts - c;
          if (best === null || Math.abs(d) < Math.abs(best)) best = d;
        }
        if (best !== null && Math.abs(best) <= DAY_WINDOW) deltas.push(best);
      }
      if (deltas.length < 10) continue;
      deltas.sort((a, b) => a - b);
      const median = deltas[deltas.length >> 1];
      const offset = Math.round(median / 300000) * 300000; // nearest 5 min
      if (offset === 0) continue; // already aligned
      const close = deltas.filter((d) => Math.abs(d - offset) <= 90000).length;
      if (close < deltas.length * 0.6) continue; // inconsistent — don't touch
      for (const m of perFileMsgs[i])
        m.timestamp = new Date(m.timestamp.getTime() - offset);
    }
  }

  // Phase 1.5: message-content identity bridge (only when TXT is mixed with an
  // id-bearing format). A renamed user can appear under different names across
  // exports — e.g. an older TXT shows an old nick, a newer JSON a new username —
  // and if that old nick was never seen in an id-bearing export, name/username
  // aliasing can't link them, so the SAME messages survive under two identities.
  // Link them by the messages themselves: a keyless (TXT) author whose messages
  // overwhelmingly match one id-bearing identity (same normalized text + UTC day)
  // IS that identity. Only DISTINCTIVE texts count as evidence — long enough to
  // be effectively unique per author+day — so coincidental collisions ("lol",
  // "ok") can neither create nor pad a match. With that quality bar the volume
  // bar can be low (>= 3 matches and >= 60% of the author's distinctive texts),
  // which unifies renamed users who only overlap in a handful of messages
  // instead of stranding them as a duplicate identity.
  if (hasTxtFiles && hasKeyedFiles) {
    const ckey = (m) => {
      const t = normOf(m);
      return t.length >= DISTINCTIVE_LEN
        ? t + '\t' + m.timestamp.toISOString().slice(0, 10)
        : null;
    };
    const keyedAt = new Map(); // content+day -> id-bearing identity
    for (const msgs of perFileMsgs)
      for (const m of msgs) {
        if (!m.messageId) continue;
        const k = ckey(m);
        if (k && !keyedAt.has(k)) keyedAt.set(k, m.authorId);
      }
    const votes = new Map(); // keyless authorId -> Map(keyed authorId -> count)
    const total = new Map(); // keyless authorId -> count of text-bearing messages
    for (const msgs of perFileMsgs)
      for (const m of msgs) {
        if (m.messageId) continue;
        const k = ckey(m);
        if (!k) continue;
        total.set(m.authorId, (total.get(m.authorId) || 0) + 1);
        const keyed = keyedAt.get(k);
        if (!keyed || keyed === m.authorId) continue;
        let v = votes.get(m.authorId);
        if (!v) votes.set(m.authorId, (v = new Map()));
        v.set(keyed, (v.get(keyed) || 0) + 1);
      }
    const bridge = new Map(); // keyless authorId -> id-bearing authorId
    for (const [kl, v] of votes) {
      let best = null,
        bestC = 0;
      for (const [aid, c] of v)
        if (c > bestC) {
          bestC = c;
          best = aid;
        }
      if (best && bestC >= 3 && bestC >= 0.6 * (total.get(kl) || 0))
        bridge.set(kl, best);
    }
    if (bridge.size)
      for (const msgs of perFileMsgs)
        for (const m of msgs) {
          const to = bridge.get(m.authorId);
          if (to) m.authorId = to;
          // A reply pointing at a bridged author embeds the old uid in its
          // "> uid: snippet" token; re-point it so the reply shows the canonical
          // name instead of a stale id.
          const p0 = m.contentParts[0];
          if (p0 && p0.startsWith('> ')) {
            const c = p0.indexOf(':');
            const ru = c > 2 ? bridge.get(p0.slice(2, c).trim()) : null;
            if (ru) m.contentParts[0] = '> ' + ru + p0.slice(c);
          }
        }
  }

  // Phase 1.6: resolve reply targets by the REFERENCED MESSAGE ID. An HTML reply
  // carries the displayed nickname of the target (which may be an old name that
  // resolved to a different/keyless identity) plus the referenced message's
  // snowflake. Re-point the reply token to that message's actual (canonical)
  // author so a reply shows the same identity as the message it replies to.
  let hasReplyRefs = false;
  for (const msgs of perFileMsgs) {
    for (const m of msgs)
      if (m.replyToMessageId) {
        hasReplyRefs = true;
        break;
      }
    if (hasReplyRefs) break;
  }
  if (hasReplyRefs) {
    const authorByMsgId = new Map();
    for (const msgs of perFileMsgs)
      for (const m of msgs)
        if (m.messageId && !authorByMsgId.has(m.messageId))
          authorByMsgId.set(m.messageId, m.authorId);
    for (const msgs of perFileMsgs)
      for (const m of msgs) {
        if (!m.replyToMessageId) continue;
        const a = authorByMsgId.get(m.replyToMessageId);
        if (!a) continue;
        const p0 = m.contentParts[0];
        if (p0 && p0.startsWith('> ')) {
          const c = p0.indexOf(':');
          if (c > 2) m.contentParts[0] = '> ' + a + p0.slice(c);
        }
      }
  }

  // Canonicalize the display name to the identity's label, so a person who
  // appears under different strings across formats (TXT username vs HTML/JSON
  // nickname) shows under ONE consistent name everywhere downstream.
  for (const msgs of perFileMsgs)
    for (const m of msgs)
      m.authorName = userMap.get(m.authorId) || m.authorName;

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
  const sigOf = (m) =>
    `${m.authorId}\t${m.timestamp.toISOString().slice(0, 10)}\t${normOf(m)}`;

  // Pass A: dedup id-bearing messages by snowflake id, keeping the BEST copy of
  // each: JSON over HTML (raw markdown over rendered text — richer content, and
  // its signature is what a TXT twin will produce), and within a format the
  // later file (so an edited message keeps the newest export's content). This
  // is deterministic — file modification times no longer decide which copy of a
  // message survives.
  const bestById = new Map(); // messageId -> { m, rank, idx }
  for (let i = 0; i < perFileMsgs.length; i++) {
    const rank = sortedFiles[i].isJson ? 2 : sortedFiles[i].isTxt ? 0 : 1;
    for (const m of perFileMsgs[i]) {
      if (!m.messageId) continue;
      const prev = bestById.get(m.messageId);
      if (!prev || rank > prev.rank || (rank === prev.rank && i > prev.idx))
        bestById.set(m.messageId, { m, rank, idx: i });
    }
  }
  const keyedSig = new Map(); // signature -> count among kept id-bearing messages
  const keyed = [];
  for (const { m } of bestById.values()) {
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
    for (const [s, c] of perFile)
      allowed.set(s, Math.max(allowed.get(s) || 0, c));
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

  return { allMessages, userMap };
}

// Phase 2.5: the pre-filters (date, bots, system, media-only, user whitelist),
// applied to an assembled/deduped conversation. Cheap (array passes), safe to
// re-run per request against a cached assembleGroup result; never mutates the
// messages.
export function applyMessageFilters(allMessages, opts, userMap) {
  const {
    userFilter,
    filterBots: doBotFilter,
    botSet,
    filterSystem: doSystemFilter,
    filterMediaOnly: doMediaFilter,
    dateFrom,
    dateTo,
  } = opts;

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

  return filtered;
}

// Parse + dedup + apply the pre-filters, returning ONE channel group's full
// filtered conversation (NOT token-trimmed) — assembleGroup + the filters in
// one call, for callers without a cache. The export pipeline (processGroup) and
// the analytics (getFilteredConversation) both use this per channel group with
// the SAME shared identity, so their message sets reconcile.
export function getFilteredMessages(sortedFiles, opts, identity) {
  const { allMessages, userMap } = assembleGroup(
    sortedFiles,
    opts.useRealNames,
    identity,
  );
  const filtered = applyMessageFilters(allMessages, opts, userMap);
  return { filtered, userMap, allMessagesCount: allMessages.length };
}

// The full filtered conversation across ALL files, assembled exactly as the
// export does: split into channel groups and deduped per group under ONE shared
// identity. This is the single source of truth for the Insights / Calendar /
// Wrapped analytics, so their totals reconcile with the export. The only
// differences that remain are scope by design: analytics cover this whole set,
// while Summary/Transcript reflect the token-trimmed, low-activity-filtered
// export.
export function getFilteredConversation(files, opts) {
  const groups = buildGroups(files);
  const identity = buildIdentity(files, opts.useRealNames);
  const filtered = [];
  for (const [, arr] of groups)
    for (const m of getFilteredMessages(arr, opts, identity).filtered)
      filtered.push(m);
  filtered.sort((a, b) => a.timestamp - b.timestamp);
  return { filtered, userMap: identity.userMap };
}

export function processGroup(sortedFiles, opts, identity) {
  const { filtered, userMap, allMessagesCount } = getFilteredMessages(
    sortedFiles,
    opts,
    identity,
  );
  const { finalChunks, budgetExceeded } = trimGroup(filtered, opts, userMap);
  return {
    finalChunks,
    userMap,
    allMessagesCount,
    filteredCount: filtered.length,
    budgetExceeded,
  };
}

// Phases 3+ of the export pipeline: token-budget trim with keyword priority,
// verify-and-retrim, top-up, and the post-trim low-activity filter — applied to
// an already-filtered conversation. Split out so the worker can run it against
// a cached assembleGroup result without re-running assembly/dedup.
export function trimGroup(filtered, opts, userMap) {
  const { minMsgs, maxChars, keywords, countTokens, maxTokens } = opts;

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
  // A7b top-up: the greedy fill above is sized by the char estimate, so the
  // real measure can land under budget (notably in accurate-token mode). Add
  // back the newest excluded normal messages while the real measure still fits.
  const inFinal = new Set(finalChunks);
  const leftover = normalMsgs
    .filter((m) => !inFinal.has(m))
    .sort((a, b) => b.timestamp - a.timestamp); // newest-first (just outside window)
  finalChunks = topUpToBudget(finalChunks, leftover, limit, measure);
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

  return { finalChunks, budgetExceeded };
}
