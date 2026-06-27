import { describe, it, expect } from 'vitest';
import {
  parseTimestamp,
  localDate,
  formatTimeDelta,
  formatLongDuration,
  formatAMPM,
} from '../src/core/time.js';

describe('parseTimestamp', () => {
  it('parses DCE en-US TXT shape "M/D/YYYY H:MM AM/PM"', () => {
    const d = parseTimestamp('7/12/2025 3:50 AM');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(6); // July (0-indexed)
    expect(d.getDate()).toBe(12);
    expect(d.getHours()).toBe(3);
    expect(d.getMinutes()).toBe(50);
  });

  it('handles 12 AM as midnight and 12 PM as noon', () => {
    expect(parseTimestamp('1/1/2025 12:00 AM').getHours()).toBe(0);
    expect(parseTimestamp('1/1/2025 12:00 PM').getHours()).toBe(12);
  });

  it('converts PM hours correctly', () => {
    expect(parseTimestamp('1/1/2025 11:05 PM').getHours()).toBe(23);
  });

  it('returns null for unparseable input', () => {
    expect(parseTimestamp('not a date at all')).toBeNull();
  });

  it('parses ISO 8601 via the native Date path', () => {
    const d = parseTimestamp('2025-07-12T03:50:00.000Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(Date.UTC(2025, 6, 12, 3, 50, 0));
  });
});

describe('localDate', () => {
  it('returns start of day by default', () => {
    const d = localDate('2025-07-12', false);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it('returns end of day when requested', () => {
    const d = localDate('2025-07-12', true);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });
});

describe('formatTimeDelta', () => {
  it('formats seconds, minutes, hours', () => {
    expect(formatTimeDelta(5_000)).toBe('[+5s]');
    expect(formatTimeDelta(0)).toBe('[+0s]');
    expect(formatTimeDelta(65_000)).toBe('[+1m]');
    expect(formatTimeDelta(3_700_000)).toBe('[+1h]');
  });
});

describe('formatLongDuration', () => {
  it('omits the hour component below 1h', () => {
    expect(formatLongDuration(5 * 60_000)).toBe('5m');
  });
  it('includes hours and minutes', () => {
    expect(formatLongDuration((5 * 60 + 12) * 60_000)).toBe('5h 12m');
  });
});

describe('formatAMPM', () => {
  it('formats a 12-hour clock with zero-padded minutes', () => {
    expect(formatAMPM(new Date(2025, 0, 1, 3, 5))).toBe('3:05 AM');
    expect(formatAMPM(new Date(2025, 0, 1, 0, 0))).toBe('12:00 AM');
    expect(formatAMPM(new Date(2025, 0, 1, 12, 0))).toBe('12:00 PM');
    expect(formatAMPM(new Date(2025, 0, 1, 23, 59))).toBe('11:59 PM');
  });
});
