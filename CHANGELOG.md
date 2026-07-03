# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Uploading many large files no longer risks running out of memory.** File
  text used to be held twice forever (page + worker) and posted to the worker
  as one giant message; parsed messages also duplicated author strings once per
  message. Now uploads stream to the worker one file at a time, both sides
  release a file's text as soon as it is parsed (the page keeps the File handle
  and re-reads on demand for the accurate-tokenizer / no-worker paths), and
  repeated strings are interned at parse time. Uploading ~150 MB of exports now
  leaves the page's memory flat instead of holding multiple copies.

### Fixed

- **Merging: which copy of a message survives is now deterministic and
  format-aware.** When the same message appears in several exports, the JSON
  copy wins over HTML (raw markdown over rendered text), and within a format
  the newest export wins (so an edited message keeps its latest wording).
  Previously the oldest file by modification time won — arbitrarily, and with
  a side effect: if an HTML copy was kept, its rendered text never matched the
  TXT twin's raw markdown, leaking duplicates.
- **Merging: TXT copies of formatted messages no longer duplicate.** Dedup
  signatures now normalize across formats — markdown syntax stripped, links
  collapsed to their label, custom-emoji shortcodes and emoji dropped — so the
  rendered text an HTML export carries matches the raw markdown JSON/TXT carry.
- **Merging: TXT files exported in a different timezone are re-anchored to
  UTC.** TXT timestamps are the export machine's wall clock; when it differs
  from the viewer's, every TXT message was shifted (wrong ordering, and
  duplicates leaked near midnight where the dedup day-key missed). Each TXT
  file's offset is now estimated from its own overlap with id-bearing exports
  (median delta across ≥10 distinctive matches, applied only when consistent)
  and the whole file is corrected. TXT-only groups are untouched.
- **Identity: labels now track the most recently EXPORTED nickname.** DCE
  stamps every message with the author's name as of export time (constant per
  file), but labels were picked from whichever file contained the person's
  newest _message_ — so an active channel exported a year ago (old nick, new
  messages) outvoted a quiet channel exported yesterday (new nick, old
  messages). Names are now ranked by the file's export recency — JSON's
  `exportedAt` when present, else the file's newest message — so the freshest
  export decides the label.
- **Identity: renamed users with only a few overlapping messages now unify.**
  The message-content bridge counts only distinctive texts (≥12 chars) as
  evidence and folds at ≥3 matches (was ≥8) — so a person whose old TXT nick
  never appears in an id-bearing export no longer splits into a second identity
  (with duplicated messages) just because the overlap was small. Short
  coincidental texts ("lol") can no longer create or pad a match.

## [1.4.0] - 2026-06-30

Completes the **Preact + Signals** rework begun in 1.3.0: the legacy `app.js`
controller is fully retired and the entire UI now renders from a single Preact
component tree. No user-facing behavior change — still one self-contained,
zero-network HTML file under the same strict CSP, with the parsing / identity /
analytics / render engine unchanged and still behind the full test suite (now
214 tests, up from 173).

### Changed

- **The whole UI is now Preact.** Every wizard step — Upload, Configure, Review,
  and Export — renders from components under `ui/views/`, composed by
  `ui/App.jsx` and mounted by `ui/bootstrap.jsx` into a lone `<div id="app">`.
  The ~1,270-line `app.js` god controller (and `mount.jsx`) are deleted.
- **Application state lives in signals.** Loaded files, bot users, the user
  filter, all Configure settings, output format / chunking, and processing
  status are signals on the store; the export pipeline reads a settings snapshot
  instead of scattered DOM lookups.
- **Wizard navigation** moved into `ui/nav.js` (the `step` signal plus a guarded
  `goToStep`), with the app-specific hooks (have-files? / run-on-entering-Review)
  injected rather than hard-wired into the controller.
- **Processing orchestration** moved into a DOM-free `ui/processing.js` that
  reads files + settings from the store and writes results back; the progress
  bar and status line are now a reactive view.
- **The Review analytics are hosted, not rewritten.** The imperative chart
  renderers (Insights / Calendar / Wrapped, ~1,560 lines) mount once into static
  host skeletons driven by `ui/analytics-host.js`, so Preact reconciliation never
  wipes their generated SVG/HTML.

## [1.3.0] - 2026-06-30

A UI/UX rework that repositions the tool as a **private, local Discord
workspace** — merge, clean, export, and explore — rather than primarily an
"LLM text" utility. The UI now runs on a small **Preact + Signals** layer
(rebuilt incrementally; the parsing/identity/analytics/render engine is
unchanged and still behind the full test suite). Still one self-contained,
zero-network HTML file under the same strict CSP.

### Added

- **"Conversation found" summary** on the Upload step — messages · participants ·
  files · channels — so you immediately see that your files were understood.
- **"What are you making?" goal picker** on the Configure step. Choosing _Complete
  transcript_ or _Data export_ hides the AI/token settings (token budget, keyword
  priority, custom preamble) and preselects a matching format; _Compact text_ and
  _Custom_ show everything. Nothing is removed — _Custom_ is the default.
- **Export confirmation** stating up front whether the export is **complete or
  trimmed** (with included/excluded counts and the selected format), so trimming
  is never a silent surprise.
- **Local-only privacy badge** (_Runs locally · No uploads · No network_) surfaced
  in the UI, not just the docs.

### Changed

- **Reframed** the header, README, and package description around
  merge/clean/export/explore.
- **The Review step is tabbed** (renamed from "Preview"): Summary / Transcript /
  Insights / Calendar / Wrapped / Technical, instead of one long scroll.
- **Settings now live in a signals store** (`ui/settings.js`) with centralized
  localStorage persistence; the export pipeline reads a settings snapshot rather
  than scattered DOM lookups.
- **Accessibility:** the wizard steps are native `<button>`s and the toggle
  checkboxes stay in the keyboard tab order (previously `display:none`).

### Fixed

- **`pipeline.js` is no longer treated as a binary file by git/grep.** A stray NUL
  byte (`\x00`) used as a separator in the content-bridge dedup key made tooling
  classify the whole file as binary — `git diff`/`git blame` showed no line-level
  changes and ripgrep skipped it. Replaced it with the tab delimiter already used
  by the sibling dedup signature. No behavior change (the key is internal only).

## [1.2.0] - 2026-06-29

### Added

- **HTML export.** A new output format that renders the conversation as a
  self-contained, human-readable transcript (open it in any browser, no external
  requests): a participant legend, day dividers and session breaks, per-author
  avatars/colors, reply quotes, media chips, reaction pills and linkified URLs.
  Honors the same redaction options (names / URLs / emails+phones) as the other
  formats; all untrusted content is HTML-escaped. Large transcripts
  (> 2,000 messages) opt into CSS `content-visibility` so the browser skips
  layout/paint of off-screen rows — smooth scrolling at tens of thousands of
  messages while every row stays in the DOM, so native Ctrl-F and printing keep
  working and no JavaScript is added.

### Fixed

- **Accurate token budget no longer under-fills.** The message-fill step is sized
  by the fast 4-chars/token estimate; the verify pass then only ever _dropped_
  messages, so when real tokenization came in under the estimate (typical for
  prose that runs more than 4 chars/token) the accurate build silently left part
  of the budget unused. A measured top-up now adds the newest excluded messages
  back while the real token count still fits (binary-searched, so it's cheaper
  than the existing drop loop and provably stays within budget).
- **Worker parse cache keyed by content, not just name + size.** Re-uploading an
  edited export whose name and byte size happened to match a previous file no
  longer serves the stale cached parse; the cache key now includes the file's
  `lastModified` timestamp.

## [1.1.0] - 2026-06-29

### Fixed

- **CSV export hardened against spreadsheet formula injection.** Cells derived
  from untrusted message content that begin with `=`, `+`, `-`, `@`, tab, or
  carriage return are prefixed with an apostrophe so Excel/Sheets treat them as
  text rather than evaluating them as formulas.
- **Replies now show the right name, not a raw id or a stale nickname.** Three
  fixes: (1) every identity gets a display label, including ones that only ever
  appear as a reply _target_ (these previously rendered the raw uid like `U598`);
  (2) HTML replies are resolved by the **referenced message's snowflake id** (read
  from the reply link's `scrollToMessage` handler) to that message's canonical
  author — so a reply shows the same name as the message it replies to, even when
  the HTML labeled the target with an older nickname; (3) when a reply target is
  folded into another identity by the message-content bridge, its reply tokens are
  re-pointed too. (On a real HTML+JSON merge, 16,485 of 16,486 reply tokens now
  resolve to a name.)
- **Identity: link the same person across formats by their messages.** When a
  user was renamed between exports — e.g. an older TXT shows an old nick that no
  id-bearing (HTML/JSON) export ever recorded — name/username aliasing couldn't
  connect them, so the _same_ messages survived under two identities (duplicated
  in the viewer, split in the stats). A new message-content bridge links a
  keyless TXT author to an id-bearing identity when their messages match (same
  normalized text + day), folding them together and collapsing the duplicates.
  A strong-evidence guard (≥ 8 matching messages **and** a majority of that
  author's text messages) prevents coincidental short-message collisions from
  merging unrelated people. Only runs when TXT is mixed with an id-bearing
  format. (Verified on a real merge: caught ~500 extra cross-format duplicates
  with no false merges.)

- **Identity: stop merging different people; merge one person's alts; better
  labels.** Previously "Use real names" keyed identities by display name, so two
  different accounts sharing a nickname collapsed into one (and all "Deleted User"
  accounts merged). Now identities are stable internal ids keyed by Discord user
  ID; "Use real names" only changes the display token. On top of that: (1) one
  person's deleted-and-recreated accounts are auto-merged when they share a
  nickname, have similar usernames, and have non-overlapping activity (a remade
  account), while different people who merely share a nickname stay separate and
  get disambiguated (`kot`, `kot (2)`); (2) each identity is labeled with its most
  recent **real** nickname, skipping `Deleted User`/`Unknown` placeholders so a
  since-deleted user still shows their last real nick when an earlier export
  captured it.

- **Cross-format duplicates & split identities.** Merging the same channel in
  multiple formats (e.g. a TXT alongside an HTML/JSON export) produced doubled
  messages and the same person appearing twice — once under their nickname and
  once under their username — because TXT exports carry no user id or message id.
  Now: (1) usernames from HTML (`title`) and JSON (`author.name`) are aliased to
  the id-backed identity, so an id-less TXT author resolves to the same person;
  (2) a content signature (author + day + normalized text) collapses a TXT copy
  of an id-bearing message while keeping messages unique to any file (so a
  since-deleted message a TXT uniquely captured still survives); (3) every
  message renders under one canonical identity name. Prefer JSON > HTML > TXT;
  TXT remains best-effort since its clock is minute-resolution in an unknown
  timezone.
- **Global identity & most-recent nicknames.** Identity is now resolved once
  across ALL files and shared by every channel group, so a person active in
  several channels is a single identity everywhere — the Statistics card, the
  Insights leaderboard/reply network, and the export legend no longer disagree
  (previously each channel group resolved identity on its own). Each identity is
  labeled with its **most recent** nickname (preferring id-backed HTML/JSON
  nicknames over id-less TXT names), instead of the first name seen — so renamed
  users show their current name consistently, regardless of file order. The
  Statistics participant/budget bars now show this name rather than the raw id.

### Added

- The project now ships an **MIT `LICENSE`**.
- **Insights dashboard** — a new analytics panel on the Preview step: summary
  metrics, a brushable messages-over-time chart, a day×hour activity heatmap,
  an enhanced participant leaderboard (words / media / replies / active days),
  and top reactions and media. Computed from the full filtered conversation
  (before token trimming) off the main thread in the Web Worker, with a
  timezone toggle (UTC / local) and an in-panel per-user filter that recompute
  live. New `core/analytics.js` (pure, tested) and `ui/insights.js` renderers.
- **Reply network & per-user drill-down** — the Insights panel now renders a
  force-directed reply network (who replies to whom, nodes sized by message
  count, edges weighted by reply frequency) using a hand-rolled layout. Clicking
  a network node or a leaderboard row focuses that user: the charts recompute for
  them alone and a reply-partners panel shows their top "replies to" / "replied
  to by" counts, while the network stays full with the focused user highlighted.
  Clicking the focused user again clears the focus. The network is pan- and
  zoom-able (scroll to zoom around the cursor, drag to pan, double-click the
  background to reset), and the whole section is hidden when the data has no
  reply relationships to graph (e.g. TXT-only exports).
- **Message explorer** — a heat-shaded month calendar paired with a chat-style
  day view. Days are colored by message volume; click one (or navigate months)
  to read that day's conversation rendered with avatars, message grouping, reply
  quotes, media chips, reaction pills and linkified URLs — not just plain text.
  A 24-hour scrubber jumps to any hour, and scrolling near either edge lazily
  loads earlier/later messages across day boundaries (a sliding window keeps the
  DOM bounded). Driven client-side from the full filtered conversation the worker
  returns once per run; respects the UTC/Local toggle. New `ui/calendar.js` and a
  worker `messages` handler.
- **Wrapped recap** — a shareable "Conversation Wrapped" poster summarizing the
  log: headline totals, an activity-over-time sparkline, weekly and daily rhythm
  charts ("most alive on …", peak-time persona), a top-3 chatters podium, top
  reactions, busiest day, top reply duo, conversation starter, night owl, the
  longest quiet stretch, and the most-reacted / longest messages (each with the
  author and timestamp). Rendered as a single self-contained SVG (theme colors
  baked in) with one-click **Download PNG**. New `core/wrapped.js` (pure, tested)
  and `ui/wrapped.js`.

## [1.0.0] - 2026-06-28

First production-ready release. The tool was reworked from a single ~2,400-line
HTML file into a tested, modular, security-hardened app that still builds to one
self-contained HTML file.

### Added

- **JSON input** (recommended) — DiscordChatExporter JSON exports parse with
  exact ISO-8601 timestamps and clean message IDs, immune to locale issues.
- **Accurate token counting** — optional real BPE tokenizer (GPT cl100k_base) in
  a separate `dist/index-accurate.html` build; the default build keeps the fast
  `1 token ≈ 4 chars` estimate.
- **Off-thread processing** — parsing and the pipeline run in a Web Worker so
  large exports don't freeze the UI (with a graceful main-thread fallback).
- **Multi-group preview** — preview and copy any channel group, not just the first.
- Persist keywords, preamble, and date range across reloads.
- Accessibility: keyboard focus indicators, reduced-motion support, ARIA labels,
  and live status announcements.
- Tooling: Vite single-file build, Vitest suite (105 tests), ESLint + Prettier,
  GitHub Actions CI.

### Fixed

- HTML/TXT timestamps no longer silently fail on non-US locales; HTML timestamps
  are derived from the message snowflake (exact UTC).
- Output timestamps render in UTC everywhere (deterministic, viewer-independent).
- TXT parser: the export postamble is no longer slurped into the last message;
  `{Stickers}` and `{Forwarded Message}` are handled; markdown blockquotes are no
  longer mis-parsed as replies.
- Reply placeholders ("Click to see attachment") no longer leak into snippets.
- The token budget now provably fits via a verify-and-retrim pass.
- TXT deduplication keeps legitimately-repeated messages while removing true
  cross-file overlap.
- A failed file read no longer hangs the app; an empty result explains why and
  suggests re-exporting as JSON.

### Security

- Fixed three stored-XSS vectors reachable from malicious export content.
- Strict Content-Security-Policy (`connect-src 'none'`) enforces "no data leaves
  your browser" at the browser level.
- Self-hosted, inlined fonts — the built file makes zero network requests.

### Changed

- Redaction (URLs / emails / phone numbers) is unified across all four output
  formats; JSON/CSV redact content fields only so IDs and timestamps survive.
- Developed as ES modules under `src/`; the original single file is frozen at
  `reference/legacy-index.html` as a behavior reference.
