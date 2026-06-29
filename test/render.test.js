import { describe, it, expect } from 'vitest';
import { renderJSON } from '../src/render/json.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { renderCSV } from '../src/render/csv.js';
import { renderHTML } from '../src/render/html.js';
import {
  estimateTokens,
  estimateTokensFromChars,
  charsForTokens,
} from '../src/core/tokens.js';

// userMap is uid -> displayName (#4)
const userMap = new Map([
  ['U1', 'alice'],
  ['U2', 'bob'],
]);

const chunks = [
  {
    authorId: 'U1',
    authorName: 'alice',
    timestamp: new Date('2025-07-12T03:50:00Z'),
    contentParts: ['> U2: earlier', 'Hello world', '^{👍:3}'],
  },
  {
    authorId: 'U2',
    authorName: 'bob',
    timestamp: new Date('2025-07-12T03:52:00Z'),
    contentParts: ['hi alice'],
  },
];

describe('renderJSON', () => {
  const parsed = JSON.parse(renderJSON(chunks, userMap, {}));

  it('emits a participants map and message array', () => {
    expect(parsed.participants).toEqual({ U1: 'alice', U2: 'bob' });
    expect(parsed.messages).toHaveLength(2);
  });

  it('separates content, replyTo and reactions', () => {
    const m = parsed.messages[0];
    expect(m.content).toBe('Hello world');
    expect(m.replyTo).toBe('U2: earlier');
    expect(m.reactions).toBe('{👍:3}');
    expect(m.timestamp).toBe('2025-07-12T03:50:00.000Z');
  });

  it('uses author ids when redactNames is set', () => {
    const red = JSON.parse(renderJSON(chunks, userMap, { redactNames: true }));
    expect(red.participants).toEqual({ U1: 'U1', U2: 'U2' });
    expect(red.messages[0].author).toBe('U1');
  });
});

describe('renderMarkdown', () => {
  const md = renderMarkdown(chunks, userMap, 200000, {});
  it('emits headings, participants and message blocks', () => {
    expect(md).toContain('# Chat Log');
    expect(md).toContain('## Participants');
    expect(md).toMatch(/- \*\*U1\*\*: alice \(1 msgs/);
    expect(md).toContain('Hello world');
  });
});

describe('renderCSV', () => {
  const csv = renderCSV(chunks, userMap, {});
  const lines = csv.split('\n');
  it('emits a header row and one row per message', () => {
    expect(lines[0]).toBe(
      '"timestamp","author_id","author_name","content","reactions"',
    );
    expect(lines).toHaveLength(3);
  });
  it('quotes fields, joins content with " | ", and isolates reactions', () => {
    expect(lines[1]).toContain('"> U2: earlier | Hello world"');
    expect(lines[1]).toContain('"^{👍:3}"');
  });

  it('neutralizes spreadsheet formula injection in untrusted content', () => {
    const evil = [
      {
        authorId: 'U1',
        authorName: '=cmd()', // a malicious nickname
        timestamp: new Date('2025-07-12T03:50:00Z'),
        contentParts: ['=HYPERLINK("http://evil","click")'],
      },
    ];
    const out = renderCSV(evil, new Map(), {});
    const row = out.split('\n')[1];
    expect(row).toContain('"\'=HYPERLINK'); // content cell prefixed with '
    expect(row).toContain('"\'=cmd()"'); // author cell prefixed with '
  });
});

describe('renderHTML', () => {
  const html = renderHTML(chunks, userMap, 200000, {});

  it('emits a complete standalone HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Chat Log</title>');
    expect(html).toContain('<style>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('lists participants with names and message counts', () => {
    expect(html).toContain('alice');
    expect(html).toContain('bob');
    expect(html).toMatch(/class="participants"/);
  });

  it('renders message content', () => {
    expect(html).toContain('Hello world');
    expect(html).toContain('hi alice');
  });

  it('resolves a reply uid to the referenced display name', () => {
    expect(html).toContain('class="reply"');
    expect(html).toMatch(/reply-who">bob</); // U2 -> bob
    expect(html).toContain('earlier');
  });

  it('renders reactions as pills with counts', () => {
    expect(html).toContain('class="react"');
    expect(html).toContain('👍');
    expect(html).toMatch(/class="rc">3</);
  });

  it('escapes untrusted content and author names (no raw HTML injection)', () => {
    const evil = [
      {
        authorId: 'U9',
        authorName: '<img src=x onerror=alert(1)>',
        timestamp: new Date('2025-07-12T03:50:00Z'),
        contentParts: ['<script>alert(1)</script>'],
      },
    ];
    const out = renderHTML(evil, new Map([['U9', '<b>x</b>']]), 1000, {});
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).not.toContain('<img src=x onerror');
    expect(out).toContain('&lt;script&gt;');
  });

  it('turns media tokens into chips and linkifies URLs', () => {
    const m = [
      {
        authorId: 'U1',
        authorName: 'alice',
        timestamp: new Date('2025-07-12T03:50:00Z'),
        contentParts: ['see [IMG: cat.png] at http://example.com/x'],
      },
    ];
    const out = renderHTML(m, userMap, 1000, {});
    expect(out).toContain('<span class="chip">[IMG: cat.png]</span>');
    expect(out).toContain('href="http://example.com/x"');
  });

  it('honors redactNames and redactUrls', () => {
    const m = [
      {
        authorId: 'U1',
        authorName: 'alice',
        timestamp: new Date('2025-07-12T03:50:00Z'),
        contentParts: ['ping http://secret.example.com'],
      },
    ];
    const out = renderHTML(m, userMap, 1000, {
      redactNames: true,
      redactUrls: true,
    });
    expect(out).toContain('>U1<'); // author shown as the uid
    expect(out).not.toContain('alice');
    expect(out).toContain('[URL]');
    expect(out).not.toContain('secret.example.com');
  });

  it('reports an empty conversation', () => {
    const out = renderHTML([], new Map(), 1000, {});
    expect(out).toContain('No messages found');
  });

  it('leaves small logs un-virtualized (byte-for-byte as before)', () => {
    expect(html).not.toContain('class="virt"');
    expect(html).not.toContain('content-visibility');
    expect(html).not.toContain('--h:');
  });

  it('virtualizes large logs with content-visibility and per-row estimates', () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({
      authorId: 'U1',
      authorName: 'alice',
      timestamp: new Date(2025, 0, 1, 0, 0, i),
      contentParts: [`msg ${i}`],
    }));
    const out = renderHTML(many, userMap, 200000, {});
    expect(out).toContain('<body class="virt">');
    expect(out).toContain('content-visibility:auto');
    expect(out).toMatch(/class="msg[^"]*" style="--h:\d+px"/);
  });
});

describe('tokens', () => {
  it('approximates 1 token per 4 chars', () => {
    expect(estimateTokensFromChars(400)).toBe(100);
    expect(estimateTokens('x'.repeat(40))).toBe(10);
    expect(charsForTokens(100)).toBe(400);
  });
});
