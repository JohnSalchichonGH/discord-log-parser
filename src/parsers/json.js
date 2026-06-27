// Parser for DiscordChatExporter JSON exports.
//
// JSON is the most robust input format: timestamps are ISO-8601 with offset
// (locale-independent, no native-Date guessing), message ids are clean
// snowflakes, and the structure is stable. This parser produces the same
// internal message shape as the HTML/TXT parsers so the rest of the pipeline
// and all renderers work unchanged:
//   { messageId, authorName, authorId, timestamp: Date, contentParts, isSystem }

// MessageKind values 1..18 (RecipientAdd..ThreadCreated) are system
// notifications; Default(0), Reply(19), ThreadStarterMessage(21) are not.
// Source: DiscordChatExporter Message.IsSystemNotification.
const SYSTEM_TYPES = new Set([
  'RecipientAdd',
  'RecipientRemove',
  'Call',
  'ChannelNameChange',
  'ChannelIconChange',
  'ChannelPinnedMessage',
  'GuildMemberJoin',
  'ThreadCreated',
]);

// Display name shown by DCE (server nickname falls back to username).
function authorDisplay(author) {
  if (!author) return 'Unknown';
  return (author.nickname || author.name || 'Unknown').trim();
}

function mediaTokenFromFileName(fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext))
    return `[${ext === 'gif' ? 'GIF' : 'IMG'}: ${fileName}]`;
  if (['mp4', 'mov', 'webm'].includes(ext)) return `[VID: ${fileName}]`;
  return `[MEDIA: ${fileName}]`;
}

function embedToken(embed) {
  const title = (embed.title || '').trim();
  if (embed.video && embed.video.url)
    return `[VID: ${title || 'Embedded Video'}]`;
  if (/youtube\.com|youtu\.be/i.test(embed.url || ''))
    return `[YT: ${title || 'Video'}]`;
  if (title) return `[EMBED: ${title}]`;
  return null;
}

// Parse and validate a DCE JSON export string. Throws a clear error otherwise.
export function parseJsonExport(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error('Invalid JSON: ' + e.message);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) {
    throw new Error(
      'Not a DiscordChatExporter JSON export (missing a "messages" array).',
    );
  }
  return data;
}

export function parseJsonHeader(content) {
  const data = parseJsonExport(content);
  const channelId = data.channel?.id || 'json-unknown';
  const guild = data.guild?.name || '';
  const category = data.channel?.category;
  const chan = data.channel?.name || 'unknown';
  const baseName =
    (guild ? guild + ' - ' : '') + (category ? category + ' - ' : '') + chan;
  // dateRange.after marks a partial export; used for the merge-group badge.
  const afterDate = data.dateRange?.after
    ? String(data.dateRange.after).slice(0, 10)
    : null;
  return { channelId, baseName, afterDate };
}

// Unique author display names (for the approximate user-filter list).
export function jsonAuthors(content) {
  const data = parseJsonExport(content);
  const names = new Set();
  for (const m of data.messages) {
    const name = authorDisplay(m.author);
    if (name) names.add(name);
  }
  return names;
}

export function collectAuthorsJson(content, userMap, counter) {
  const data = parseJsonExport(content);
  for (const m of data.messages) {
    const name = authorDisplay(m.author);
    if (name && !userMap.has(name)) userMap.set(name, `U${counter.value++}`);
  }
}

export function extractMessagesJson(content, userMap) {
  const data = parseJsonExport(content);
  const messages = [];

  // Index by id so replies can resolve their referenced message.
  const byId = new Map();
  for (const m of data.messages) byId.set(m.id, m);

  for (const m of data.messages) {
    const authorName = authorDisplay(m.author);
    const authorId = userMap.get(authorName) || authorName;
    const isSystem = SYSTEM_TYPES.has(m.type);
    const contentParts = [];

    // Reply quote (only when the referenced message is present in the export)
    if (m.type === 'Reply' && m.reference?.messageId) {
      const ref = byId.get(m.reference.messageId);
      if (ref) {
        const rName = authorDisplay(ref.author);
        const rId = userMap.has(rName) ? userMap.get(rName) : rName;
        let snip = (ref.content || '').replace(/\n/g, ' ').trim();
        if (snip.length > 80) snip = snip.substring(0, 80) + '…';
        if (!snip) snip = '…';
        contentParts.push(`> ${rId}: ${snip}`);
      }
    }

    // Text content (system messages carry human fallback text in `content`)
    const text = (m.content || '').trim();
    if (text) contentParts.push(text);

    // Forwarded message content + attachments
    if (m.forwardedMessage) {
      const fwdText = (m.forwardedMessage.content || '').trim();
      if (fwdText) contentParts.push(fwdText);
      for (const att of m.forwardedMessage.attachments || [])
        if (att.fileName) contentParts.push(mediaTokenFromFileName(att.fileName));
    }

    // Attachments
    for (const att of m.attachments || [])
      if (att.fileName) contentParts.push(mediaTokenFromFileName(att.fileName));

    // Embeds
    for (const embed of m.embeds || []) {
      const tok = embedToken(embed);
      if (tok) contentParts.push(tok);
    }

    // Stickers
    if ((m.stickers || []).length > 0) contentParts.push('[STICKER]');

    // Reactions: ^{name:count, ...}, merged onto the previous part unless that
    // part is a media token (starts with "[").
    if ((m.reactions || []).length > 0) {
      const reactList = m.reactions.map(
        (r) => `${r.emoji?.name ?? '?'}:${r.count ?? 1}`,
      );
      const formatted = `^{${reactList.join(', ')}}`;
      if (
        contentParts.length > 0 &&
        !contentParts[contentParts.length - 1].startsWith('[')
      )
        contentParts[contentParts.length - 1] += ' ' + formatted;
      else contentParts.push(formatted);
    }

    if (contentParts.length > 0)
      messages.push({
        messageId: m.id || null,
        authorName,
        authorId,
        timestamp: new Date(m.timestamp),
        contentParts,
        isSystem,
      });
  }

  return messages;
}
