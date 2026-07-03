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

// Headroom reserved below the user's stated budget. The bundled counters (the
// char estimator and even the exact cl100k BPE tokenizer) run LOOSER than some
// real model tokenizers — notably Gemini, and any non-English text, which
// cl100k splits far more coarsely than Gemini/Gemma — so an output measured at
// the budget here can overshoot it by ~20% in the user's actual model. Trimming
// to a reduced budget keeps the real output within the requested limit.
export const BUDGET_HEADROOM = 0.15;
// The margin applies only to the budget ABOVE this floor, so small exports (a
// few hundred tokens) aren't decimated by the reservation.
const BUDGET_FLOOR = 1000;

// The budget the trim actually targets: the user's limit minus BUDGET_HEADROOM
// of everything above BUDGET_FLOOR. Unit-agnostic (tokens or chars).
export function effectiveBudget(limit) {
  if (!(limit > BUDGET_FLOOR)) return limit;
  return Math.round(
    BUDGET_FLOOR + (limit - BUDGET_FLOOR) * (1 - BUDGET_HEADROOM),
  );
}

// Drop oldest non-priority messages until `measure(messages)` <= maxChars.
// `measure` is the real renderer, so the result is guaranteed to fit (unless the
// retained priority messages alone already exceed the budget, in which case we
// keep them — "always keep" wins over the budget).
//
// Dropping more oldest-first non-priority messages only shrinks the rendered
// output, so "fits after dropping k" is monotonic in k — binary-search the
// smallest such k (O(log n) measures). The old drop-one-measure-everything loop
// re-rendered (and, in accurate mode, re-tokenized) the ENTIRE output once per
// dropped message; over-filled runs at large budgets needed tens of thousands
// of full-text passes and never finished.
export function fitToBudget(messages, maxChars, prioritySet, measure) {
  if (measure(messages) <= maxChars) return messages;
  // Indices of droppable (non-priority) messages, oldest first.
  const droppable = [];
  for (let i = 0; i < messages.length; i++)
    if (!prioritySet.has(messages[i])) droppable.push(i);
  const withoutFirst = (k) => {
    if (k === 0) return messages;
    const gone = new Set(droppable.slice(0, k));
    return messages.filter((_, i) => !gone.has(i));
  };
  // Smallest k in [1, n] that fits; if even dropping all non-priority messages
  // doesn't fit, keep the priority-only set ("always keep" wins).
  let lo = 1;
  let hi = droppable.length;
  if (hi === 0 || measure(withoutFirst(hi)) > maxChars)
    return withoutFirst(droppable.length);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (measure(withoutFirst(mid)) <= maxChars) hi = mid;
    else lo = mid + 1;
  }
  return withoutFirst(lo);
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
