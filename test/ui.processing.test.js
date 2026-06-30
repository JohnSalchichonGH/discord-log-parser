import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h } from 'preact';
import { render } from '@testing-library/preact';

// Mock the worker client so we control which path computeOutputs takes (jsdom has
// no real Worker). getWorker defaults to null → the inline main-thread path.
vi.mock('../src/ui/worker-client.js', () => ({
  getWorker: vi.fn(() => null),
  workerRequest: vi.fn(),
  fileKey: (f) => `${f.name}|${f.size}|${f.lastModified}`,
  markWorkerBroken: vi.fn(),
}));

import {
  getWorker,
  workerRequest,
  markWorkerBroken,
} from '../src/ui/worker-client.js';
import { addFiles } from '../src/ui/files.js';
import { runProcessing, computeOutputs } from '../src/ui/processing.js';
import {
  ProcessProgress,
  ProcessStatus,
} from '../src/ui/views/ProcessProgress.jsx';
import {
  loadedFiles,
  botUsers,
  selectedUsers,
  authorEntries,
  parseSummary,
  processedOutputs,
  processResult,
  insightContext,
  processing,
  exportSummary,
} from '../src/ui/store.js';
import { settings } from '../src/ui/settings.js';

const mkJson = (chanId, name, authors, content = 'hi') =>
  JSON.stringify({
    guild: { id: '9', name: 'G' },
    channel: { id: chanId, type: 'GuildTextChat', name },
    dateRange: { after: null, before: null },
    messages: authors.flatMap((a) =>
      Array.from({ length: a.count }, (_, i) => ({
        id: `${chanId}-${a.id}-${i}`,
        type: 'Default',
        timestamp: '2025-07-12T03:50:00+00:00',
        content,
        author: { id: a.id, name: a.name, nickname: a.name, isBot: false },
        attachments: [],
        embeds: [],
        stickers: [],
        reactions: [],
      })),
    ),
    messageCount: authors.reduce((s, a) => s + a.count, 0),
  });

const file = (name, content) =>
  new File([content], name, { type: 'application/json' });

// A complete-enough pipeline opts for direct computeOutputs() calls (runProcessing
// builds the full object itself).
const baseOpts = () => ({
  minMsgs: 0,
  maxTokens: 1375000,
  maxChars: 5500000,
  keywords: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  getWorker.mockReturnValue(null); // inline path by default
  loadedFiles.value = [];
  authorEntries.value = [];
  selectedUsers.value = new Set();
  botUsers.value = new Set();
  parseSummary.value = null;
  processedOutputs.value = [];
  processResult.value = null;
  insightContext.value = null;
  exportSummary.value = null;
  processing.value = { active: false, pct: 0, status: '', kind: '', engine: '' };
  settings.value = {};
});

describe('ProcessProgress / ProcessStatus views', () => {
  it('shows the bar (active) and fill width from the processing signal', () => {
    processing.value = { active: true, pct: 40, status: '', kind: '', engine: '' };
    const { container } = render(h(ProcessProgress, {}));
    const bar = container.querySelector('.progress-bar');
    expect(bar.classList.contains('active')).toBe(true);
    expect(container.querySelector('.progress-fill').style.width).toBe('40%');
  });

  it('hides the bar when no run is active', () => {
    processing.value = { active: false, pct: 0, status: '', kind: '', engine: '' };
    const { container } = render(h(ProcessProgress, {}));
    expect(
      container.querySelector('.progress-bar').classList.contains('active'),
    ).toBe(false);
  });

  it('renders the status text + kind class + engine diagnostic', () => {
    processing.value = {
      active: false,
      pct: 100,
      status: 'Processed 5 messages → 5 kept',
      kind: 'success',
      engine: 'inline',
    };
    const { container } = render(h(ProcessStatus, {}));
    const bar = container.querySelector('.status-bar');
    expect(bar.textContent).toContain('Processed 5 messages');
    expect(bar.classList.contains('success')).toBe(true);
    expect(bar.getAttribute('data-engine')).toBe('inline');
  });
});

describe('runProcessing (inline path)', () => {
  it('writes outputs, totals, export + insight context, and a success status', async () => {
    await addFiles([
      file(
        'G - general [1].json',
        mkJson('1', 'general', [
          { id: 'a', name: 'alice', count: 3 },
          { id: 'b', name: 'bob', count: 2 },
        ]),
      ),
    ]);

    await runProcessing();

    expect(processing.value.engine).toBe('inline');
    expect(processing.value.kind).toBe('success');
    expect(processing.value.pct).toBe(100);
    expect(processing.value.status).toContain('5 messages');

    expect(processedOutputs.value).toHaveLength(1);
    expect(processResult.value).toEqual({
      totalMessages: 5,
      totalFiltered: 5,
      totalKept: 5,
    });
    expect(exportSummary.value).toEqual({
      kept: 5,
      total: 5,
      budgetExceeded: false,
    });
    expect(insightContext.value.files).toHaveLength(1);
    expect(insightContext.value.opts).toBeTruthy();
  });

  it('clears the previous result and shows the bar at the start of a run', async () => {
    processedOutputs.value = [{ name: 'stale' }];
    processResult.value = { totalMessages: 9, totalFiltered: 9, totalKept: 9 };

    await addFiles([
      file('G - g [1].json', mkJson('1', 'g', [{ id: 'a', name: 'a', count: 1 }])),
    ]);

    // Capture the in-flight state synchronously (before the awaited pipeline).
    const inFlight = runProcessing();
    expect(processing.value.active).toBe(true);
    expect(processedOutputs.value).toEqual([]);
    expect(processResult.value).toBeNull();
    await inFlight;
  });

  it('reports an empty parse with the locale hint (error kind, no export)', async () => {
    // A well-formed export the parser reads as zero messages (e.g. a locale that
    // broke HTML/TXT date parsing) → the "No messages found" branch.
    await addFiles([file('G - g [1].json', mkJson('1', 'g', []))]);

    await runProcessing();

    expect(processResult.value.totalMessages).toBe(0);
    expect(processing.value.kind).toBe('error');
    expect(processing.value.status).toContain('No messages found');
    expect(exportSummary.value).toBeNull();
  });
});

describe('computeOutputs engine selection', () => {
  it('uses the worker when available and tags the result engine="worker"', async () => {
    // No addFiles here (files=[]), so the only worker calls are computeOutputs'.
    getWorker.mockReturnValue({});
    workerRequest.mockResolvedValue({
      outputs: [{ name: 'w', finalChunks: [], userMap: new Map() }],
      totalMessages: 7,
      totalFiltered: 7,
      totalKept: 7,
    });

    const res = await computeOutputs([], {}, false);

    expect(workerRequest).toHaveBeenCalledOnce();
    expect(res.engine).toBe('worker');
    expect(res.totalMessages).toBe(7);
  });

  it('falls back to the inline path when the worker throws', async () => {
    // Parse inline first (default null worker), then arm a failing worker.
    await addFiles([
      file('G - g [1].json', mkJson('1', 'g', [{ id: 'a', name: 'a', count: 2 }])),
    ]);
    const validFiles = loadedFiles.value.filter((f) => !f.invalid);
    vi.clearAllMocks();
    getWorker.mockReturnValue({});
    workerRequest.mockRejectedValue(new Error('worker boom'));

    const res = await computeOutputs(validFiles, baseOpts(), false);

    expect(markWorkerBroken).toHaveBeenCalledOnce();
    expect(res.engine).toBe('inline');
    expect(res.totalMessages).toBe(2);
    expect(res.totalKept).toBe(2);
  });

  it('skips the worker entirely on the accurate-token path', async () => {
    await addFiles([
      file('G - g [1].json', mkJson('1', 'g', [{ id: 'a', name: 'a', count: 1 }])),
    ]);
    const validFiles = loadedFiles.value.filter((f) => !f.invalid);
    vi.clearAllMocks();
    getWorker.mockReturnValue({});

    const res = await computeOutputs(validFiles, baseOpts(), true);

    expect(getWorker).not.toHaveBeenCalled();
    expect(workerRequest).not.toHaveBeenCalled();
    expect(res.engine).toBe('inline');
  });
});
