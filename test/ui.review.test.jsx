import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { h } from 'preact';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { Summary } from '../src/ui/views/Review/Summary.jsx';
import { Technical } from '../src/ui/views/Review/Technical.jsx';
import { processResult, processedOutputs } from '../src/ui/store.js';
import { setSetting } from '../src/ui/settings.js';

// Minimal processed-output stand-in: one channel group with two authors.
function makeOutputs() {
  const chunk = (authorId, text, day) => ({
    authorId,
    contentParts: [text],
    timestamp: new Date(`2025-07-${day}T12:00:00Z`),
  });
  return [
    {
      name: 'general',
      userMap: new Map([
        ['1', 'Alice'],
        ['2', 'Bob'],
      ]),
      finalChunks: [
        chunk('1', 'hello there', '10'),
        chunk('1', 'how are you', '11'),
        chunk('2', 'good thanks', '12'),
      ],
    },
  ];
}

beforeEach(() => {
  processResult.value = { totalMessages: 9, totalFiltered: 3, totalKept: 3 };
  processedOutputs.value = makeOutputs();
});

afterEach(() => {
  cleanup();
  processResult.value = null;
  processedOutputs.value = [];
});

describe('Review Summary card', () => {
  it('renders the headline stats and a per-user leaderboard', () => {
    const { container } = render(h(Summary, {}));
    const grid = container.querySelector('#statsGrid');
    expect(grid).not.toBeNull();
    // Total msgs (raw run total) and Kept come from processResult.
    expect(grid.textContent).toContain('9');
    expect(grid.textContent).toContain('Total msgs');
    expect(grid.textContent).toContain('Kept');
    // Two distinct authors → "2" users; the chart lists them by display name.
    const labels = [...container.querySelectorAll('.chart-bar-label')].map(
      (n) => n.textContent,
    );
    expect(labels).toContain('Alice');
    expect(labels).toContain('Bob');
    // Alice (2 msgs) ranks above Bob (1 msg).
    expect(labels.indexOf('Alice')).toBeLessThan(labels.indexOf('Bob'));
  });

  it('renders nothing until a run has a result', () => {
    processResult.value = null;
    const { container } = render(h(Summary, {}));
    expect(container.querySelector('#statsCard')).toBeNull();
  });

  it('escapes malicious display names (XSS)', () => {
    processedOutputs.value = [
      {
        name: 'g',
        userMap: new Map([['1', '<img src=x onerror="window.__x=1">']]),
        finalChunks: [
          {
            authorId: '1',
            contentParts: ['hi'],
            timestamp: new Date('2025-07-10T00:00:00Z'),
          },
        ],
      },
    ];
    const { container } = render(h(Summary, {}));
    const html = container.querySelector('#userChart').innerHTML;
    expect(window.__x).toBeUndefined();
    // The name is escaped in the visible label text and (safely, quote-escaped)
    // in the title tooltip, so no real <img> element is ever created.
    expect(container.querySelector('img')).toBeNull();
    expect(html).toContain('&lt;img');
  });
});

describe('Review Technical card', () => {
  it('renders the token-budget breakdown and reacts to the budget setting', async () => {
    setSetting('maxTokens', '1000');
    const { container } = render(h(Technical, {}));
    const bars = container.querySelector('#budgetBars');
    expect(bars).not.toBeNull();
    expect(bars.textContent).toContain('Budget used');
    expect(bars.textContent).toContain('tkn');
    // Bumping the budget lowers the "used" percentage (reactive on settings).
    const before = bars.textContent;
    setSetting('maxTokens', '1000000');
    await waitFor(() =>
      expect(container.querySelector('#budgetBars').textContent).not.toBe(
        before,
      ),
    );
  });
});
