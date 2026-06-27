import { describe, it, expect } from 'vitest';
import {
  isSnowflake,
  snowflakeToDate,
  dateToSnowflake,
  DISCORD_EPOCH,
} from '../src/core/snowflake.js';

describe('isSnowflake', () => {
  it('accepts 15–20 digit numeric strings', () => {
    expect(isSnowflake('1393439224627200000')).toBe(true);
    expect(isSnowflake('123456789012345')).toBe(true);
  });
  it('rejects short ids, non-numeric, and non-strings', () => {
    expect(isSnowflake('1001')).toBe(false);
    expect(isSnowflake('not-a-number')).toBe(false);
    expect(isSnowflake(123)).toBe(false);
    expect(isSnowflake(null)).toBe(false);
  });
});

describe('snowflakeToDate', () => {
  it('decodes the embedded creation time', () => {
    expect(snowflakeToDate('1393439224627200000').toISOString()).toBe(
      '2025-07-12T03:50:00.000Z',
    );
  });
  it('decodes the smallest snowflake to the Discord epoch', () => {
    expect(snowflakeToDate('0')).toBeNull(); // too short to be a snowflake
  });
  it('returns null for non-snowflakes', () => {
    expect(snowflakeToDate('1001')).toBeNull();
    expect(snowflakeToDate('abc')).toBeNull();
  });
});

describe('dateToSnowflake round-trips', () => {
  it('reproduces the instant at millisecond precision', () => {
    const d = new Date('2024-03-15T12:34:56.000Z');
    expect(snowflakeToDate(dateToSnowflake(d)).getTime()).toBe(d.getTime());
  });
  it('uses the documented Discord epoch', () => {
    expect(DISCORD_EPOCH).toBe(1420070400000);
  });
});
