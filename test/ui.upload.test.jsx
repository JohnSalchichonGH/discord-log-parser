import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { Upload } from '../src/ui/views/Upload.jsx';
import { ensureFileContents } from '../src/ui/files.js';
import {
  loadedFiles,
  authorEntries,
  selectedUsers,
  botUsers,
  parseSummary,
} from '../src/ui/store.js';

beforeEach(() => {
  loadedFiles.value = [];
  authorEntries.value = [];
  selectedUsers.value = new Set();
  botUsers.value = new Set();
  parseSummary.value = null;
});
afterEach(cleanup);

const mkJson = (chanId, name, author) =>
  JSON.stringify({
    guild: { id: '9', name: 'G' },
    channel: { id: chanId, type: 'GuildTextChat', name },
    dateRange: { after: null, before: null },
    messages: [
      {
        id: `${chanId}-1`,
        type: 'Default',
        timestamp: '2025-07-12T03:50:00+00:00',
        content: 'hi',
        author: { id: 'a', name: author, nickname: author, isBot: false },
        attachments: [],
        embeds: [],
        stickers: [],
        reactions: [],
      },
    ],
    messageCount: 1,
  });

const pick = (input, files) => {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
};

describe('Upload', () => {
  it('shows the empty drop zone and no file list', () => {
    const { container } = render(<Upload />);
    expect(container.querySelector('.drop-zone')).not.toBeNull();
    expect(container.querySelector('#fileListContainer')).toBeNull();
  });

  it('loads a picked file into the list and removes it', async () => {
    const { container } = render(<Upload />);
    pick(container.querySelector('#fileInput'), [
      new File([mkJson('1', 'general', 'alice')], 'G - general [1].json', {
        type: 'application/json',
      }),
    ]);

    await waitFor(() =>
      expect(container.querySelector('.file-name').textContent).toContain(
        '.json',
      ),
    );
    expect(loadedFiles.value).toHaveLength(1);

    fireEvent.click(container.querySelector('.file-remove'));
    await waitFor(() => expect(loadedFiles.value).toHaveLength(0));
    expect(container.querySelector('#fileListContainer')).toBeNull();
  });

  it('reveals the merge toolbar and merges two channel groups', async () => {
    const { container } = render(<Upload />);
    pick(container.querySelector('#fileInput'), [
      new File([mkJson('1', 'a', 'alice')], 'G - a [1].json', {
        type: 'application/json',
      }),
      new File([mkJson('2', 'b', 'bob')], 'G - b [2].json', {
        type: 'application/json',
      }),
    ]);

    await waitFor(() =>
      expect(container.querySelectorAll('.merge-group')).toHaveLength(2),
    );
    expect(container.querySelector('.merge-toolbar.visible')).not.toBeNull();

    // Merge stays disabled until 2+ groups are checked, then folds them to one.
    const cbs = container.querySelectorAll('.merge-group-cb');
    cbs.forEach((cb) => fireEvent.change(cb, { target: { checked: true } }));
    const mergeBtn = container.querySelector('.merge-toolbar .btn-primary');
    expect(mergeBtn.disabled).toBe(false);
    fireEvent.click(mergeBtn);

    await waitFor(() =>
      expect(container.querySelectorAll('.merge-group')).toHaveLength(1),
    );
  });

  it('re-reads a released content string from the kept File handle', async () => {
    // Once the worker owns a file's parse, the main thread releases the content
    // string but keeps the File handle; inline paths (accurate tokens / broken
    // worker) call ensureFileContents to restore it on demand.
    const text = mkJson('1', 'general', 'alice');
    const entry = {
      name: 'G - general [1].json',
      content: null, // released
      file: new File([text], 'G - general [1].json', {
        type: 'application/json',
      }),
    };
    await ensureFileContents([entry]);
    expect(entry.content).toBe(text);
    // Entries that still hold content (or invalid ones without a handle) are
    // left untouched.
    const kept = { name: 'x', content: 'already here', file: null };
    await ensureFileContents([kept]);
    expect(kept.content).toBe('already here');
  });

  it('select all / deselect all toggles every group', async () => {
    const { container } = render(<Upload />);
    pick(container.querySelector('#fileInput'), [
      new File([mkJson('1', 'a', 'alice')], 'G - a [1].json', {
        type: 'application/json',
      }),
      new File([mkJson('2', 'b', 'bob')], 'G - b [2].json', {
        type: 'application/json',
      }),
    ]);
    await waitFor(() =>
      expect(container.querySelectorAll('.merge-group')).toHaveLength(2),
    );

    const [selectAll, deselectAll] = container.querySelectorAll(
      '.merge-toolbar .btn-secondary',
    );
    fireEvent.click(selectAll);
    await waitFor(() =>
      expect(
        [...container.querySelectorAll('.merge-group-cb')].every(
          (cb) => cb.checked,
        ),
      ).toBe(true),
    );
    // With all groups selected, merge is enabled.
    expect(
      container.querySelector('.merge-toolbar .btn-primary').disabled,
    ).toBe(false);

    fireEvent.click(deselectAll);
    await waitFor(() =>
      expect(
        [...container.querySelectorAll('.merge-group-cb')].some(
          (cb) => cb.checked,
        ),
      ).toBe(false),
    );
  });
});
