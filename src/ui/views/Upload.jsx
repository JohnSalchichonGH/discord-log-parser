// The Upload step (panel1): drop zone + file input, the loaded-file list with
// per-file remove, and the auto/manual merge-group preview. Renders from the
// `loadedFiles` store signal; all parsing/grouping lives in ui/files.js.
//
// The user-filter list is a sibling concern (it renders inside the Configure
// step's Filters card, ui/views/UserFilter.jsx) but is driven by the same store
// signals this view's files.js helpers populate.

import { useState } from 'preact/hooks';
import { loadedFiles } from '../store.js';
import { addFiles, removeFile, mergeGroups } from '../files.js';
import { buildGroups } from '../../core/grouping.js';
import { formatBytes } from '../../core/format.js';

const ACCEPTED = ['.html', '.txt', '.json'];
const accepted = (name) =>
  ACCEPTED.some((ext) => name.toLowerCase().endsWith(ext));

const modDate = (ms) =>
  new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function Upload() {
  const files = loadedFiles.value;
  const valid = files.filter((f) => !f.invalid);
  const groups = [...buildGroups(valid)];
  const hasFiles = files.length > 0;

  const [dragOver, setDragOver] = useState(false);
  // Group keys checked for a manual merge — local UI state; merging re-keys the
  // files and the list rebuilds, so the selection clears naturally.
  const [selected, setSelected] = useState(() => new Set());

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      accepted(f.name),
    );
    if (dropped.length) addFiles(dropped);
  };
  const onPick = (e) => {
    const picked = Array.from(e.target.files);
    if (picked.length) addFiles(picked);
    e.target.value = ''; // allow re-selecting the same files
  };

  const toggleGroup = (key, on) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    setSelected(next);
  };
  const doMerge = () => {
    const keys = groups.map(([k]) => k).filter((k) => selected.has(k));
    if (keys.length < 2) return;
    setSelected(new Set());
    mergeGroups(keys);
  };

  const selCount = groups.filter(([k]) => selected.has(k)).length;

  return (
    <div class="panel-card">
      <div class="card-title">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        Upload Files
      </div>
      <div class="card-desc">
        Drop one or more <strong>.json</strong> (recommended),{' '}
        <strong>.html</strong>, or <strong>.txt</strong> Discord exports. Files
        from the same channel are automatically merged. Use the checkboxes below
        to manually merge groups that belong together.
      </div>

      <div
        class={
          'drop-zone' +
          (dragOver ? ' drag-over' : '') +
          (hasFiles ? ' has-files' : '')
        }
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <svg
          class="drop-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <div class="drop-label">Drop files here or click to browse</div>
        <div class="drop-hint">
          .json, .html, or .txt files from DiscordChatExporter
        </div>
        <input
          type="file"
          id="fileInput"
          accept=".html,.txt,.json"
          multiple
          aria-label="Upload .json, .html, or .txt Discord export files"
          onChange={onPick}
        />
      </div>

      {hasFiles && (
        <div id="fileListContainer" style="margin-top: 16px">
          <div id="fileList" class="file-list">
            {files.map((f, i) => (
              <div class="file-item" key={f.name + f.size}>
                <svg
                  class="file-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span class="file-name">{f.name}</span>
                {f.invalid ? (
                  <span
                    class="file-size"
                    style="color:var(--danger);"
                    title={f.error || 'Invalid file'}
                  >
                    ⚠ {f.error || 'Invalid file'}
                  </span>
                ) : (
                  <span class="file-size">{formatBytes(f.size)}</span>
                )}
                <button
                  class="file-remove"
                  type="button"
                  title="Remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div class={'merge-toolbar' + (groups.length > 1 ? ' visible' : '')}>
            <span class="merge-toolbar-text">
              <strong>{selCount}</strong> of {groups.length} groups selected
            </span>
            <button
              class="btn btn-secondary"
              type="button"
              style="padding: 6px 12px; font-size: 12px"
              disabled={selCount === groups.length}
              onClick={() => setSelected(new Set(groups.map(([k]) => k)))}
            >
              Select all
            </button>
            <button
              class="btn btn-secondary"
              type="button"
              style="padding: 6px 12px; font-size: 12px"
              disabled={selCount === 0}
              onClick={() => setSelected(new Set())}
            >
              Deselect all
            </button>
            <button
              class="btn btn-primary"
              style="padding: 6px 14px; font-size: 12px"
              disabled={selCount < 2}
              onClick={doMerge}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M17 11H3" />
                <path d="M21 17H3" />
                <path d="M21 7H3" />
              </svg>
              <span>
                {selCount < 2
                  ? 'Select 2+ to merge'
                  : `Merge ${selCount} groups`}
              </span>
            </button>
          </div>

          <div class="merge-groups">
            {groups.map(([key, arr]) => (
              <div
                class={'merge-group' + (selected.has(key) ? ' selected' : '')}
                key={key}
              >
                <label class="merge-header">
                  <input
                    type="checkbox"
                    class="merge-group-cb"
                    checked={selected.has(key)}
                    onChange={(e) => toggleGroup(key, e.currentTarget.checked)}
                  />
                  <span class="merge-title">
                    {arr[0].baseName}
                    {arr.length > 1 ? ` — ${arr.length} files → merged` : ''}
                  </span>
                </label>
                {arr.map((f) => (
                  <div class="merge-file" key={f.name + f.size}>
                    {f.name}{' '}
                    {f.afterDate ? (
                      <span class="badge badge-dated">after {f.afterDate}</span>
                    ) : (
                      <span class="badge badge-base">
                        mod: {modDate(f.sortOrder)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
