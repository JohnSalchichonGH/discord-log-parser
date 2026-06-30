import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import preact from '@preact/preset-vite';

// Inject a strict CSP into the BUILT file only (a meta CSP in the dev HTML would
// block Vite's HMR websocket). connect-src 'none' guarantees no data can leave
// the browser — everything is inlined, so 'unsafe-inline' is unavoidable but the
// lockdown of network/base/form is the meaningful defense-in-depth.
function injectCsp() {
  const csp = [
    "default-src 'none'",
    // 'unsafe-inline' covers the inlined app script; blob: covers the inlined
    // Web Worker (vite-plugin-singlefile emits it as a blob URL).
    "script-src 'unsafe-inline' blob:",
    'worker-src blob:',
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

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
    plugins: [preact(), injectCsp(), viteSingleFile()],
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
