import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The app is developed as ES modules under `src/` and built into a single,
// dependency-free `dist/index.html` (everything inlined) to preserve the
// "double-click to run, no server" promise of the original tool.
export default defineConfig({
  root: 'src',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Inline everything; no separate asset files.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
});
