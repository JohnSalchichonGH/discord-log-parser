import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent } from '@testing-library/preact';
import { setSetting } from '../src/ui/settings.js';

// Load the real index.html shell (now just <div id="app">), then import the
// bootstrap — it mounts the whole Preact app and starts the analytics host,
// exactly as main.js does in the browser. If any element the app wires to is
// missing/renamed, bootstrap throws and this test fails loudly — a cheap
// end-to-end parity guard for the UI.
beforeAll(async () => {
  const html = readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');
  const body = html.slice(
    html.indexOf('<body>') + '<body>'.length,
    html.indexOf('<script'),
  );
  document.documentElement.setAttribute('data-theme', 'dark');
  document.body.innerHTML = body;
  window.scrollTo = () => {}; // jsdom doesn't implement it; goToStep calls it
  await import('../src/ui/bootstrap.jsx');
});

describe('UI wiring smoke test', () => {
  it('renders the wizard markup with all four panels', () => {
    expect(document.getElementById('panel1')).not.toBeNull();
    expect(document.getElementById('panel4')).not.toBeNull();
    expect(document.querySelectorAll('.wizard-step')).toHaveLength(4);
  });

  it('binds the theme toggle (Preact Header click flips data-theme)', () => {
    // The header + theme toggle are rendered by Preact (store-owned theme) as
    // part of the App shell that bootstrap mounted.
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
    fireEvent.input(document.getElementById('maxTokens'), {
      target: { value: '200000' },
    });
    expect(document.getElementById('maxCharsLabel').textContent).toBe('800K');
  });

  it('reveals the min-messages input when low-activity filter is toggled', () => {
    expect(document.getElementById('minMessages')).toBeNull();
    const btn = [...document.querySelectorAll('.switch-row')].find((b) =>
      b.textContent.includes('Exclude low-activity users'),
    );
    fireEvent.click(btn);
    expect(document.getElementById('minMessages')).not.toBeNull();
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
    fireEvent.change(input);

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
    fireEvent.change(input);
    await waitFor(() => document.getElementById('toStep2').disabled === false);

    setSetting('useRealNames', true); // uid becomes the name
    setSetting('filterLowActivity', false); // keep the 1-msg user
    document.getElementById('toStep2').click();
    document.getElementById('toStep3').click();
    // The Summary card is Preact-rendered, so it appears (with the user bar
    // chart) once processing writes processResult — wait for that chart.
    await waitFor(() => {
      const chart = document.getElementById('userChart');
      return chart && chart.querySelector('.chart-bar-label');
    }, 4000);

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
