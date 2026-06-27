// Post-build step for `build:accurate`: move the accurate single-file output to
// dist/index-accurate.html (next to the lean dist/index.html) and clean up.
import { renameSync, rmSync, existsSync } from 'node:fs';

const src = 'dist/_accurate/index.html';
const dest = 'dist/index-accurate.html';

if (!existsSync(src)) {
  console.error('accurate build not found at', src);
  process.exit(1);
}
if (existsSync(dest)) rmSync(dest);
renameSync(src, dest);
rmSync('dist/_accurate', { recursive: true, force: true });
console.log('wrote', dest);
