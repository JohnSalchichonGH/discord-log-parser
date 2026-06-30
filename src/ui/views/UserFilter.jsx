// User filter — the per-author include list shown inside the Configure step's
// Filters card. Renders from the store: `authorEntries` (populated by ui/files.js
// when uploads parse), `selectedUsers` (the checked names; an empty set means
// "everyone"), and `botUsers` (names tagged as bots, consumed by the bot filter).
//
// Replaces the legacy static-HTML island that app.js used to populate/wire by id.

import { useState } from 'preact/hooks';
import { authorEntries, selectedUsers, botUsers } from '../store.js';

export function UserFilter() {
  const entries = authorEntries.value;
  const selected = selectedUsers.value;
  const bots = botUsers.value;
  const [open, setOpen] = useState(false);

  const toggleUser = (name, on) => {
    const next = new Set(selected);
    if (on) next.add(name);
    else next.delete(name);
    selectedUsers.value = next;
  };
  const selectAll = (e) => {
    e.preventDefault();
    selectedUsers.value = new Set(entries.map(([name]) => name));
  };
  const clearAll = (e) => {
    e.preventDefault();
    selectedUsers.value = new Set();
  };
  const toggleBot = (e, name) => {
    e.preventDefault();
    e.stopPropagation();
    const next = new Set(bots);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    botUsers.value = next;
  };

  const count = selected.size;

  return (
    <>
      <hr class="section-divider" />
      <div
        class={'collapsible-header' + (open ? ' open' : '')}
        id="userFilterHeader"
        onClick={() => setOpen((o) => !o)}
      >
        <span class="arrow">▶</span>
        User filter
        <span
          class={count ? 'tag tag-accent' : 'tag tag-muted'}
          id="userFilterCount"
        >
          {count ? `${count} selected` : 'none selected = everyone'}
        </span>
      </div>
      <div
        class={'collapsible-body' + (open ? ' open' : '')}
        id="userFilterBody"
      >
        <div class="user-list" id="userFilterList">
          {entries.map(([name, c]) => {
            const isBot = bots.has(name);
            return (
              <label class="user-item" key={name}>
                <input
                  type="checkbox"
                  value={name}
                  checked={selected.has(name)}
                  onChange={(e) => toggleUser(name, e.currentTarget.checked)}
                />
                <span class="user-name">{name}</span>
                <span class="user-count">{c}</span>
                <span
                  class={'bot-tag' + (isBot ? ' active' : '')}
                  title="Click to tag/untag as bot"
                  onClick={(e) => toggleBot(e, name)}
                >
                  {isBot ? 'BOT' : 'bot?'}
                </span>
              </label>
            );
          })}
        </div>
        <div class="user-actions">
          <a id="userSelectAll" onClick={selectAll}>
            Select all
          </a>
          <a id="userClearAll" onClick={clearAll}>
            Clear all
          </a>
        </div>
      </div>
    </>
  );
}
