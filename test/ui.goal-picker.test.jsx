import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { GoalPicker } from '../src/ui/views/GoalPicker.jsx';
import { goal } from '../src/ui/store.js';

afterEach(() => {
  cleanup();
  goal.value = 'custom';
});

describe('GoalPicker', () => {
  it('renders the four goals as a radiogroup', () => {
    const { getByRole, getByText } = render(<GoalPicker />);
    expect(getByRole('radiogroup')).toBeTruthy();
    ['Complete transcript', 'Compact text', 'Data export', 'Custom'].forEach(
      (label) => expect(getByText(label)).toBeTruthy(),
    );
  });

  it('marks the active goal and updates the store on click', () => {
    const { getByText } = render(<GoalPicker />);
    const card = (label) => getByText(label).closest('button');
    // default is custom
    expect(card('Custom').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(card('Complete transcript'));
    expect(goal.value).toBe('complete');
    expect(card('Complete transcript').getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(card('Custom').getAttribute('aria-checked')).toBe('false');
  });
});
