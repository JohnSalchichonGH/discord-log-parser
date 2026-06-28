// Bridges parse-once "raw messages" to the final message shape used by the
// pipeline and renderers.
//
// Parsers emit raw messages independent of any author-id mapping:
//   { messageId, authorKey, authorName, timestamp, isSystem,
//     replyToKey, replyToName, replySnippet, parts: string[], reactions }
// `authorKey` is a STABLE Discord user id when the format provides one (HTML
// data-user-id, JSON author.id); it is null for TXT. Identity is keyed by that
// id when present (so a user who changes nickname stays one person, and two
// different users who share a nickname stay separate), falling back to the
// display name only when no id is available.

// Build the identity model once across all files and return:
//   userMap: Map<uid, displayName>   (uid like "U1"; display name is the label)
//   uidOf(key, name): resolves an author's short id from their key + name
export function buildUserMap(perFileRaw, useRealNames) {
  const idToUid = new Map(); // identity string -> uid
  const nameToUid = new Map(); // display name -> uid (fallback for keyless lookups)
  const label = new Map(); // uid -> display name
  let n = 1;

  // A keyed author resolves ONLY by its id (so two different users who share a
  // display name stay separate). A keyless lookup — e.g. an HTML reply, which
  // has no id in the markup — resolves by display name against known authors.
  const resolve = (key, name) =>
    key
      ? idToUid.get(`id:${key}`) || null
      : (name && nameToUid.get(name)) || null;

  const register = (key, name) => {
    const nm = name || '';
    if (!key && !nm) return;
    if (resolve(key, nm)) return; // already known
    const uid = useRealNames ? nm : `U${n++}`;
    idToUid.set(key ? `id:${key}` : `name:${nm}`, uid);
    if (!label.has(uid)) label.set(uid, nm);
    if (nm && !nameToUid.has(nm)) nameToUid.set(nm, uid);
  };

  // Pass 1a: id-backed authors FIRST, so their identities exist before we try to
  // resolve any id-less (TXT) authors against them.
  for (const msgs of perFileRaw)
    for (const m of msgs) if (m.authorKey) register(m.authorKey, m.authorName);
  // Pass 1b: alias each id-backed author's USERNAME (and its pre-"#" handle) to
  // that identity. TXT exports carry no user id and are written by username, so
  // this lets a TXT author (e.g. "kang0420") resolve to the same person as their
  // id-backed nickname (e.g. "k") — preventing split identities and enabling
  // cross-format dedup. Display-name registrations always win over aliases.
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
  // Pass 1c: id-less authors (TXT) — resolve by display name or username alias,
  // minting a new identity only when genuinely unseen.
  for (const msgs of perFileRaw)
    for (const m of msgs) if (!m.authorKey) register(m.authorKey, m.authorName);
  // Pass 2: reply authors only create a new id when genuinely unseen.
  for (const msgs of perFileRaw)
    for (const m of msgs)
      if (m.replyToName || m.replyToKey) register(m.replyToKey, m.replyToName);

  const uidOf = (key, name) => resolve(key, name) || name || '';
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
  };
}
