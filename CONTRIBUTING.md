# Contributing & architecture

The app is developed as plain ES modules under `src/` and bundled with Vite into a
single, dependency-free `dist/index.html` (all JS, CSS and fonts inlined) so the
"double-click to run, no server" experience is preserved. Parsing, processing,
analytics and rendering live in small tested modules; `src/ui/app.js` is the thin
DOM glue that wires them to the page.

## Scripts

```bash
npm run dev          # live dev server with HMR
npm run dev:accurate # dev with the real BPE tokenizer bundled
npm test             # Vitest suite (130 tests across 16 files)
npm run coverage     # tests + V8 coverage → coverage/ (lcov + html)
npm run lint         # ESLint
npm run format       # Prettier --write   (format:check verifies, CI-enforced)
npm run build        # lean standalone dist/index.html
npm run build:all    # also build dist/index-accurate.html
```

CI (GitHub Actions, `.github/workflows/ci.yml`) runs lint, format check, the test
suite with coverage (uploaded to Codecov), and both builds on every push.

## The two builds

| File                       | Size    | Token counting                                                 |
| -------------------------- | ------- | -------------------------------------------------------------- |
| `dist/index.html`          | ~555 KB | Fast `1 token ≈ 4 chars` estimate                              |
| `dist/index-accurate.html` | ~2.6 MB | Real BPE tokenizer (GPT `cl100k_base`) behind an opt-in toggle |

A build-time flag dead-code-eliminates the tokenizer from the lean build, so the
default file stays small.

## Module layout

| Path            | Contents                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/core/`     | grouping, pipeline, identity/dedup, chunking, `analytics.js`, `wrapped.js` stats, token estimation, time/format helpers |
| `src/parsers/`  | JSON, HTML and TXT export parsers (parse once into format-independent raw messages)                                     |
| `src/render/`   | TXT / JSON / Markdown / CSV renderers                                                                                   |
| `src/ui/`       | `app.js` (DOM controller) + `insights.js`, `calendar.js`, `wrapped.js` visualizers                                      |
| `src/worker.js` | Web Worker: off-main-thread parse + pipeline + analytics (with a main-thread fallback)                                  |
| `test/`         | Vitest suites + synthetic DiscordChatExporter fixtures                                                                  |

## How identity & de-duplication work

This is the subtle part, so here's the model in full.

**Parsing.** Each parser turns a file into format-independent _raw_ messages
(`assemble.js`). HTML and JSON carry a stable Discord user ID (`data-user-id` /
`author.id`) and message ID (snowflake); `.txt` carries neither.

**Identity is global.** `buildIdentity()` resolves people **once across every file**
(not per channel group), and that shared identity is threaded into each group's
`processGroup`, so a person active in several channels is a single identity in the
export legend, the statistics, and all the analytics.

- A person is keyed by their Discord user ID. `.txt` authors (no ID) are matched by
  display name — and each id-backed user's **username** (HTML author `title`, JSON
  `author.name`) is registered as an alias of their identity. Since `.txt` writes
  people by username, a `.txt` line by `kang0420` resolves to the same identity as
  their id-backed nickname `k`.
- **Remade-account merging.** One person who deletes and recreates their account
  shows up as several IDs sharing a nickname. They're auto-merged when they share a
  nickname **and** have similar usernames (Levenshtein) **and** non-overlapping
  activity — the signature of an account remake (`cheezy_mcsqueezy0w0` → `…0_0` →
  `…0.0`). Different people who merely share a nickname (different usernames,
  overlapping activity) stay separate.
- Each identity is labeled with its most recent **real** nickname — placeholders
  (`Deleted User`, `Unknown`) are skipped when a real one exists, so a since-deleted
  user still shows the last real nick any export captured. Labeling is
  order-independent, and distinct people who still collide on a label are
  disambiguated (`kot`, `kot (2)`).
- Identity is a stable internal id; "Use real names" only changes the display
  token (it re-keys by the now-unique label), so it can no longer merge two
  different people who happen to share a name.

**Message-content bridge.** A user renamed between exports can appear under a
nick that no id-bearing export recorded (e.g. an old TXT nick), which name/
username aliasing can't link — so the same messages split into two identities. A
keyless (TXT) author whose messages overwhelmingly match one id-bearing identity
(same normalized text + UTC day) is folded into it. The guard (≥ 8 matches and a
majority of that author's text messages) makes coincidental collisions
impossible to act on; it only runs when TXT is mixed with an id-bearing format.

**De-duplication.** HTML/JSON messages de-dupe by snowflake ID. `.txt` messages (no
IDs, minute-resolution clock in an unknown timezone) can't be matched by ID or exact
time, so they're identified by a **content signature** — resolved author + UTC day +
normalized text. Id-bearing copies are authoritative: a `.txt` copy of an HTML/JSON
message is dropped, while a message only the `.txt` captured (e.g. one deleted before
the richer export was taken) is kept. Genuine same-text repeats within a file survive
by counting the maximum occurrences in any single file.

This is why format quality runs **JSON > HTML > TXT**, and why `.txt` reconciliation
is best-effort (day-granularity matching can rarely over-merge identical same-day
messages across channels).

## Conventions

- Keep logic in `src/core` / `src/parsers` / `src/render` and cover it with tests;
  `src/ui` stays a thin layer.
- Run `npm run format` and `npm test` before pushing — CI enforces both.
- `reference/legacy-index.html` is the original single-file build, kept as a
  behavior oracle.
