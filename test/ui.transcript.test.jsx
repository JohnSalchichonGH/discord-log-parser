import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { Transcript } from '../src/ui/views/Review/Transcript.jsx';
import { processResult, processedOutputs } from '../src/ui/store.js';
import { settings } from '../src/ui/settings.js';

// One processed group with two messages; a second group is added per-test to
// exercise the channel selector.
function group(name, authorId = '1') {
  return {
    name,
    userMap: new Map([['1', 'Alice']]),
    finalChunks: [
      {
        authorId,
        authorName: 'Alice',
        contentParts: ['hello there'],
        timestamp: new Date('2025-07-10T12:00:00Z'),
      },
    ],
  };
}

beforeEach(() => {
  settings.value = {};
  processResult.value = { totalMessages: 1, totalFiltered: 1, totalKept: 1 };
  processedOutputs.value = [group('general')];
});

afterEach(() => {
  cleanup();
  processResult.value = null;
  processedOutputs.value = [];
  settings.value = {};
});

describe('Review Transcript card', () => {
  it('renders nothing until a run has a result', () => {
    processResult.value = null;
    const { container } = render(<Transcript />);
    expect(container.querySelector('#previewCard')).toBeNull();
  });

  it('renders the compact preview + a token/line info line', () => {
    const { container } = render(<Transcript />);
    expect(container.querySelector('#previewCard')).not.toBeNull();
    expect(container.querySelector('#previewContent').textContent).toContain(
      'hello there',
    );
    // The estimate is prefixed with ~ unless accurate counting is on.
    expect(container.querySelector('#previewInfo').textContent).toMatch(
      /lines · .* chars · ~.* tokens/,
    );
  });

  it('hides the channel selector for a single group, shows it for many', () => {
    const { container, rerender } = render(<Transcript />);
    expect(container.querySelector('#previewGroup')).toBeNull();
    processedOutputs.value = [group('general'), group('random')];
    rerender(<Transcript />);
    const sel = container.querySelector('#previewGroup');
    expect(sel).not.toBeNull();
    expect(sel.querySelectorAll('option')).toHaveLength(2);
  });

  it('copies the full preview text to the clipboard', async () => {
    let copied = '';
    navigator.clipboard = {
      writeText: (t) => {
        copied = t;
        return Promise.resolve();
      },
    };
    const { container } = render(<Transcript />);
    fireEvent.click(container.querySelector('#copyPreview'));
    await Promise.resolve();
    expect(copied).toContain('hello there');
  });
});
