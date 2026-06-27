import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('binds the theme toggle (click flips data-theme)', () => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    document.getElementById('themeToggle').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    document.getElementById('themeToggle').click();
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
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change'));

    await waitFor(() => document.getElementById('toStep2').disabled === false);

    expect(document.querySelector('.file-name').textContent).toContain('.json');
    // No invalid/error badge for a well-formed export.
    expect(document.querySelector('.file-item span[style*="danger"]')).toBeNull();
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
