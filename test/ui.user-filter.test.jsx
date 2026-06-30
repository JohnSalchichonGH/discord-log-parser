import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { UserFilter } from '../src/ui/views/UserFilter.jsx';
import { authorEntries, selectedUsers, botUsers } from '../src/ui/store.js';

beforeEach(() => {
  authorEntries.value = [
    ['alice', 12],
    ['bot-bob', 3],
  ];
  selectedUsers.value = new Set();
  botUsers.value = new Set();
});
afterEach(cleanup);

describe('UserFilter', () => {
  it('renders one row per author with its message count', () => {
    const { container } = render(<UserFilter />);
    const items = container.querySelectorAll('.user-item');
    expect(items).toHaveLength(2);
    expect(container.querySelector('#userFilterList').textContent).toContain(
      'alice',
    );
  });

  it('tracks the selection in the store and the count label', () => {
    const { container, getByText } = render(<UserFilter />);
    expect(getByText('none selected = everyone')).toBeTruthy();

    const alice = container.querySelector('input[value="alice"]');
    fireEvent.change(alice, { target: { checked: true } });
    expect(selectedUsers.value.has('alice')).toBe(true);
    expect(getByText('1 selected')).toBeTruthy();
  });

  it('select-all and clear-all drive the whole set', () => {
    const { container } = render(<UserFilter />);
    fireEvent.click(container.querySelector('#userSelectAll'));
    expect(selectedUsers.value.size).toBe(2);
    fireEvent.click(container.querySelector('#userClearAll'));
    expect(selectedUsers.value.size).toBe(0);
  });

  it('toggles a bot tag into the botUsers set', () => {
    const { container } = render(<UserFilter />);
    const tag = container.querySelectorAll('.bot-tag')[1]; // bot-bob's row
    expect(tag.textContent).toBe('bot?');
    fireEvent.click(tag);
    expect(botUsers.value.has('bot-bob')).toBe(true);
  });
});
