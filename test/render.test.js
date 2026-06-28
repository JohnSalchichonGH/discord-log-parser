import { describe, it, expect } from 'vitest';
import { renderJSON } from '../src/render/json.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { renderCSV } from '../src/render/csv.js';
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
});

describe('tokens', () => {
  it('approximates 1 token per 4 chars', () => {
    expect(estimateTokensFromChars(400)).toBe(100);
    expect(estimateTokens('x'.repeat(40))).toBe(10);
    expect(charsForTokens(100)).toBe(400);
  });
});
