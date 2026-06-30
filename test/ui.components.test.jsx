import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import {
  Button,
  Card,
  Badge,
  StatCard,
  Toggle,
  Tabs,
  Disclosure,
} from '../src/ui/components/index.js';

afterEach(cleanup);

describe('Button', () => {
  it('renders a native <button> with variant classes', () => {
    const { getByText } = render(<Button variant="primary">Go</Button>);
    const el = getByText('Go');
    expect(el.tagName).toBe('BUTTON');
    expect(el.className).toContain('btn');
    expect(el.className).toContain('btn-primary');
    expect(el.getAttribute('type')).toBe('button');
  });
});

describe('Toggle', () => {
  it('is an accessible switch reflecting checked state', () => {
    const { getByRole } = render(
      <Toggle checked label="Dark" onChange={() => {}} />,
    );
    const sw = getByRole('switch');
    expect(sw.tagName).toBe('BUTTON'); // focusable, unlike the legacy hidden checkbox
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('calls onChange with the negated value on click', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <Toggle checked={false} label="Dark" onChange={onChange} />,
    );
    fireEvent.click(getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Disclosure', () => {
  it('toggles aria-expanded and reveals its body', () => {
    const { getByRole, queryByText } = render(
      <Disclosure summary="Advanced">
        <p>secret</p>
      </Disclosure>,
    );
    const head = getByRole('button');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(queryByText('secret')).toBeNull();
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(queryByText('secret')).not.toBeNull();
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];

  it('marks the active tab and selects on click', () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <Tabs tabs={tabs} active="a" onSelect={onSelect} />,
    );
    expect(getByText('A').getAttribute('aria-selected')).toBe('true');
    expect(getByText('B').getAttribute('aria-selected')).toBe('false');
    fireEvent.click(getByText('B'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('moves selection with ArrowRight (roving focus)', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <Tabs tabs={tabs} active="a" onSelect={onSelect} />,
    );
    fireEvent.keyDown(getByRole('tablist'), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});

describe('Card / Badge / StatCard', () => {
  it('Card renders title, desc and children', () => {
    const { getByText } = render(
      <Card title="T" desc="D">
        <span>body</span>
      </Card>,
    );
    expect(getByText('T').className).toContain('card-title');
    expect(getByText('D').className).toContain('card-desc');
    expect(getByText('body')).toBeTruthy();
  });

  it('Badge and StatCard render their values', () => {
    const badge = render(<Badge variant="dated">v1</Badge>);
    expect(badge.getByText('v1').className).toContain('badge-dated');
    const stat = render(<StatCard value="42" label="messages" />);
    expect(stat.getByText('42').className).toContain('stat-value');
    expect(stat.getByText('messages').className).toContain('stat-label');
  });
});
