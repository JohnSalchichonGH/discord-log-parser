import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { Export } from '../src/ui/views/Export.jsx';
import {
  processedOutputs,
  exportFormat,
  downloadStatus,
} from '../src/ui/store.js';
import { settings, getSetting } from '../src/ui/settings.js';

function group(name) {
  return {
    name,
    userMap: new Map([['1', 'Alice']]),
    finalChunks: [
      {
        authorId: '1',
        authorName: 'Alice',
        contentParts: ['hello there'],
        timestamp: new Date('2025-07-10T12:00:00Z'),
      },
    ],
  };
}

beforeEach(() => {
  settings.value = {};
  processedOutputs.value = [group('general')];
  exportFormat.value = 'txt';
  downloadStatus.value = { text: '', kind: '' };
});

afterEach(() => {
  cleanup();
  processedOutputs.value = [];
  vi.restoreAllMocks();
});

describe('Export view', () => {
  it('writes the chosen format to the store + the confirmation signal', () => {
    const { container } = render(<Export />);
    fireEvent.change(container.querySelector('#outputFormat'), {
      target: { value: 'json' },
    });
    expect(getSetting('outputFormat')).toBe('json');
    expect(exportFormat.value).toBe('json');
  });

  it('reveals the overlap input only when chunking is enabled', () => {
    const { container } = render(<Export />);
    expect(container.querySelector('#chunkOverlap')).toBeNull();
    fireEvent.click(container.querySelector('#chunkOutput'));
    expect(container.querySelector('#chunkOverlap')).not.toBeNull();
    expect(getSetting('chunkOutput')).toBe(true);
  });

  it('downloads one file per group and reports the count', async () => {
    // Capture the blob anchor click instead of actually navigating.
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();

    processedOutputs.value = [group('general'), group('random')];
    const { container } = render(<Export />);
    fireEvent.click(container.querySelector('#downloadBtn'));

    expect(downloadStatus.value.text).toBe('2 file(s) downloading…');
    expect(downloadStatus.value.kind).toBe('success');

    vi.runAllTimers(); // the staggered setTimeout downloads
    expect(clickSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
