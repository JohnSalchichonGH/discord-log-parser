// Bridges parse-once "raw messages" to the final message shape used by the
// pipeline and renderers.
//
// Parsers emit raw messages independent of any author-id mapping:
//   { messageId, authorKey, authorName, authorUsername, timestamp, isSystem,
//     replyToKey, replyToName, replySnippet, parts: string[], reactions }
// `authorKey` is a STABLE Discord user id when the format provides one (HTML
// data-user-id, JSON author.id); it is null for TXT.

// Names Discord/DCE shows for accounts with no real nickname available.
const PLACEHOLDER = /^(deleted user|unknown|deleted_user.*)$/i;

// Username similarity (Levenshtein) — used to recognize one person's renamed/
// remade accounts (e.g. cheezy_mcsqueezy0w0 / 0_0 / 0.0).
function editDistance(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = a.length,
    k = b.length;
  if (!m) return k;
  if (!k) return m;
  let prev = Array.from({ length: k + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= k; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[k];
}
function usernameSimilar(a, b) {
  if (!a || !b) return false;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length) >= 0.6;
}

const ALT_OVERLAP_TOLERANCE_MS = 7 * 24 * 60 * 60 * 1000; // a week of transition

const pushTo = (map, key, val) => {
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
};

// Build the identity model once across all files and return:
//   userMap: Map<uid, displayLabel>   (uid is a stable internal id like "U1")
//   uidOf(key, name): resolves an author's uid from their key + name
//
// Identity is keyed by Discord user id when present; id-less (TXT) authors are
// matched by display name or by an aliased username. One person's renamed/remade
// accounts (same nickname + similar username + non-overlapping activity) are
// merged. Each identity is labeled with its most recent REAL nickname (deleted/
// placeholder names are skipped when a real one exists); identities that still
// collide on a label are disambiguated ("kot", "kot (2)").
export function buildUserMap(perFileRaw, useRealNames) {
  const idToUid = new Map(); // 'id:<key>' | 'name:<nm>' -> uid
  const nameToUid = new Map(); // display name / username alias -> uid
  let n = 1;

  const resolve = (key, name) =>
    key
      ? idToUid.get(`id:${key}`) || null
      : (name && nameToUid.get(name)) || null;

  const register = (key, name) => {
    const nm = (name || '').trim();
    if (!key && !nm) return;
    if (resolve(key, nm)) return; // already known
    const uid = `U${n++}`;
    idToUid.set(key ? `id:${key}` : `name:${nm}`, uid);
    if (nm && !nameToUid.has(nm)) nameToUid.set(nm, uid);
  };

  // Pass 1a: id-backed authors first, so their identities exist before id-less
  // (TXT) authors are resolved against them.
  for (const msgs of perFileRaw)
    for (const m of msgs) if (m.authorKey) register(m.authorKey, m.authorName);
  // Pass 1b: alias each id-backed author's USERNAME (and pre-"#" handle) so an
  // id-less TXT author written by username resolves to the same person.
  for (const msgs of perFileRaw)
    for (const m of msgs) {
      if (!m.authorKey || !m.authorUsername) continue;
      const uid = resolve(m.authorKey, m.authorName);
      if (!uid) continue;
      for (const alias of [m.authorUsername, m.authorUsername.split('#')[0]]) {
        const a = (alias || '').trim();
        if (a && !nameToUid.has(a)) nameToUid.set(a, uid);
      }
    }
  // Pass 1c: id-less (TXT) authors.
  for (const msgs of perFileRaw)
    for (const m of msgs) if (!m.authorKey) register(m.authorKey, m.authorName);
  // Pass 2: reply authors (only mint when genuinely unseen).
  for (const msgs of perFileRaw)
    for (const m of msgs)
      if (m.replyToName || m.replyToKey) register(m.replyToKey, m.replyToName);

  // Pass 3: gather per-uid observations (name candidates + activity window).
  const info = new Map();
  const better = (slot, name, ts) => {
    if (!slot.name || ts >= slot.ts) {
      slot.name = name;
      slot.ts = ts;
    }
  };
  for (const msgs of perFileRaw)
    for (const m of msgs) {
      const uid = resolve(m.authorKey, m.authorName);
      if (!uid) continue;
      const nm = (m.authorName || '').trim();
      const ts = m.timestamp ? m.timestamp.getTime() : 0;
      let e = info.get(uid);
      if (!e) {
        e = {
          uid,
          idBacked: false,
          username: null,
          count: 0,
          min: ts,
          max: ts,
          realId: { name: null, ts: -1 }, // latest real nick from an id-backed msg
          realNoId: { name: null, ts: -1 }, // latest real name from a TXT msg
          any: { name: null, ts: -1 }, // latest name of any kind (placeholder fallback)
        };
        info.set(uid, e);
      }
      e.count++;
      if (ts < e.min) e.min = ts;
      if (ts > e.max) e.max = ts;
      if (m.authorKey) {
        e.idBacked = true;
        if (m.authorUsername && !e.username)
          e.username = m.authorUsername.trim();
      }
      if (nm) {
        better(e.any, nm, ts);
        if (!PLACEHOLDER.test(nm))
          better(m.authorKey ? e.realId : e.realNoId, nm, ts);
      }
    }
  const nickOf = (e) => e.realId.name || e.realNoId.name || e.any.name || e.uid;

  // Auto-merge alts: id-backed identities sharing a nickname, with similar
  // usernames and (near-)disjoint activity, are one person who remade accounts.
  const parent = new Map([...info.keys()].map((u) => [u, u]));
  const find = (u) => {
    while (parent.get(u) !== u) {
      parent.set(u, parent.get(parent.get(u)));
      u = parent.get(u);
    }
    return u;
  };
  const union = (a, b) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const byNick = new Map();
  for (const e of info.values()) {
    if (!e.idBacked) continue;
    const nk = nickOf(e);
    if (PLACEHOLDER.test(nk)) continue; // never auto-merge "Deleted User" et al.
    pushTo(byNick, nk.toLowerCase(), e);
  }
  for (const group of byNick.values())
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i],
          b = group[j];
        if (!usernameSimilar(a.username, b.username)) continue;
        const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
        if (overlap <= ALT_OVERLAP_TOLERANCE_MS) union(a.uid, b.uid);
      }

  // Canonicalize each merge group to its busiest member, and remap the resolver
  // maps so uidOf() returns the canonical id.
  const members = new Map();
  for (const u of info.keys()) pushTo(members, find(u), u);
  const remap = new Map();
  for (const group of members.values()) {
    let canon = group[0];
    for (const u of group)
      if (info.get(u).count > info.get(canon).count) canon = u;
    for (const u of group) remap.set(u, canon);
  }
  for (const [k, u] of idToUid) idToUid.set(k, remap.get(u) || u);
  for (const [k, u] of nameToUid) nameToUid.set(k, remap.get(u) || u);

  // Fold observations into canonical ids and pick each label.
  const canon = new Map();
  for (const [u, e] of info) {
    const c = remap.get(u) || u;
    let ci = canon.get(c);
    if (!ci) {
      ci = {
        count: 0,
        realId: { name: null, ts: -1 },
        realNoId: { name: null, ts: -1 },
        any: { name: null, ts: -1 },
      };
      canon.set(c, ci);
    }
    ci.count += e.count;
    for (const slot of ['realId', 'realNoId', 'any'])
      if (e[slot].name) better(ci[slot], e[slot].name, e[slot].ts);
  }
  const label = new Map();
  for (const [c, ci] of canon)
    label.set(c, ci.realId.name || ci.realNoId.name || ci.any.name || c);

  // Disambiguate distinct identities that still share a label (e.g. two real
  // "kot"s): the busiest keeps the clean name; the rest get "(2)", "(3)"…
  const byLabel = new Map();
  for (const [c] of label) pushTo(byLabel, label.get(c), c);
  for (const ids of byLabel.values()) {
    if (ids.length < 2) continue;
    ids.sort((a, b) => canon.get(b).count - canon.get(a).count);
    ids.forEach((c, i) => {
      if (i > 0) label.set(c, `${label.get(c)} (${i + 1})`);
    });
  }

  // Ensure every identity that can appear in a reply token — including reply-only
  // ones that never authored a message — has a label, so the viewer and export
  // never fall back to a raw uid like "U598".
  const nameByUid = new Map();
  for (const [nm, u] of nameToUid) if (!nameByUid.has(u)) nameByUid.set(u, nm);
  for (const u of new Set([...idToUid.values(), ...nameToUid.values()]))
    if (!label.has(u)) label.set(u, nameByUid.get(u) || u);

  const uidOf = (key, name) => resolve(key, name) || name || '';

  // "Use real names" mode: the export uses the real name as each author's token,
  // so re-key identities by their LABEL. Labels are unique after disambiguation,
  // so this can no longer collapse distinct people (the old useRealNames bug) —
  // and merges/renames are already resolved, so it's the correct current name.
  if (useRealNames) {
    const toLabel = new Map(label);
    for (const [k, u] of idToUid) idToUid.set(k, toLabel.get(u) || u);
    for (const [k, u] of nameToUid) nameToUid.set(k, toLabel.get(u) || u);
    const named = new Map();
    for (const lbl of label.values()) named.set(lbl, lbl);
    return { userMap: named, uidOf };
  }
  return { userMap: label, uidOf };
}

// Assemble a raw message's final contentParts, mapping author identity to a short
// id and merging the reaction onto the previous part unless it is a media token.
export function assembleMessage(raw, uidOf) {
  const contentParts = [];
  if (raw.replyToName != null)
    contentParts.push(
      `> ${uidOf(raw.replyToKey, raw.replyToName)}: ${raw.replySnippet}`,
    );
  for (const p of raw.parts) contentParts.push(p);
  if (raw.reactions) {
    if (
      contentParts.length > 0 &&
      !contentParts[contentParts.length - 1].startsWith('[')
    )
      contentParts[contentParts.length - 1] += ' ' + raw.reactions;
    else contentParts.push(raw.reactions);
  }
  return {
    messageId: raw.messageId,
    authorName: raw.authorName,
    authorId: uidOf(raw.authorKey, raw.authorName),
    timestamp: raw.timestamp,
    contentParts,
    isSystem: raw.isSystem,
    replyToMessageId: raw.replyToMessageId || null,
  };
}
