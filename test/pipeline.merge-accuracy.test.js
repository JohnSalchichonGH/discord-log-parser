import { describe, it, expect } from 'vitest';
import { getFilteredMessages, buildIdentity } from '../src/core/pipeline.js';
import { dateToSnowflake } from '../src/core/snowflake.js';

// Merge-accuracy pins: format-priority dedup, cross-format signature
// normalization, TXT clock anchoring, and the distinctive-evidence identity
// bridge. Together these guarantee the two properties the merge is built for:
// one person = one identity, and no real message lost (only true duplicates
// folded).

function baseOpts(over = {}) {
  return {
    minMsgs: 0,
    maxChars: 1_000_000,
    userFilter: null,
    filterBots: false,
    botSet: new Set(),
    filterSystem: false,
    filterMediaOnly: false,
    dateFrom: null,
    dateTo: null,
    keywords: [],
    useRealNames: false,
    ...over,
  };
}

const mkJson = (entries) =>
  JSON.stringify({
    guild: { id: '9', name: 'G' },
    channel: { id: '1', name: 'chan' },
    dateRange: { after: null },
    messages: entries.map(([id, uid, nick, text, ts]) => ({
      id: String(id),
      type: 'Default',
      timestamp: ts,
      content: text,
      author: { id: uid, name: uid + '_user', nickname: nick },
    })),
    messageCount: entries.length,
  });

// Minimal DCE-shaped HTML; timestamps derive from the data-message-id snowflake.
const mkHtml = (entries) =>
  '<html><body>' +
  entries
    .map(
      ([id, uid, nick, text]) =>
        `<div class="chatlog__message-group">` +
        `<span class="chatlog__author" title="${uid}_user" data-user-id="${uid}">${nick}</span>` +
        `<div class="chatlog__message-container" data-message-id="${id}">` +
        `<div class="chatlog__content chatlog__markdown"><span class="chatlog__markdown-preserve">${text}</span></div>` +
        `</div></div>`,
    )
    .join('') +
  '</body></html>';

// Format an instant as the local wall clock the TXT parser will read back with
// new Date(y,m,d,h,min) — an exact round-trip on any machine timezone.
const txtClock = (ms) => {
  const d = new Date(ms);
  const h24 = d.getHours();
  const ap = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 || 12;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
};
const mkTxt = (lines) =>
  'Guild: G\nChannel: chan\n\n' +
  lines
    .map(([who, text, ms]) => `[${txtClock(ms)}] ${who}\n${text}\n`)
    .join('\n');

const T0 = Date.UTC(2025, 6, 12, 12, 0, 0); // noon UTC, day-boundary-safe
const MIN = 60_000;
const snow = (ms) => dateToSnowflake(new Date(ms));

describe('format-priority dedup (JSON > HTML, newest export wins)', () => {
  it('keeps the JSON copy of a message even when the HTML file sorts first', () => {
    const id = snow(T0);
    const files = [
      // HTML sorts FIRST (lower sortOrder) — old code would keep its rendered
      // copy ("bold words here", markdown stripped by the renderer).
      {
        channelId: '1',
        sortOrder: 0,
        content: mkHtml([[id, '7', 'kay', 'bold words here']]),
      },
      {
        isJson: true,
        channelId: '1',
        sortOrder: 1,
        content: mkJson([
          [id, '7', 'kay', '**bold words here**', new Date(T0).toISOString()],
        ]),
      },
      // The TXT twin carries raw markdown; it must dedup against the kept copy.
      {
        isTxt: true,
        channelId: '1',
        sortOrder: 2,
        content: mkTxt([['kay', '**bold words here**', T0]]),
      },
    ];
    const { filtered } = getFilteredMessages(files, baseOpts());
    expect(filtered).toHaveLength(1); // one message, no TXT duplicate
    expect(filtered[0].contentParts[0]).toBe('**bold words here**'); // the JSON copy
  });

  it('same id across two JSON exports: the later file (newest export) wins', () => {
    const id = snow(T0);
    const files = [
      {
        isJson: true,
        channelId: '1',
        sortOrder: 0,
        content: mkJson([
          [id, '7', 'kay', 'original wording', new Date(T0).toISOString()],
        ]),
      },
      {
        isJson: true,
        channelId: '1',
        sortOrder: 1,
        content: mkJson([
          [id, '7', 'kay', 'edited wording', new Date(T0).toISOString()],
        ]),
      },
    ];
    const { filtered } = getFilteredMessages(files, baseOpts());
    expect(filtered).toHaveLength(1);
    expect(filtered[0].contentParts[0]).toBe('edited wording');
  });
});

describe('cross-format signature normalization', () => {
  it('dedups a TXT twin against rendered HTML text (markdown, links, emoji)', () => {
    const rows = [
      // [html rendered text, raw markdown the TXT carries]
      ['some bold words', '**some bold words**'],
      ['a cool site link', '[a cool site link](https://example.com/x)'],
      ['nice play there', 'nice play there :pogchamp: 😀'],
    ];
    const files = [
      {
        channelId: '1',
        sortOrder: 0,
        content: mkHtml(
          rows.map(([html], i) => [snow(T0 + i * MIN), '7', 'kay', html]),
        ),
      },
      {
        isTxt: true,
        channelId: '1',
        sortOrder: 1,
        content: mkTxt(rows.map(([, raw], i) => ['kay', raw, T0 + i * MIN])),
      },
    ];
    const { filtered } = getFilteredMessages(files, baseOpts());
    expect(filtered).toHaveLength(rows.length); // every TXT copy folded
    expect(filtered.every((m) => m.messageId)).toBe(true); // HTML copies kept
  });
});

describe('TXT clock anchoring (exporter-timezone correction)', () => {
  // 12 distinctive messages; the TXT export machine's clock ran 2h ahead of
  // UTC, including one 23:30 UTC message whose unshifted TXT copy lands on the
  // WRONG UTC day (01:30 next day) — the case day-keyed dedup used to miss.
  const SHIFT = 2 * 3600e3;
  const times = [];
  for (let i = 0; i < 11; i++) times.push(T0 + i * 7 * MIN);
  times.push(Date.UTC(2025, 6, 12, 23, 30, 0)); // the midnight-crosser
  const text = (i) => `distinctive message number ${i} with plenty of words`;

  const jsonFile = {
    isJson: true,
    channelId: '1',
    sortOrder: 0,
    content: mkJson(
      times.map((ms, i) => [
        snow(ms),
        '7',
        'kay',
        text(i),
        new Date(ms).toISOString(),
      ]),
    ),
  };
  const txtLines = times.map((ms, i) => ['kay', text(i), ms + SHIFT]);

  it('detects the offset, corrects the file, and dedups across the day boundary', () => {
    const files = [
      jsonFile,
      {
        isTxt: true,
        channelId: '1',
        sortOrder: 1,
        content: mkTxt([
          ...txtLines,
          // A TXT-only message (deleted before the JSON export): must survive
          // AND be shifted back to true UTC.
          [
            'kay',
            'a txt only straggler that was deleted later',
            T0 + 90 * MIN + SHIFT,
          ],
        ]),
      },
    ];
    const { filtered } = getFilteredMessages(files, baseOpts());
    expect(filtered).toHaveLength(times.length + 1); // no duplicates, no losses
    const straggler = filtered.find((m) =>
      m.contentParts[0].includes('straggler'),
    );
    expect(straggler.messageId).toBeNull();
    // Corrected from wall clock (T0+90min+2h) back to true UTC (T0+90min).
    expect(straggler.timestamp.getTime()).toBe(T0 + 90 * MIN);
  });

  it('refuses to shift on flimsy evidence (<10 matches) — and the day-boundary dup shows why anchoring matters', () => {
    const few = [txtLines[0], txtLines[1], txtLines[2], txtLines[11]];
    const files = [
      jsonFile,
      { isTxt: true, channelId: '1', sortOrder: 1, content: mkTxt(few) },
    ];
    const { filtered } = getFilteredMessages(files, baseOpts());
    // Unshifted: the three mid-day copies still dedup (same UTC day), but the
    // 23:30 message's TXT copy lands on the next UTC day and survives as a dup.
    expect(filtered).toHaveLength(times.length + 1);
  });
});

describe('label freshness: exportedAt beats message recency', () => {
  it('uses the nickname from the most recently EXPORTED file', () => {
    // Active channel exported 2025 (old nick, newest messages) vs a quiet
    // channel re-exported 2026 (new nick, old messages, exportedAt present).
    const activeOldExport = {
      isJson: true,
      channelId: '1',
      sortOrder: 0,
      content: mkJson([
        [
          snow(T0),
          '7',
          'oldnick',
          'newest message here',
          new Date(T0).toISOString(),
        ],
      ]),
    };
    const old = Date.UTC(2023, 0, 5, 12, 0, 0);
    const quietRecentExport = {
      isJson: true,
      channelId: '2',
      sortOrder: 1,
      content: JSON.stringify({
        guild: { id: '9', name: 'G' },
        channel: { id: '2', name: 'quiet' },
        dateRange: { after: null },
        exportedAt: '2026-07-01T00:00:00Z',
        messages: [
          {
            id: snow(old),
            type: 'Default',
            timestamp: new Date(old).toISOString(),
            content: 'an old message',
            author: { id: '7', name: '7_user', nickname: 'newnick' },
          },
        ],
        messageCount: 1,
      }),
    };
    const { userMap, filtered } = getFilteredMessages(
      [activeOldExport],
      baseOpts(),
      // identity built across BOTH files, like the app does
      buildIdentity([activeOldExport, quietRecentExport], false),
    );
    expect(filtered).toHaveLength(1);
    expect(userMap.get(filtered[0].authorId)).toBe('newnick');
  });
});

describe('identity bridge: distinctive evidence, low volume', () => {
  const texts = [
    'cranberry goat cheese is underrated honestly',
    'you have got to try the gruyere next time',
    'my favourite is pecorino romano though',
    'anyway good night everyone see you tomorrow',
  ];

  it('folds a renamed user on 4 distinctive matches (old threshold was 8)', () => {
    const files = [
      {
        isJson: true,
        channelId: '1',
        sortOrder: 0,
        content: mkJson(
          texts.map((t, i) => [
            snow(T0 + i * MIN),
            '7',
            'newnick',
            t,
            new Date(T0 + i * MIN).toISOString(),
          ]),
        ),
      },
      {
        isTxt: true,
        channelId: '1',
        sortOrder: 1,
        content: mkTxt([
          ...texts.map((t, i) => ['oldnick', t, T0 + i * MIN]),
          // one distinctive TXT-only line — survives under the FOLDED identity
          [
            'oldnick',
            'this specific line only exists in the txt',
            T0 + 30 * MIN,
          ],
        ]),
      },
    ];
    const { filtered, userMap } = getFilteredMessages(files, baseOpts());
    expect(filtered).toHaveLength(texts.length + 1); // dups folded, unique kept
    const ids = new Set(filtered.map((m) => m.authorId));
    expect(ids.size).toBe(1); // ONE identity, not two
    expect(userMap.get([...ids][0])).toBe('newnick');
  });

  it('does NOT bridge on short coincidental texts ("lol")', () => {
    const files = [
      {
        isJson: true,
        channelId: '1',
        sortOrder: 0,
        content: mkJson(
          [0, 1, 2, 3].map((i) => [
            snow(T0 + i * MIN),
            '7',
            'newnick',
            'lol',
            new Date(T0 + i * MIN).toISOString(),
          ]),
        ),
      },
      {
        isTxt: true,
        channelId: '1',
        sortOrder: 1,
        content: mkTxt(
          [0, 1, 2, 3].map((i) => ['someoneelse', 'lol', T0 + i * MIN]),
        ),
      },
    ];
    const { filtered } = getFilteredMessages(files, baseOpts());
    const ids = new Set(filtered.map((m) => m.authorId));
    expect(ids.size).toBe(2); // strangers stay separate
  });
});
