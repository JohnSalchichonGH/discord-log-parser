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
