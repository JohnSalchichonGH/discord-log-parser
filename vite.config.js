import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The app is developed as ES modules under `src/` and built into a single,
// dependency-free HTML file (everything inlined) to preserve the
// "double-click to run, no server" promise of the original tool.
//
// Two build modes:
//   default          -> dist/index.html        (lean, char/4 token estimate)
//   --mode accurate  -> dist/_accurate/index.html (bundles the real BPE tokenizer)
// The accurate output is renamed to dist/index-accurate.html by build:accurate.
export default defineConfig(({ mode }) => {
  const accurate = mode === 'accurate';
  return {
    root: 'src',
    plugins: [viteSingleFile()],
    define: {
      // Build-time flag so the BPE tokenizer is dead-code-eliminated from the
      // lean build instead of merely lazy-loaded (single-file inlines chunks).
      __ACCURATE__: JSON.stringify(accurate),
    },
    build: {
      outDir: accurate ? '../dist/_accurate' : '../dist',
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
    },
  };
});
