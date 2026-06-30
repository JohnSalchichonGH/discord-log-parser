import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ExportSummary } from '../src/ui/views/ExportSummary.jsx';
import { exportSummary, exportFormat } from '../src/ui/store.js';

afterEach(() => {
  cleanup();
  exportSummary.value = null;
  exportFormat.value = 'txt';
});

describe('ExportSummary', () => {
  it('renders nothing before a run', () => {
    const { container } = render(<ExportSummary />);
    expect(container.textContent).toBe('');
  });

  it('says complete when every message is included', () => {
    exportSummary.value = { kept: 9, total: 9, budgetExceeded: false };
    exportFormat.value = 'html';
    const { container } = render(<ExportSummary />);
    expect(container.textContent).toContain('Complete transcript');
    expect(container.textContent).toContain('All 9 messages are included');
    expect(container.textContent).toContain('HTML transcript'); // format label
  });

  it('says trimmed with included/excluded counts', () => {
    exportSummary.value = { kept: 12841, total: 48392, budgetExceeded: false };
    const { container } = render(<ExportSummary />);
    expect(container.textContent).toContain('Trimmed to fit');
    expect(container.textContent).toContain('12,841');
    expect(container.textContent).toContain('48,392');
    expect(container.textContent).toContain('35,551'); // excluded
  });

  it('explains the budget-exceeded case', () => {
    exportSummary.value = { kept: 5, total: 4, budgetExceeded: true };
    const { container } = render(<ExportSummary />);
    expect(container.textContent).toContain('Trimmed to fit');
    expect(container.textContent).toContain('exceed the token budget');
  });
});
