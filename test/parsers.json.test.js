import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseJsonExport,
  parseJsonHeader,
  jsonAuthors,
  collectAuthorsJson,
  extractMessagesJson,
} from '../src/parsers/json.js';

const sampleJson = readFileSync(
  resolve(process.cwd(), 'test/fixtures/sample.json'),
  'utf8',
);

describe('parseJsonExport', () => {
  it('throws a clear error on malformed JSON', () => {
    expect(() => parseJsonExport('{ not json')).toThrow(/Invalid JSON/);
  });
  it('throws when the messages array is missing', () => {
    expect(() => parseJsonExport('{"guild":{}}')).toThrow(/messages/);
  });
});

describe('parseJsonHeader', () => {
  it('derives channelId from the clean snowflake and a readable baseName', () => {
    const { channelId, baseName, afterDate } = parseJsonHeader(sampleJson);
    expect(channelId).toBe('123456789');
    expect(baseName).toBe('My Server - text - general');
    expect(afterDate).toBeNull();
  });
});

describe('jsonAuthors / collectAuthorsJson', () => {
  it('lists distinct display names (nickname fallback)', () => {
    expect([...jsonAuthors(sampleJson)].sort()).toEqual([
      'CarolBot',
      'alice',
      'bob',
    ]);
  });
  it('assigns short ids in first-seen order', () => {
    const userMap = new Map();
    collectAuthorsJson(sampleJson, userMap, { value: 1 });
    expect(userMap.get('alice')).toBe('U1');
    expect(userMap.get('bob')).toBe('U2');
    expect(userMap.get('CarolBot')).toBe('U3');
  });
});

describe('extractMessagesJson', () => {
  const userMap = new Map();
  collectAuthorsJson(sampleJson, userMap, { value: 1 });
  const msgs = extractMessagesJson(sampleJson, userMap);

  it('extracts every message with clean ids and ISO timestamps', () => {
    expect(msgs).toHaveLength(5);
    expect(msgs[0].messageId).toBe('1001');
    // ISO-8601 parses to an exact UTC instant regardless of locale.
    expect(msgs[0].timestamp.toISOString()).toBe('2025-07-12T03:50:00.000Z');
  });

  it('renders an attachment token and a counted reaction', () => {
    expect(msgs[1].contentParts).toContain('[IMG: photo.png]');
    expect(msgs[1].contentParts).toContain('^{👍:3}');
  });

  it('resolves a reply quote against the referenced message', () => {
    expect(msgs[2].contentParts[0]).toBe('> U1: Hello world');
    expect(msgs[2].contentParts).toContain('hi alice');
  });

  it('flags system messages (GuildMemberJoin) via the type field', () => {
    const joined = msgs.find((m) => m.messageId === '1004');
    expect(joined.isSystem).toBe(true);
    expect(joined.contentParts).toEqual(['Joined the server.']);
  });

  it('maps a YouTube embed to a [YT: title] token', () => {
    const m = msgs.find((x) => x.messageId === '1005');
    expect(m.contentParts).toContain('[YT: Never Gonna Give You Up]');
  });
});
