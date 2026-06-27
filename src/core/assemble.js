// Bridges parse-once "raw messages" to the final message shape used by the
// pipeline and renderers.
//
// Parsers emit raw messages that are independent of any author-id mapping:
//   { messageId, authorName, timestamp, isSystem,
//     replyToName, replySnippet, parts: string[], reactions: string|null }
// The userMap (name -> U1/U2/…) is then built once across all files, and each
// raw message is assembled into { …, authorId, contentParts } cheaply — no
// re-parsing of file content on settings changes.

// Build the shared name -> short-id map in first-seen order across all files.
// Message authors and reply authors are both registered (matches the legacy
// HTML behavior and is consistent for TXT/JSON).
export function buildUserMap(perFileRaw, useRealNames) {
  const userMap = new Map();
  let n = 1;
  const add = (name) => {
    if (name && !userMap.has(name)) userMap.set(name, `U${n++}`);
  };
  for (const msgs of perFileRaw) {
    for (const m of msgs) {
      add(m.authorName);
      if (m.replyToName) add(m.replyToName);
    }
  }
  if (useRealNames) for (const k of userMap.keys()) userMap.set(k, k);
  return userMap;
}

// Assemble a raw message's final contentParts, mapping names to short ids and
// merging the reaction onto the previous part unless that part is a media token.
export function assembleMessage(raw, userMap) {
  const uidOf = (name) => userMap.get(name) || name;
  const contentParts = [];
  if (raw.replyToName != null)
    contentParts.push(`> ${uidOf(raw.replyToName)}: ${raw.replySnippet}`);
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
    authorId: uidOf(raw.authorName),
    timestamp: raw.timestamp,
    contentParts,
    isSystem: raw.isSystem,
  };
}
