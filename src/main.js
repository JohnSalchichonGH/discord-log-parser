// App entry point. Imports are bundled and inlined into a single dist HTML file
// by vite-plugin-singlefile, so the built file makes ZERO network requests.

// Self-hosted variable fonts (latin + latin-ext, weight axis). These replace the
// legacy Google Fonts <link>, honoring the tool's "no network requests" promise.
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';

import './ui/styles.css';

// __ACCURATE__ is replaced with a literal at build time (see vite.config.js).
// In the default (lean) build it is `false`, so the accurate branch — and the
// BPE tokenizer it pulls in — is dead-code-eliminated entirely. The accurate
// build sets it `true` to register the real tokenizer before the UI initializes.
async function boot() {
  if (__ACCURATE__) {
    const { setAccurateLoader } = await import('./core/token-config.js');
    const { loadBpeCounter } = await import('./core/tokenizer-bpe.js');
    setAccurateLoader(loadBpeCounter);
  }
  await import('./ui/bootstrap.jsx'); // mounts the Preact shell into #app
}
boot();
