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

// KNOWN BUG (A9), characterized so a later fix has a guard to flip.
// DCE appends a postamble ("==== Exported N message(s) ====") after the last
// message. Nothing terminates the final message, so those trailing lines get
// slurped into its content. The main sample.txt fixture deliberately omits the
// postamble; this test pins the current (buggy) behavior on a realistic input.
describe('TXT postamble pollution (known bug A9)', () => {
  const withPostamble = [
    '[7/12/2025 3:50 AM] alice',
    'last message',
    '',
    '==============================================================',
    'Exported 1 message(s)',
    '==============================================================',
    '',
  ].join('\n');

  it('currently slurps the postamble into the final message body', () => {
    const userMap = new Map();
    collectAuthorsTxt(withPostamble, userMap, { value: 1 });
    const msgs = extractMessagesTxt(withPostamble, userMap);
    expect(msgs).toHaveLength(1);
    // The body is polluted with the separator/footer lines (the bug).
    expect(msgs[0].contentParts[0]).toContain('Exported 1 message(s)');
  });
});

describe('isTxtSystemMessage', () => {
  it('matches known system patterns only when the message is a single line', () => {
    expect(isTxtSystemMessage(['Pinned a message.'])).toBe(true);
    expect(isTxtSystemMessage(['hello', 'world'])).toBe(false);
    expect(isTxtSystemMessage(['just a normal message'])).toBe(false);
  });
});
