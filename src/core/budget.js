// Token-budget accounting (A7).
//
// The old trim estimated each message as `contentParts.join('\n').length + 15`,
// which undercounts the per-part indentation and ignores the participant legend
// and day dividers — so the rendered output could exceed the requested limit.
//
// We keep a fast, *conservative* estimate for the initial trim, then run a
// verify-and-retrim pass against the real renderer so the output provably fits.

// Conservative per-message char cost mirroring the TXT renderer: each content
// part is emitted as "  <part>\n" (+3) and each message adds an author/timestamp
// header line (~14).
export function messageCost(msg) {
  let c = 14;
  for (const p of msg.contentParts) c += p.length + 3;
  return c;
}

// Reserve for the preamble/header plus one participant-legend line per user.
// Over-reserving (using every known author) is intentionally conservative.
export function legendReserve(userCount) {
  return 200 + userCount * 40;
}

// Drop oldest non-priority messages until `measure(messages)` <= maxChars.
// `measure` is the real renderer, so the result is guaranteed to fit (unless the
// retained priority messages alone already exceed the budget, in which case we
// keep them — "always keep" wins over the budget).
export function fitToBudget(messages, maxChars, prioritySet, measure) {
  if (measure(messages) <= maxChars) return messages;
  const result = messages.slice();
  while (result.length > 0 && measure(result) > maxChars) {
    const idx = result.findIndex((m) => !prioritySet.has(m));
    if (idx === -1) break; // only priority messages remain
    result.splice(idx, 1);
  }
  return result;
}

// Add back excluded messages while the real measure still fits. The greedy fill
// is sized by the fast char estimate, so when the real measure comes in *under*
// it — e.g. accurate token counts on prose that runs more than 4 chars/token —
// the budget is left under-filled and `fitToBudget` (which only ever drops)
// can't recover it. `candidatesNewestFirst` are the excluded non-priority
// messages ordered newest-first (those just outside the kept window). Adding
// more of them only grows the rendered output, so the fit predicate is
// monotonic in the count and we binary-search the largest prefix that fits —
// O(log n) measures, cheaper than re-running the linear drop loop.
export function topUpToBudget(kept, candidatesNewestFirst, maxChars, measure) {
  if (candidatesNewestFirst.length === 0) return kept;
  const byTime = (a, b) => a.timestamp - b.timestamp;
  const fitsWithFirst = (k) =>
    measure([...kept, ...candidatesNewestFirst.slice(0, k)].sort(byTime)) <=
    maxChars;
  // Fast path: everything fits.
  if (fitsWithFirst(candidatesNewestFirst.length)) {
    return [...kept, ...candidatesNewestFirst].sort(byTime);
  }
  // Largest k in [0, n] with fitsWithFirst(k); fitsWithFirst(0) holds because
  // `kept` already fit when it was passed in.
  let lo = 0;
  let hi = candidatesNewestFirst.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fitsWithFirst(mid)) lo = mid;
    else hi = mid - 1;
  }
  return [...kept, ...candidatesNewestFirst.slice(0, lo)].sort(byTime);
}
