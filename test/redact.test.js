import { describe, it, expect } from 'vitest';
import { redactString } from '../src/core/redact.js';
import { renderTxt } from '../src/render/txt.js';
import { renderJSON } from '../src/render/json.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { renderCSV } from '../src/render/csv.js';

const ALL = { redactUrls: true, redactEmails: true };

describe('redactString', () => {
  it('redacts urls, emails, and phone numbers', () => {
    expect(redactString('see https://x.com/a', ALL)).toBe('see [URL]');
    expect(redactString('mail me@x.io', ALL)).toBe('mail [EMAIL]');
    expect(redactString('call 555-123-4567', ALL)).toBe('call [PHONE]');
  });
  it('does nothing when flags are off', () => {
    expect(redactString('https://x.com me@x.io', {})).toBe(
      'https://x.com me@x.io',
    );
  });
});

// One chunk carrying all three PII kinds in its content.
const userMap = new Map([['alice', 'U1']]);
const chunks = [
  {
    authorId: 'U1',
    authorName: 'alice',
    timestamp: new Date('2025-07-12T03:50:00Z'),
    contentParts: ['ping https://evil.test/a mail me@x.io call 555-123-4567'],
  },
];

describe('redaction matrix — every format redacts content (D2)', () => {
  for (const [name, render] of [
    ['txt', (c, o) => renderTxt(c, userMap, 1000, o)],
    ['json', (c, o) => renderJSON(c, userMap, o)],
    ['md', (c, o) => renderMarkdown(c, userMap, 1000, o)],
    ['csv', (c, o) => renderCSV(c, userMap, o)],
  ]) {
    it(`${name}: replaces url, email, and phone`, () => {
      const out = render(chunks, ALL);
      expect(out).toContain('[URL]');
      expect(out).toContain('[EMAIL]');
      expect(out).toContain('[PHONE]');
      expect(out).not.toContain('evil.test');
      expect(out).not.toContain('me@x.io');
      expect(out).not.toContain('555-123-4567');
    });
  }
});

describe('structured formats keep ids and timestamps intact', () => {
  it('json: snowflake author and ISO timestamp survive phone redaction', () => {
    const map = new Map([['alice', '1393439224627200000']]);
    const c = [
      {
        authorId: '1393439224627200000',
        authorName: 'alice',
        timestamp: new Date('2025-07-12T03:50:00Z'),
        contentParts: ['my number 555-123-4567'],
      },
    ];
    const parsed = JSON.parse(renderJSON(c, map, ALL));
    expect(parsed.messages[0].authorId).toBe('1393439224627200000');
    expect(parsed.messages[0].timestamp).toBe('2025-07-12T03:50:00.000Z');
    expect(parsed.messages[0].content).toBe('my number [PHONE]');
  });

  it('csv: timestamp column is not corrupted by redaction', () => {
    const out = renderCSV(chunks, userMap, ALL);
    expect(out).toContain('"2025-07-12T03:50:00.000Z"');
  });
});
