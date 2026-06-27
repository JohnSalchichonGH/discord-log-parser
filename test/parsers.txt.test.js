import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseTxtHeader,
  parseTxtAuthors,
  collectAuthorsTxt,
  extractMessagesTxt,
  isTxtSystemMessage,
} from '../src/parsers/txt.js';

// Resolve from the Vitest project root (cwd); under the jsdom environment
// import.meta.url is an http:// URL and cannot be used for filesystem paths.
const sampleTxt = readFileSync(
  resolve(process.cwd(), 'test/fixtures/sample.txt'),
  'utf8',
);

describe('parseTxtHeader', () => {
  it('derives channelId and baseName from Guild/Channel header lines', () => {
    const { channelId, baseName } = parseTxtHeader(sampleTxt);
    expect(channelId).toBe('My Server|general / chat');
    expect(baseName).toBe('My Server - chat');
  });
});

describe('parseTxtAuthors', () => {
  it('collects the distinct author names', () => {
    expect([...parseTxtAuthors(sampleTxt)].sort()).toEqual(['alice', 'bob']);
  });
});

describe('extractMessagesTxt', () => {
  const userMap = new Map();
  collectAuthorsTxt(sampleTxt, userMap, { value: 1 });
  const msgs = extractMessagesTxt(sampleTxt, userMap);

  it('assigns sequential short ids in first-seen order', () => {
    expect(userMap.get('alice')).toBe('U1');
    expect(userMap.get('bob')).toBe('U2');
  });

  it('extracts all messages with author ids and timestamps', () => {
    expect(msgs).toHaveLength(4);
    expect(msgs[0].authorId).toBe('U1');
    expect(msgs[0].contentParts).toEqual(['Hello world']);
    expect(msgs[0].timestamp).toBeInstanceOf(Date);
  });

  it('renders attachments as media tokens and appends reactions inline', () => {
    const second = msgs[1];
    expect(second.contentParts).toContain('[IMG: photo.png]');
    // reaction has no count in TXT, so it is just the emoji
    expect(second.contentParts.some((p) => p.startsWith('^{'))).toBe(true);
  });

  it('flags "joined the server." as a system message', () => {
    const joined = msgs.find((m) => m.contentParts[0].includes('joined the server'));
    expect(joined.isSystem).toBe(true);
  });
});

// A9 FIXED: the postamble separator now terminates the final message so the
// "Exported N message(s)" footer is not slurped into its body.
describe('TXT postamble handling (A9)', () => {
  const withPostamble = [
    '[7/12/2025 3:50 AM] alice',
    'last message',
    '',
    '==============================================================',
    'Exported 1 message(s)',
    '==============================================================',
    '',
  ].join('\n');

  it('does not slurp the postamble into the final message body', () => {
    const userMap = new Map();
    collectAuthorsTxt(withPostamble, userMap, { value: 1 });
    const msgs = extractMessagesTxt(withPostamble, userMap);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].contentParts).toEqual(['last message']);
  });
});

describe('TXT stickers / forwarded / blockquote handling', () => {
  function parse(text) {
    const userMap = new Map();
    collectAuthorsTxt(text, userMap, { value: 1 });
    return extractMessagesTxt(text, userMap);
  }

  it('emits a [STICKER] token per {Stickers} url (A5)', () => {
    const msgs = parse(
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
    const msgs = parse(
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
    const msgs = parse(
      ['[7/12/2025 3:50 AM] alice', '> someone said: hello there', 'my reply'].join(
        '\n',
      ),
    );
    // The "> someone said: …" line is preserved verbatim, not turned into a
    // "> Uxx: …" reply attribution.
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
