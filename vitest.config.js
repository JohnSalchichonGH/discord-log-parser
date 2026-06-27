import { defineConfig } from 'vitest/config';

// Unit/integration tests run under jsdom so DOM-dependent parsers
// (DOMParser, etc.) work the same as in the browser.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    globals: false,
  },
});
