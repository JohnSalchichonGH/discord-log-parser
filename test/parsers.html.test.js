import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMessages } from '../src/parsers/html.js';
import { buildUserMap, assembleMessage } from '../src/core/assemble.js';

const sampleHtml = readFileSync(
  resolve(process.cwd(), 'test/fixtures/sample.html'),
  'utf8',
);

// Parse + assemble a single file into final messages (the pipeline does this
// across all files; here one file is enough).
function assembleAll(html) {
  const raw = parseMessages(html);
  const { userMap, uidOf } = buildUserMap([raw], false);
  return { raw, userMap, msgs: raw.map((r) => assembleMessage(r, uidOf)) };
}

describe('buildUserMap (HTML authors + reply authors)', () => {
  it('assigns short ids in document order (userMap is uid -> name)', () => {
    const { userMap } = assembleAll(sampleHtml);
    expect(userMap.get('U1')).toBe('alice');
    expect(userMap.get('U2')).toBe('bob');
  });
});

describe('parseMessages (HTML)', () => {
  const { raw, msgs } = assembleAll(sampleHtml);

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

  it('renders an attachment token; reaction stays a separate part', () => {
    expect(msgs[1].contentParts).toContain('[IMG: photo.png]');
    expect(msgs[1].contentParts).toContain('^{👍:3}');
  });

  it('captures a reply quote attributed to the short id', () => {
    expect(msgs[2].contentParts[0]).toBe('> U1: Hello world');
  });

  it('reads the clean snowflake from data-message-id (A3)', () => {
    expect(raw[0].messageId).toBe('1393439224627200000');
  });

  it('derives an exact UTC timestamp from the snowflake (A1/A8)', () => {
    expect(msgs[0].timestamp.toISOString()).toBe('2025-07-12T03:50:00.000Z');
    expect(msgs[2].timestamp.toISOString()).toBe('2025-07-12T03:52:00.000Z');
  });
});

describe('parseMessages — reply placeholders (A6)', () => {
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
            <div class="chatlog__header"><span class="chatlog__author">bob</span></div>
            <div class="chatlog__markdown-preserve">replying</div>
          </div>
        </div>
      </div>`;
    const { msgs } = assembleAll(html);
    // bob (group author) -> U1; alice (reply author) -> U2.
    expect(msgs[0].contentParts[0]).toBe('> U2: …');
    expect(msgs[0].contentParts[0]).not.toContain('Click to see');
  });
});

describe('parseMessages — timestamp fallback', () => {
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
    const { msgs } = assembleAll(html);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].timestamp).toBeInstanceOf(Date);
    expect(isNaN(msgs[0].timestamp)).toBe(false);
  });
});
