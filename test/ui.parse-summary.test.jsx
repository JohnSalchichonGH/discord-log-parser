import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ParseSummary } from '../src/ui/views/ParseSummary.jsx';
import { parseSummary } from '../src/ui/store.js';

afterEach(() => {
  cleanup();
  parseSummary.value = null;
});

describe('ParseSummary', () => {
  it('renders nothing when there is no summary', () => {
    const { container } = render(<ParseSummary />);
    expect(container.textContent).toBe('');
  });

  it('renders the counts and reacts to the store signal', () => {
    parseSummary.value = {
      messages: 48392,
      participants: 17,
      files: 5,
      channels: 3,
    };
    const { container, getByText } = render(<ParseSummary />);
    expect(container.textContent).toContain('Conversation found');
    expect(getByText('48,392')).toBeTruthy(); // localized
    expect(getByText('participants')).toBeTruthy();
    expect(getByText('channels')).toBeTruthy();
  });

  it('singularizes file/channel labels for a count of 1', () => {
    parseSummary.value = {
      messages: 10,
      participants: 2,
      files: 1,
      channels: 1,
    };
    const { getByText } = render(<ParseSummary />);
    expect(getByText('file')).toBeTruthy();
    expect(getByText('channel')).toBeTruthy();
  });
});
