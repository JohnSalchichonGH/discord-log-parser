import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectAuthors, extractMessages } from '../src/parsers/html.js';

// Resolve from the Vitest project root (cwd); under the jsdom environment
// import.meta.url is an http:// URL and cannot be used for filesystem paths.
const sampleHtml = readFileSync(
  resolve(process.cwd(), 'test/fixtures/sample.html'),
  'utf8',
);

describe('collectAuthors', () => {
  it('assigns short ids to message-group and reply authors', () => {
    const userMap = new Map();
    collectAuthors(sampleHtml, userMap, { value: 1 });
    expect(userMap.get('alice')).toBe('U1');
    expect(userMap.get('bob')).toBe('U2');
  });
});

describe('extractMessages', () => {
  const userMap = new Map();
  collectAuthors(sampleHtml, userMap, { value: 1 });
  const msgs = extractMessages(sampleHtml, userMap);

  it('applies the group author to every container in the group', () => {
    // alice has two containers (1001, 1002), bob has one (1003)
    expect(msgs).toHaveLength(3);
    expect(msgs[0].authorName).toBe('alice');
    expect(msgs[1].authorName).toBe('alice');
    expect(msgs[2].authorName).toBe('bob');
  });

  it('extracts text content', () => {
    expect(msgs[0].contentParts).toContain('Hello world');
  });

  it('renders an attachment as a media token; reaction stays a separate part', () => {
    // A reaction only merges onto the previous part when that part is not a
    // media token (does not start with "["); here the previous part is the
    // attachment token, so the reaction is pushed as its own part.
    expect(msgs[1].contentParts).toContain('[IMG: photo.png]');
    expect(msgs[1].contentParts).toContain('^{👍:3}');
  });

  it('captures a reply quote truncated/attributed to the short id', () => {
    expect(msgs[2].contentParts[0]).toBe('> U1: Hello world');
  });

  it('reads the clean snowflake from data-message-id (A3)', () => {
    expect(msgs[0].messageId).toBe('1393439224627200000');
  });

  it('derives an exact UTC timestamp from the snowflake (A1/A8)', () => {
    // Locale-independent: comes from the id, not the rendered title text.
    expect(msgs[0].timestamp.toISOString()).toBe('2025-07-12T03:50:00.000Z');
    expect(msgs[2].timestamp.toISOString()).toBe('2025-07-12T03:52:00.000Z');
  });
});

describe('extractMessages — reply placeholders (A6)', () => {
  it('does not leak "Click to see attachment" into the reply snippet', () => {
    const html = `
      <div class="chatlog__message-group">
        <div class="chatlog__message-container" data-message-id="1393439727943680000">
          <div class="chatlog__message-primary">
            <div class="chatlog__reply">
              <div class="chatlog__reply-author">alice</div>
              <div class="chatlog__reply-content">
                <span class="chatlog__reply-link"><em>Click to see attachment</em><span>🖼️</span></span>
              </div>
            </div>
            <div class="chatlog__header">
              <span class="chatlog__author">bob</span>
            </div>
            <div class="chatlog__markdown-preserve">replying</div>
          </div>
        </div>
      </div>`;
    const userMap = new Map();
    collectAuthors(html, userMap, { value: 1 });
    const msgs = extractMessages(html, userMap);
    // bob (group author) -> U1; alice (reply author) -> U2.
    expect(msgs[0].contentParts[0]).toBe('> U2: …');
    expect(msgs[0].contentParts[0]).not.toContain('Click to see');
  });
});

describe('extractMessages — timestamp fallback', () => {
  it('falls back to the title when no snowflake id is present', () => {
    const html = `
      <div class="chatlog__message-group">
        <div class="chatlog__message-container">
          <div class="chatlog__header">
            <span class="chatlog__author">zed</span>
            <span class="chatlog__timestamp" title="Saturday, July 12, 2025 3:50 AM"></span>
          </div>
          <div class="chatlog__markdown-preserve">legacy export</div>
        </div>
      </div>`;
    const userMap = new Map();
    collectAuthors(html, userMap, { value: 1 });
    const msgs = extractMessages(html, userMap);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].timestamp).toBeInstanceOf(Date);
    expect(isNaN(msgs[0].timestamp)).toBe(false);
  });
});
