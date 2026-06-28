# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
