# Discord Log Parser

A client-side tool for Discord chat exports that does two things: it **converts**
them into compact, LLM-optimised text, and it lets you **explore** them visually —
a heat calendar, an activity dashboard, a reply network, and a shareable "Wrapped"
recap. Everything runs in the browser and ships as a single self-contained HTML
file: no server, no uploads, and the built file makes zero external network
requests.

---

## What it does

Discord export files are large and noisy. This tool strips the HTML/metadata
overhead and reformats the conversation into a dense plain-text format designed to
pack as much conversation as possible into an LLM context window while staying
human-readable — and along the way it computes analytics over the full
conversation so you can actually _read_ and understand the log, not just export it.

### Output format example

```
# LLM-Optimized Chat Log (Limit: ~200,000 tokens)
# Start: Sat, 12 Jul 2025 03:50:00 GMT
# Participants:
# U1: kang0420 (42 msgs, 35.0%)
# U2: tetron432 (38 msgs, 31.7%)
# U3: yeswuxianbei9251 (40 msgs, 33.3%)

=== Saturday, Jul 12, 2025 ===

[3:50 AM] U1:
  Joined the server.
  greetings

[+0s] U3:
  XDDDD

[+1m] U2:
  yo you guys
  stop deleting servers for crying out loud

=== SESSION BREAK (4h 12m) ===

[8:14 AM] U3:
  [IMG: eyechart.jpg]
```

Key space-saving decisions:

- **Author IDs** (`U1`, `U2`, …) instead of full display names (or the real names,
  optionally).
- **Relative timestamps** (`[+3m]`, `[+45s]`) when messages are close together;
  absolute time only on new days, session breaks, or gaps over 1 hour.
- **Author deduplication** — the author label is only printed when it changes in a
  run of messages.
- **Day dividers** and **session break markers** (gap > 4 hours) for orientation.
- Media compressed to tokens: `[IMG: file.png]`, `[VID: clip.mp4]`, `[GIF: ...]`,
  `[YT: title]`, `[EMBED: title]`, `[STICKER]`.
- Reactions appended inline: `^{👍:3, 😂:1}`.
- Reply quotes truncated to 80 characters: `> U2: snippet…`.

---

## Supported input formats

You can mix all three in one session — they're merged into one conversation.

### JSON exports (`.json`) — recommended

Produced by DiscordChatExporter with `--format Json`. This is the most reliable
input: timestamps are ISO-8601 (locale-independent), message and author IDs are
stable, and the structure is unambiguous. Prefer JSON whenever possible —
especially for non-US-locale exports, where HTML/TXT date parsing can fail.

### HTML exports (`.html`)

Produced by [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter).
Supports full message content, replies, attachments, embeds, stickers, reactions,
and system notifications. Carries stable user/message IDs.

### Plain-text exports (`.txt`)

Produced by DiscordChatExporter in text mode. The lossiest format — it has no user
or message IDs and a minute-resolution clock — but still fully parsed and merged
(see [Identity & deduplication](#identity--deduplication)). The parser handles:

```
[M/D/YYYY H:MM AM/PM] AuthorName
message text

{Attachments}
https://cdn.discordapp.com/.../file.jpg

{Reactions}
👍

{Embed}
https://...   ← skipped, no useful content
```

---

## Usage

1. Open the app: run `npm install && npm run dev` and visit the printed URL, or
   build a standalone file with `npm run build` and open `dist/index.html`
   directly (no server needed — it's fully self-contained).
2. **Step 1 — Upload:** Drop or select one or more `.json` / `.html` / `.txt`
   export files. Review the auto-detected channel groups and manually merge any
   groups that belong together.
3. **Step 2 — Configure:** Set the token budget, filters, keyword priorities,
   redaction options, and a custom preamble.
4. **Step 3 — Preview:** Review the statistics, token-budget breakdown, the
   **Insights** dashboard, the **Message explorer** calendar, the **Wrapped**
   recap, and a scrollable output preview. Tweak settings and re-process as needed.
5. **Step 4 — Export:** Choose an output format, optionally split into chunks, and
   download.

---

## Export features

### Token budget & model presets

Controls how much of the conversation is kept. The tool always keeps the **newest**
messages and discards the oldest until the output fits within the limit. One-click
presets are provided for common models:

| Preset               | Tokens    |
| -------------------- | --------- |
| Claude (1M+ context) | 1,375,000 |
| Claude (200K)        | 200,000   |
| GPT-4 (128K)         | 128,000   |
| Gemini (1M)          | 1,000,000 |
| Gemini (2M)          | 2,000,000 |

The equivalent character count is shown live (approximation: 1 token ≈ 4
characters). A custom value can be entered for any other model.

### Multi-file merging

Multiple export files covering the same channel — in any format — are merged into
one output.

**Grouping:** Files are grouped by channel. For `.json` the channel ID comes from
the export's `channel.id`; for `.html` it's the numeric snowflake in the filename
(e.g. `[1394452991959070]`); for `.txt` the `Guild:` / `Channel:` header lines are
used.

**Manual merge:** When exports for the same conversation end up in separate groups
(e.g. DMs with different channel IDs from re-created conversations), select those
groups with the checkboxes and click **Merge** to combine them.

**Filename conventions understood:**

| Filename pattern                    | Meaning                                 |
| ----------------------------------- | --------------------------------------- |
| `Name [ID].html`                    | Base export (any modification date)     |
| `Name [ID] (after YYYY-MM-DD).html` | Partial export starting from a date     |
| Multiple base files with same ID    | All merged, sorted by modification date |

### Identity & deduplication

Identity is resolved **once, globally, across every file** (not per channel), so a
person active in several channels is a single identity everywhere — the export
legend, the statistics, and all the analytics agree.

- **Keying.** A person is keyed by their Discord user ID (`data-user-id` in HTML,
  `author.id` in JSON). `.txt` exports carry no IDs, so a TXT author is matched by
  display name — and crucially, each id-backed user's **username** (the HTML author
  `title`, the JSON `author.name`) is aliased to their identity. Since TXT writes
  people by username, a TXT line by `kang0420` resolves to the same person as their
  id-backed nickname `k`.
- **Naming.** Each identity is labeled with its **most recent nickname** (preferring
  id-backed nicknames over id-less TXT names), so renamed users show their current
  name consistently, regardless of file order.
- **Deduplication.** HTML/JSON messages are de-duplicated by their Discord snowflake
  ID. TXT messages (no IDs, minute-resolution clock) are matched to their HTML/JSON
  twin by a **content signature** — resolved author + UTC day + normalized text.
  Id-bearing copies are authoritative: a TXT copy of an HTML/JSON message is
  dropped, but a message **only** the TXT captured (e.g. one deleted before the
  richer export was taken) is kept. Genuine same-text repeats within a file survive
  by counting the maximum occurrences in any single file.

Format quality runs **JSON > HTML > TXT**. TXT reconciliation is best-effort: with
no reliable timestamp, matching falls back to day granularity, so prefer JSON/HTML
when you have them.

### Date range filter

Restrict the output to a specific time window. Messages outside the selected
from/to dates are excluded before any other processing.

### Keyword priority retention

Messages containing specified terms are **always kept** regardless of age, even if
they would normally be trimmed by the token budget. The remaining budget is then
filled with the newest non-priority messages. Supports plain-text keywords (one per
line) and regex patterns wrapped in `/pattern/`:

```
deployment
bug
/release\s*v\d+/
```

### User & content filters

- **Low-activity filter** — removes any participant whose message count in the
  final (post-trim) output is below a threshold.
- **User whitelist** — pick specific users to include (none selected = everyone).
- **Bot tagging** — tag users as bots and strip their messages.
- **Exclude system notifications** — join/leave/pin/boost messages.
- **Exclude media-only messages** — messages with no actual text content.

### Privacy & redaction

- **Anonymize header** — keep only the short IDs (`U1`, `U2`, …) in the legend.
- **Strip URLs** — replace `http(s)://…` links with `[URL]`.
- **Strip emails & phone numbers** — replace with `[EMAIL]` / `[PHONE]`.

Redaction runs as a final pass over the rendered output, so it catches content from
all sources (message text, embeds, attachments).

### Custom preamble

A free-text field prepended to the output file — useful for injecting LLM system
instructions.

### Output formats & chunking

| Format      | Extension | Best for                                        |
| ----------- | --------- | ----------------------------------------------- |
| Compact TXT | `.txt`    | Direct LLM context injection (default)          |
| JSON        | `.json`   | Programmatic analysis, function-calling models  |
| Markdown    | `.md`     | Models that handle Markdown well, human reading |
| CSV         | `.csv`    | Spreadsheet analysis                            |

When the total content exceeds a single context window, enable **chunking** to
split the output into sequential files that each fit the budget, with a configurable
overlap (default: 500 messages) shared between adjacent chunks for continuity.

---

## Analytics & visualization

All of the following are computed over the **full filtered conversation** (before
token trimming), off the main thread in a Web Worker, and respect a **UTC / Local**
timezone toggle. They appear on the Preview step.

### Statistics & token budget

Totals (raw count, kept, unique users, average length, date range), a top-15
participant bar chart, and a per-user token-budget breakdown with overall usage.

### Insights dashboard

- **Summary metrics** — messages, participants, active days, peak hour, reactions,
  date range.
- **Messages over time** — an area/line chart of daily volume.
- **Activity heatmap** — a day × hour grid of when the channel is alive.
- **Participant leaderboard** — top users by message count, with words / media /
  replies / active days.
- **Top reactions & media** breakdowns.
- An in-panel **per-user filter** that recomputes the whole dashboard live.

### Reply network

A force-directed graph of who replies to whom (hand-rolled layout, no chart
library). Nodes are sized by message count and edges weighted by reply frequency.
**Scroll to zoom, drag to pan, double-click to reset.** Click a node — or a
leaderboard row — to **focus** a person: the charts recompute for them alone and a
reply-partners panel shows their top "replies to" / "replied to by" counts. The
section hides itself when the data has no reply relationships (e.g. TXT-only).

### Message explorer

A heat-shaded **month calendar** (days colored by message volume) paired with a
Discord-style **chat day view**. Click a day to read it; messages render with
colored avatars, grouping, reply quotes, media chips, reaction pills, and
linkified URLs. A **24-hour scrubber** jumps to any hour, and scrolling near either
edge lazily loads earlier/later messages across day boundaries (a sliding window
keeps it smooth on huge logs).

### Wrapped recap

A shareable "Conversation Wrapped" poster: headline totals, an activity sparkline,
weekly & daily rhythm charts, a top-3 chatters podium, top reactions, busiest day,
top reply duo, conversation starter, night owl, longest quiet stretch, and the
most-reacted / longest messages (each with author and timestamp). Rendered as a
self-contained SVG with one-click **Download PNG**, theme-aware in both modes.

### Live output preview, themes & persistence

A scrollable preview of the rendered output with a line/character/token summary and
copy-to-clipboard. A **dark/light theme** toggle (saved to `localStorage`), and all
configuration — token limit, presets, filters, redaction, output format, chunk
settings — is persisted and restored on next visit.

---

## Privacy

Everything runs locally in your browser. No data is sent anywhere. The built
`dist/index.html` makes **zero network requests** — fonts are self-hosted and
inlined, there is no analytics, and there are no external runtime dependencies. The
build also embeds a restrictive Content-Security-Policy (`connect-src 'none'`, plus
`default-src 'none'` with tightly scoped exceptions) that blocks the standard
network APIs — `fetch`, `XMLHttpRequest`, WebSocket, `EventSource`, and
`navigator.sendBeacon` — as defense-in-depth. Untrusted export content is
HTML-escaped before display. (Because the single-file build inlines its script, the
CSP necessarily allows inline scripts, so it complements — but does not replace —
careful escaping.)

---

## Limitations

- **TXT is best-effort.** `.txt` exports have no user or message IDs and a
  minute-resolution clock in an unknown timezone, so cross-format de-duplication
  matches them at day granularity. In a busy log, the same person posting the
  identical text on the same day across different channels could occasionally
  over-merge — prefer JSON/HTML when accuracy matters.
- Timestamp parsing for `.txt` files uses local time (the timezone the export was
  created in), which matches what Discord showed the user but may differ from UTC.
- Reactions in `.txt` exports don't include counts (the format doesn't provide
  them), so they appear as `^{👍}` rather than `^{👍:3}`.
- Edited message content is not tracked — only the version present at export time.
- The default build uses the 1 token ≈ 4 characters approximation. For exact counts,
  use the accurate build (`dist/index-accurate.html`) and enable "Accurate token
  counting" — it uses a real BPE tokenizer (GPT cl100k_base), the closest public
  proxy for current models.
- Token-budget trimming is calibrated for the **Compact TXT** output. The JSON,
  Markdown, and CSV formats — and chunk sizes — may be larger than the selected
  budget. Keyword-priority messages are always kept even if they alone exceed the
  budget (the app warns when this happens).
- Media is shown in the explorer as labeled chips, not thumbnails — exports are
  text, so there's no image data to render.

---

## Development

The app is developed as ES modules under `src/` and built into a single,
dependency-free `dist/index.html` (all JS, CSS, and fonts inlined) so the
"double-click to run, no server" experience is preserved. Logic lives in tested
modules; `src/ui/*.js` is the DOM/visualization layer.

```
npm install        # install dev/build deps (Vite, Vitest, fonts, tokenizer)
npm run dev        # live dev server with HMR
npm test           # run the Vitest suite (130 tests)
npm run coverage   # run tests with V8 coverage (lcov + html report)
npm run lint       # ESLint
npm run format     # Prettier --write   (format:check verifies)
npm run build      # lean standalone dist/index.html (char/4 estimate)
npm run build:all  # also build dist/index-accurate.html (real BPE tokenizer)
```

Two builds are produced from the same source:

| File                       | Size    | Token counting                                               |
| -------------------------- | ------- | ------------------------------------------------------------ |
| `dist/index.html`          | ~555 KB | Fast `1 token ≈ 4 chars` estimate                            |
| `dist/index-accurate.html` | ~2.6 MB | Real BPE tokenizer (GPT cl100k_base) behind an opt-in toggle |

A build-time flag dead-code-eliminates the tokenizer from the lean build, so the
default file stays small. Use `npm run dev:accurate` to run the accurate variant in
dev. CI (GitHub Actions) runs lint, format check, the test suite with coverage
(uploaded to Codecov), and both builds on every push.

Layout:

| Path            | Contents                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/core/`     | grouping, pipeline, identity/dedup, chunking, **analytics**, **wrapped** stats, token estimation, time/format helpers |
| `src/parsers/`  | JSON, HTML, and TXT export parsers                                                                                    |
| `src/render/`   | TXT / JSON / Markdown / CSV renderers                                                                                 |
| `src/ui/`       | `app.js` (DOM controller) + `insights.js`, `calendar.js`, `wrapped.js` visualizers                                    |
| `src/worker.js` | Web Worker: off-main-thread parse + pipeline + analytics (main-thread fallback)                                       |
| `test/`         | Vitest suites (16 files) + synthetic DCE fixtures                                                                     |

All parsing / processing / analytics / rendering logic lives in tested modules;
`src/ui/app.js` is the thin DOM glue that wires them to the page.
