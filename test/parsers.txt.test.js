import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseMessages,
  parseTxtHeader,
  isTxtSystemMessage,
} from '../src/parsers/txt.js';
import { buildUserMap, assembleMessage } from '../src/core/assemble.js';

const sampleTxt = readFileSync(
  resolve(process.cwd(), 'test/fixtures/sample.txt'),
  'utf8',
);

function parse(content) {
  const raw = parseMessages(content);
  const { userMap, uidOf } = buildUserMap([raw], false);
  return { userMap, msgs: raw.map((r) => assembleMessage(r, uidOf)) };
}

describe('parseTxtHeader', () => {
  it('derives channelId and baseName from Guild/Channel header lines', () => {
    const { channelId, baseName } = parseTxtHeader(sampleTxt);
    expect(channelId).toBe('My Server|general / chat');
    expect(baseName).toBe('My Server - chat');
  });

  it('falls back to txt-unknown when no Guild/Channel headers are present', () => {
    expect(parseTxtHeader('no headers here\njust text').channelId).toBe(
      'txt-unknown',
    );
  });
});

describe('parseMessages (TXT)', () => {
  const { userMap, msgs } = parse(sampleTxt);

  it('assigns sequential short ids in first-seen order (uid -> name)', () => {
    expect(userMap.get('U1')).toBe('alice');
    expect(userMap.get('U2')).toBe('bob');
  });

  it('extracts all messages with author ids and timestamps', () => {
    expect(msgs).toHaveLength(4);
    expect(msgs[0].authorId).toBe('U1');
    expect(msgs[0].contentParts).toEqual(['Hello world']);
    expect(msgs[0].timestamp).toBeInstanceOf(Date);
  });

  it('renders attachments as media tokens and keeps the reaction separate', () => {
    expect(msgs[1].contentParts).toContain('[IMG: photo.png]');
    expect(msgs[1].contentParts.some((p) => p.startsWith('^{'))).toBe(true);
  });

  it('flags "joined the server." as a system message', () => {
    const joined = msgs.find((m) =>
      m.contentParts[0].includes('joined the server'),
    );
    expect(joined.isSystem).toBe(true);
  });
});

describe('TXT postamble handling (A9)', () => {
  it('does not slurp the postamble into the final message body', () => {
    const content = [
      '[7/12/2025 3:50 AM] alice',
      'last message',
      '',
      '==============================================================',
      'Exported 1 message(s)',
      '==============================================================',
      '',
    ].join('\n');
    const { msgs } = parse(content);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].contentParts).toEqual(['last message']);
  });
});

describe('TXT stickers / forwarded / blockquote handling', () => {
  it('emits a [STICKER] token per {Stickers} url (A5)', () => {
    const { msgs } = parse(
      [
        '[7/12/2025 3:50 AM] alice',
        'nice',
        '',
        '{Stickers}',
        'https://cdn.discordapp.com/stickers/1.png',
        '',
      ].join('\n'),
    );
    expect(msgs[0].contentParts).toEqual(['nice', '[STICKER]']);
  });

  it('keeps forwarded content but drops the metadata line (A5)', () => {
    const { msgs } = parse(
      [
        '[7/12/2025 3:50 AM] alice',
        '',
        '{Forwarded Message}',
        'forwarded body text',
        'Originally sent: 7/11/2025 1:00 PM',
        '',
      ].join('\n'),
    );
    const joined = msgs[0].contentParts.join('\n');
    expect(joined).toContain('forwarded body text');
    expect(joined).not.toContain('Originally sent');
    expect(joined).not.toContain('{Forwarded Message}');
  });

  it('keeps a markdown blockquote as body text, not a reply (A4)', () => {
    const { msgs } = parse(
      [
        '[7/12/2025 3:50 AM] alice',
        '> someone said: hello there',
        'my reply',
      ].join('\n'),
    );
    expect(msgs[0].contentParts[0]).toContain('> someone said: hello there');
    expect(msgs[0].contentParts[0]).toContain('my reply');
  });
});

describe('isTxtSystemMessage', () => {
  it('matches known system patterns only when the message is a single line', () => {
    expect(isTxtSystemMessage(['Pinned a message.'])).toBe(true);
    expect(isTxtSystemMessage(['hello', 'world'])).toBe(false);
    expect(isTxtSystemMessage(['just a normal message'])).toBe(false);
  });
});
