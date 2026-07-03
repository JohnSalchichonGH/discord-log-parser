import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { Configure } from '../src/ui/views/Configure.jsx';
import { settings, getSetting } from '../src/ui/settings.js';

// Reset the store to "unset" between tests; getSetting falls back to DEFAULTS.
afterEach(() => {
  cleanup();
  settings.value = {};
});

const toggle = (getByText, label) => getByText(label).closest('button');

describe('Configure', () => {
  it('renders the settings cards', () => {
    const { getByText } = render(<Configure />);
    [
      'Token Budget & Model',
      'Date Range',
      'Filters',
      'Keyword Priority',
      'Privacy & Redaction',
      'Custom Preamble',
    ].forEach((t) => expect(getByText(t)).toBeTruthy());
  });

  it('keeps the AI cards tagged .ai-setting for the goal-picker CSS', () => {
    const { container } = render(<Configure />);
    // Token budget, keyword priority and preamble collapse for non-AI goals.
    expect(container.querySelectorAll('.ai-setting')).toHaveLength(3);
  });

  it('derives the character-budget label from max tokens', () => {
    const { getByText, container } = render(<Configure />);
    expect(getByText('3.6M')).toBeTruthy(); // default 1,375,000 tokens x 2.6
    const input = container.querySelector('#maxTokens');
    fireEvent.input(input, { target: { value: '200000' } });
    expect(getSetting('maxTokens')).toBe('200000');
    expect(getByText('520K')).toBeTruthy();
  });

  it('sets max tokens from the model preset', () => {
    const { container } = render(<Configure />);
    fireEvent.change(container.querySelector('#modelPreset'), {
      target: { value: '128000' },
    });
    expect(getSetting('modelPreset')).toBe('128000');
    expect(getSetting('maxTokens')).toBe('128000');
    // "Custom…" leaves max tokens editable (unchanged).
    fireEvent.change(container.querySelector('#modelPreset'), {
      target: { value: 'custom' },
    });
    expect(getSetting('maxTokens')).toBe('128000');
  });

  it('reveals the minimum-messages input only when low-activity is on', () => {
    const { getByText, container } = render(<Configure />);
    expect(container.querySelector('#minMessages')).toBeNull();
    fireEvent.click(toggle(getByText, 'Exclude low-activity users'));
    expect(getSetting('filterLowActivity')).toBe(true);
    expect(container.querySelector('#minMessages')).not.toBeNull();
  });

  it('keeps real-names and anonymize mutually exclusive', () => {
    const { getByText } = render(<Configure />);
    const real = toggle(getByText, 'Use real usernames');
    const anon = toggle(getByText, 'Anonymize header');

    fireEvent.click(real);
    expect(getSetting('useRealNames')).toBe(true);
    // Turning real names on disables the anonymize switch.
    expect(anon.disabled).toBe(true);

    // Turning anonymize on (after re-enabling) clears real names.
    settings.value = { ...settings.value, useRealNames: false };
    fireEvent.click(toggle(getByText, 'Anonymize header'));
    expect(getSetting('redactNames')).toBe(true);
    expect(getSetting('useRealNames')).toBe(false);
  });

  it('renders the user filter inside the Filters card', () => {
    const { container } = render(<Configure />);
    expect(container.querySelector('#userFilterList')).not.toBeNull();
    expect(container.querySelector('#userFilterHeader')).not.toBeNull();
  });

  it('omits the accurate-token toggle in the lean build', () => {
    const { queryByText } = render(<Configure />);
    expect(queryByText('Accurate token counting')).toBeNull();
  });

  it('binds the keyword and preamble textareas to the store', () => {
    const { container } = render(<Configure />);
    fireEvent.input(container.querySelector('#keywordInput'), {
      target: { value: 'deploy\nbug' },
    });
    fireEvent.input(container.querySelector('#customPreamble'), {
      target: { value: 'system prompt' },
    });
    expect(getSetting('keywords')).toBe('deploy\nbug');
    expect(getSetting('preamble')).toBe('system prompt');
  });
});
