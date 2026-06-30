import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Unit/integration tests run under jsdom so DOM-dependent parsers
// (DOMParser, etc.) work the same as in the browser. The Preact preset adds the
// JSX transform so component tests (@testing-library/preact) can render .jsx.
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{js,jsx}'],
    globals: false,
    coverage: {
      provider: 'v8',
      // `lcov` emits coverage/lcov.info for Codecov; `text` prints a summary in
      // the CI log; `html` is handy for local inspection.
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      // Worker entry + the tokenizer shim aren't exercised by the jsdom suite.
      exclude: ['src/worker.js', 'src/core/tokenizer-bpe.js'],
    },
  },
});
