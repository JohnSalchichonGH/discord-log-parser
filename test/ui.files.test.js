import { describe, it, expect, beforeEach } from 'vitest';
import { addFiles, removeFile, mergeGroups } from '../src/ui/files.js';
import { buildGroups } from '../src/core/grouping.js';
import {
  loadedFiles,
  authorEntries,
  selectedUsers,
  botUsers,
  parseSummary,
} from '../src/ui/store.js';

// No Worker in jsdom, so files.js takes its inline main-thread parse path.
beforeEach(() => {
  loadedFiles.value = [];
  authorEntries.value = [];
  selectedUsers.value = new Set();
  botUsers.value = new Set();
  parseSummary.value = null;
});

// Minimal DiscordChatExporter JSON with one message per (name, count) author.
const mkJson = (chanId, name, authors) =>
  JSON.stringify({
    guild: { id: '9', name: 'G' },
    channel: { id: chanId, type: 'GuildTextChat', name },
    dateRange: { after: null, before: null },
    messages: authors.flatMap((a) =>
      Array.from({ length: a.count }, (_, i) => ({
        id: `${chanId}-${a.id}-${i}`,
        type: 'Default',
        timestamp: '2025-07-12T03:50:00+00:00',
        content: 'hi',
        author: { id: a.id, name: a.name, nickname: a.name, isBot: false },
        attachments: [],
        embeds: [],
        stickers: [],
        reactions: [],
      })),
    ),
    messageCount: authors.reduce((s, a) => s + a.count, 0),
  });

const file = (name, content) =>
  new File([content], name, { type: 'application/json' });

describe('ui/files.js', () => {
  it('parses files into the store with a sorted author list and summary', async () => {
    await addFiles([
      file(
        'G - general [1].json',
        mkJson('1', 'general', [
          { id: 'a', name: 'alice', count: 3 },
          { id: 'b', name: 'bob', count: 1 },
        ]),
      ),
    ]);

    expect(loadedFiles.value).toHaveLength(1);
    // Author entries are [name, count], sorted most-active first.
    expect(authorEntries.value).toEqual([
      ['alice', 3],
      ['bob', 1],
    ]);
    expect(parseSummary.value).toEqual({
      messages: 4,
      participants: 2,
      files: 1,
      channels: 1,
    });
  });

  it('dedupes by name + size', async () => {
    const f = file(
      'G - general [1].json',
      mkJson('1', 'general', [{ id: 'a', name: 'alice', count: 1 }]),
    );
    await addFiles([f]);
    await addFiles([f]);
    expect(loadedFiles.value).toHaveLength(1);
  });

  it('flags malformed JSON as invalid and yields no summary', async () => {
    await addFiles([file('broken [2].json', '{ not valid json')]);
    expect(loadedFiles.value[0].invalid).toBe(true);
    expect(loadedFiles.value[0].error).toBeTruthy();
    expect(parseSummary.value).toBeNull();
    expect(authorEntries.value).toEqual([]);
  });

  it('removes a file and clears state when none remain', async () => {
    await addFiles([
      file(
        'G - general [1].json',
        mkJson('1', 'general', [{ id: 'a', name: 'alice', count: 1 }]),
      ),
    ]);
    await removeFile(0);
    expect(loadedFiles.value).toHaveLength(0);
    expect(parseSummary.value).toBeNull();
    expect(authorEntries.value).toEqual([]);
  });

  it('merges selected channel groups into one', async () => {
    await addFiles([
      file(
        'G - a [1].json',
        mkJson('1', 'a', [{ id: 'a', name: 'alice', count: 1 }]),
      ),
      file(
        'G - b [2].json',
        mkJson('2', 'b', [{ id: 'b', name: 'bob', count: 1 }]),
      ),
    ]);
    expect(buildGroups(loadedFiles.value).size).toBe(2);

    await mergeGroups(['1', '2']);
    const groups = buildGroups(loadedFiles.value);
    expect(groups.size).toBe(1);
    // Both files re-keyed onto the first group's channelId + baseName.
    expect(loadedFiles.value.every((f) => f.channelId === '1')).toBe(true);
  });
});
