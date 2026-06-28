import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseMessages,
  parseJsonExport,
  parseJsonHeader,
} from '../src/parsers/json.js';
import { buildUserMap, assembleMessage } from '../src/core/assemble.js';

const sampleJson = readFileSync(
  resolve(process.cwd(), 'test/fixtures/sample.json'),
  'utf8',
);

function parse(content) {
  const raw = parseMessages(content);
  const { userMap, uidOf } = buildUserMap([raw], false);
  return { raw, userMap, msgs: raw.map((r) => assembleMessage(r, uidOf)) };
}

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

describe('buildUserMap (JSON authors)', () => {
  it('assigns short ids in first-seen order (uid -> name, nickname fallback)', () => {
    const { userMap } = parse(sampleJson);
    expect(userMap.get('U1')).toBe('alice');
    expect(userMap.get('U2')).toBe('bob');
    expect(userMap.get('U3')).toBe('CarolBot');
  });
});

describe('parseMessages (JSON)', () => {
  const { raw, msgs } = parse(sampleJson);

  it('extracts every message with clean ids and ISO timestamps', () => {
    expect(msgs).toHaveLength(5);
    expect(raw[0].messageId).toBe('1001');
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

  it('skips messages with an unparseable timestamp (would crash JSON export)', () => {
    const json = JSON.stringify({
      guild: { id: '9', name: 'G' },
      channel: { id: '1', name: 'c' },
      dateRange: { after: null, before: null },
      messages: [
        {
          id: '1',
          type: 'Default',
          timestamp: 'not-a-date',
          content: 'bad',
          author: { id: '1', name: 'a', nickname: 'a' },
        },
        {
          id: '2',
          type: 'Default',
          timestamp: '2025-07-12T03:50:00+00:00',
          content: 'good',
          author: { id: '1', name: 'a', nickname: 'a' },
        },
      ],
      messageCount: 2,
    });
    const raw = parseMessages(json);
    expect(raw).toHaveLength(1);
    expect(raw[0].messageId).toBe('2');
  });
});
