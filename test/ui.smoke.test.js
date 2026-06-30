import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { h } from 'preact';
import { render } from '@testing-library/preact';
import { Header } from '../src/ui/views/Header.jsx';

// Load the real markup, then import the controller. If any element the app wires
// to is missing/renamed, the top-level getElementById bindings throw and this
// test fails loudly — a cheap parity guard for the UI migration.
beforeAll(async () => {
  const html = readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');
  const body = html.slice(
    html.indexOf('<body>') + '<body>'.length,
    html.indexOf('<script'),
  );
  document.documentElement.setAttribute('data-theme', 'dark');
  document.body.innerHTML = body;
  await import('../src/ui/app.js');
});

describe('UI wiring smoke test', () => {
  it('renders the wizard markup with all four panels', () => {
    expect(document.getElementById('panel1')).not.toBeNull();
    expect(document.getElementById('panel4')).not.toBeNull();
    expect(document.querySelectorAll('.wizard-step')).toHaveLength(4);
  });

  it('binds the theme toggle (Preact Header click flips data-theme)', () => {
    // The header + theme toggle are now rendered by Preact (store-owned theme).
    render(h(Header, {}), { container: document.getElementById('app-header') });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    document.querySelector('.theme-toggle').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    document.querySelector('.theme-toggle').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('keeps "Continue" disabled until files are loaded', () => {
    expect(document.getElementById('toStep2').disabled).toBe(true);
  });

  it('updates the char-budget label from the token input', () => {
    const input = document.getElementById('maxTokens');
    input.value = '200000';
    input.dispatchEvent(new window.Event('input'));
    expect(document.getElementById('maxCharsLabel').textContent).toBe('800K');
  });

  it('reveals the min-messages row when low-activity filter is toggled', () => {
    const cb = document.getElementById('filterLowActivity');
    cb.checked = true;
    cb.dispatchEvent(new window.Event('change'));
    expect(document.getElementById('minMsgRow').style.display).toBe('block');
  });

  it('loads a DCE JSON export through the file input (A2 wiring)', async () => {
    const json = readFileSync(
      resolve(process.cwd(), 'test/fixtures/sample.json'),
      'utf8',
    );
    const input = document.getElementById('fileInput');
    const file = new File([json], 'My Server - general [123456789].json', {
      type: 'application/json',
    });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new window.Event('change'));

    await waitFor(() => document.getElementById('toStep2').disabled === false);

    expect(document.querySelector('.file-name').textContent).toContain('.json');
    // No invalid/error badge for a well-formed export.
    expect(
      document.querySelector('.file-item span[style*="danger"]'),
    ).toBeNull();
  });

  it('escapes malicious usernames in the stats chart (D1/XSS)', async () => {
    window.scrollTo = () => {}; // jsdom doesn't implement it; goToStep calls it
    const evil = '<img src=x onerror="window.__xss=1">';
    const json = JSON.stringify({
      guild: { id: '9', name: 'G' },
      channel: { id: '999', name: 'evil' },
      dateRange: { after: null, before: null },
      messages: [
        {
          id: '1',
          type: 'Default',
          timestamp: '2025-07-12T03:50:00+00:00',
          content: 'hi',
          author: { id: '1', name: 'u', nickname: evil, isBot: false },
          attachments: [],
          embeds: [],
          stickers: [],
          reactions: [],
        },
      ],
      messageCount: 1,
    });
    const input = document.getElementById('fileInput');
    Object.defineProperty(input, 'files', {
      value: [
        new File([json], 'G - evil [999].json', { type: 'application/json' }),
      ],
      configurable: true,
    });
    input.dispatchEvent(new window.Event('change'));
    await waitFor(() => document.getElementById('toStep2').disabled === false);

    document.getElementById('useRealNames').checked = true; // uid becomes the name
    document.getElementById('filterLowActivity').checked = false; // keep the 1-msg user
    document.getElementById('toStep2').click();
    document.getElementById('toStep3').click();
    await waitFor(
      () => document.getElementById('statsCard').style.display === 'block',
      4000,
    );

    const chartHtml = document.getElementById('userChart').innerHTML;
    expect(window.__xss).toBeUndefined();
    expect(chartHtml).not.toContain('<img src=x onerror');
    expect(chartHtml).toContain('&lt;img');
  });
});

async function waitFor(fn, timeout = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}
