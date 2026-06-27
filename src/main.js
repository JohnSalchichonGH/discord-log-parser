// App entry point. For now this only wires a build-smoke marker that proves the
// module graph is bundled and inlined correctly. The full wizard UI will be
// migrated here from the legacy ../index.html across subsequent Phase 0 steps.
import { formatBytes } from './core/format.js';

const app = document.getElementById('app');
if (app) {
  app.dataset.smoke = `build-ok:${formatBytes(1536)}`;
}
