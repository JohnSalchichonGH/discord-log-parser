// Parser for DiscordChatExporter JSON exports. Parses ONCE into userMap-
// independent raw messages (see core/assemble.js).
//
// JSON is the most robust input format: ISO-8601 timestamps (locale-independent),
// clean snowflake ids, and a stable structure.

// MessageKind values 1..18 (RecipientAdd..ThreadCreated) are system
// notifications; Default(0), Reply(19), ThreadStarterMessage(21) are not.
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
    throw new Error('Invalid JSON: ' + e.message, { cause: e });
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
  const afterDate = data.dateRange?.after
    ? String(data.dateRange.after).slice(0, 10)
    : null;
  return { channelId, baseName, afterDate };
}

export function parseMessages(content) {
  const data = parseJsonExport(content);
  const messages = [];

  // Index by id so replies can resolve their referenced message.
  const byId = new Map();
  for (const m of data.messages) byId.set(m.id, m);

  for (const m of data.messages) {
    // Skip messages with an unparseable timestamp — an Invalid Date would later
    // throw in renderJSON's toISOString() and corrupt sorting elsewhere.
    const timestamp = new Date(m.timestamp);
    if (isNaN(timestamp.getTime())) continue;

    const isSystem = SYSTEM_TYPES.has(m.type);
    let replyToKey = null,
      replyToName = null,
      replySnippet = null;

    if (m.type === 'Reply' && m.reference?.messageId) {
      const ref = byId.get(m.reference.messageId);
      if (ref) {
        replyToKey = ref.author?.id || null;
        replyToName = authorDisplay(ref.author);
        let snip = (ref.content || '').replace(/\n/g, ' ').trim();
        if (snip.length > 80) snip = snip.substring(0, 80) + '…';
        replySnippet = snip || '…';
      }
    }

    const parts = [];
    const text = (m.content || '').trim();
    if (text) parts.push(text);

    if (m.forwardedMessage) {
      const fwdText = (m.forwardedMessage.content || '').trim();
      if (fwdText) parts.push(fwdText);
      for (const att of m.forwardedMessage.attachments || [])
        if (att.fileName) parts.push(mediaTokenFromFileName(att.fileName));
    }

    for (const att of m.attachments || [])
      if (att.fileName) parts.push(mediaTokenFromFileName(att.fileName));

    for (const embed of m.embeds || []) {
      const tok = embedToken(embed);
      if (tok) parts.push(tok);
    }

    if ((m.stickers || []).length > 0) parts.push('[STICKER]');

    let reactions = null;
    if ((m.reactions || []).length > 0) {
      const reactList = m.reactions.map(
        (r) => `${r.emoji?.name ?? '?'}:${r.count ?? 1}`,
      );
      reactions = `^{${reactList.join(', ')}}`;
    }

    if (parts.length > 0 || replyToName != null || reactions)
      messages.push({
        messageId: m.id || null,
        authorKey: m.author?.id || null,
        authorName: authorDisplay(m.author),
        // Username (distinct from the displayed nickname) — used to link a TXT
        // author, which has no id and is written by username, to this identity.
        authorUsername: (m.author?.name || '').trim() || null,
        timestamp,
        isSystem,
        replyToKey,
        replyToName,
        replySnippet,
        parts,
        reactions,
      });
  }

  return messages;
}
