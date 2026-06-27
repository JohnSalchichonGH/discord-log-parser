import { describe, it, expect } from 'vitest';
import { formatBytes, escHtml } from '../src/core/format.js';

describe('formatBytes', () => {
  it('formats bytes, KB, and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('escHtml', () => {
  it('escapes the five significant HTML characters', () => {
    expect(escHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('escapes ampersands once (no double-encoding ordering bug)', () => {
    expect(escHtml('&lt;')).toBe('&amp;lt;');
  });

  it('coerces non-strings', () => {
    expect(escHtml(42)).toBe('42');
  });
});
