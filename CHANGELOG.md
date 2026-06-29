# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
