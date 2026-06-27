// App entry point. Imports are bundled and inlined into a single dist/index.html
// by vite-plugin-singlefile, so the built file makes ZERO network requests.

// Self-hosted variable fonts (latin + latin-ext, weight axis). These replace the
// legacy Google Fonts <link>, honoring the tool's "no network requests" promise.
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';

import './ui/styles.css';
import './ui/app.js';
