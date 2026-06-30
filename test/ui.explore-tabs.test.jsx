import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ExploreTabs } from '../src/ui/views/ExploreTabs.jsx';
import { exploreTab } from '../src/ui/store.js';

afterEach(() => {
  cleanup();
  exploreTab.value = 'summary';
});

describe('ExploreTabs', () => {
  it('renders all six tabs as a tablist, Summary active by default', () => {
    const { getByRole, getByText } = render(<ExploreTabs />);
    expect(getByRole('tablist')).toBeTruthy();
    [
      'Summary',
      'Transcript',
      'Insights',
      'Calendar',
      'Wrapped',
      'Technical',
    ].forEach((l) => expect(getByText(l)).toBeTruthy());
    expect(getByText('Summary').getAttribute('aria-selected')).toBe('true');
  });

  it('switches the store signal on click', () => {
    const { getByText } = render(<ExploreTabs />);
    fireEvent.click(getByText('Insights'));
    expect(exploreTab.value).toBe('insights');
    expect(getByText('Insights').getAttribute('aria-selected')).toBe('true');
    expect(getByText('Summary').getAttribute('aria-selected')).toBe('false');
  });
});
