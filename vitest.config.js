import { defineConfig } from 'vitest/config';

// Unit/integration tests run under jsdom so DOM-dependent parsers
// (DOMParser, etc.) work the same as in the browser.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    globals: false,
    coverage: {
      provider: 'v8',
      // `lcov` emits coverage/lcov.info for Codecov; `text` prints a summary in
      // the CI log; `html` is handy for local inspection.
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      // Worker entry + the tokenizer shim aren't exercised by the jsdom suite.
      exclude: ['src/worker.js', 'src/core/tokenizer-bpe.js'],
    },
  },
});
