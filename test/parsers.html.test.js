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

  it('parses the timestamp from the title attribute', () => {
    expect(msgs[0].timestamp).toBeInstanceOf(Date);
    expect(isNaN(msgs[0].timestamp)).toBe(false);
  });
});
