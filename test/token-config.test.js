import { describe, it, expect } from 'vitest';
import {
  countTokens,
  hasAccurate,
  setAccurateLoader,
  enableAccurate,
  disableAccurate,
} from '../src/core/token-config.js';

// Module state is isolated per test file in Vitest, so this file owns the config.
describe('token-config', () => {
  it('defaults to the char/4 approximation', () => {
    expect(countTokens('x'.repeat(40))).toBe(10);
    expect(hasAccurate()).toBe(false);
  });

  it('switches to a registered accurate counter and back', async () => {
    setAccurateLoader(async () => (t) => t.length); // 1 token per char
    expect(hasAccurate()).toBe(true);

    await enableAccurate();
    expect(countTokens('abcd')).toBe(4);

    disableAccurate();
    expect(countTokens('x'.repeat(40))).toBe(10);
  });
});
