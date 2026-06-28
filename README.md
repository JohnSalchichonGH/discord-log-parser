# Discord Log Parser

A client-side tool that converts Discord chat exports into compact, LLM-optimised text files, built into a single self-contained HTML file. Everything runs in the browser — no server, no uploads, and the built file makes no external network requests.

---

## What it does

Discord export files are large and noisy. This tool strips all the HTML/metadata overhead and reformats the conversation into a dense plain-text format designed to pack as much conversation as possible into an LLM context window while staying human-readable.

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

[+1m] U3:
  invite yagami guy

[+0s] U2:
  done

=== SESSION BREAK (4h 12m) ===

[8:14 AM] U3:
  [IMG: eyechart.jpg]
```

Key space-saving decisions:

- **Author IDs** (`U1`, `U2`, …) instead of full display names.
- **Relative timestamps** (`[+3m]`, `[+45s]`) when messages are close together; absolute time only on new days, session breaks, or gaps over 1 hour.
- **Author deduplication** — the author label is only printed when it changes in a run of messages.
- **Day dividers** and **session break markers** (gap > 4 hours) for orientation.
- Media compressed to tokens: `[IMG: file.png]`, `[VID: clip.mp4]`, `[GIF: ...]`, `[YT: title]`, `[EMBED: title]`, `[STICKER]`.
- Reactions appended inline: `^{👍:3, 😂:1}`.
- Reply quotes truncated to 80 characters: `> U2: snippet…`.

---

## Supported input formats

### JSON exports (`.json`) — recommended

Produced by DiscordChatExporter with `--format Json`. This is the most reliable
input: timestamps are ISO-8601 (locale-independent), message and author IDs are
stable, and the structure is unambiguous. Prefer JSON whenever possible —
especially for non-US-locale exports, where HTML/TXT date parsing can fail.

### HTML exports (`.html`)

Produced by [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter). Supports full message content, replies, attachments, embeds, stickers, reactions, and system notifications.

### Plain-text exports (`.txt`)

Produced by DiscordChatExporter in text mode. The parser handles:

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

1. Open the app: run `npm install && npm run dev` and visit the printed URL, or build a standalone file with `npm run build` and open `dist/index.html` directly (no server needed — it's fully self-contained).
2. **Step 1 — Upload:** Drop or select one or more `.html` / `.txt` export files. Review the auto-detected channel groups and manually merge any groups that belong together.
3. **Step 2 — Configure:** Set the token budget, filters, keyword priorities, redaction options, and a custom preamble.
4. **Step 3 — Preview:** Review the live statistics dashboard, token budget breakdown, and a scrollable output preview. Tweak settings and re-process as needed.
5. **Step 4 — Export:** Choose an output format, optionally split into chunks, and download.

---

## Features

### Token budget & model presets

Controls how much of the conversation is kept. The tool always keeps the **newest** messages and discards the oldest until the output fits within the limit. One-click presets are provided for common models:

| Preset               | Tokens    |
| -------------------- | --------- |
| Claude (1M+ context) | 1,375,000 |
| Claude (200K)        | 200,000   |
| GPT-4 (128K)         | 128,000   |
| Gemini (1M)          | 1,000,000 |
| Gemini (2M)          | 2,000,000 |

The equivalent character count is shown live (approximation: 1 token ≈ 4 characters). A custom value can be entered for any other model.

### Multi-file merging

Multiple export files covering the same channel are automatically merged into one output.

**Grouping:** Files are grouped by channel. For `.html` files the channel ID is extracted from the filename (the numeric snowflake in brackets, e.g. `[1394452991959070]`). For `.txt` files the `Guild:` and `Channel:` header lines are used.

**Manual merge:** When exports for the same conversation end up in separate groups (e.g. DMs with different channel IDs from re-created conversations), select those groups with the checkboxes and click **Merge** to combine them into one.

**Sort order:** Files within a group are sorted by their OS modification date.

**Filename conventions understood:**

| Filename pattern                    | Meaning                                 |
| ----------------------------------- | --------------------------------------- |
| `Name [ID].html`                    | Base export (any modification date)     |
| `Name [ID] (after YYYY-MM-DD).html` | Partial export starting from a date     |
| Multiple base files with same ID    | All merged, sorted by modification date |

**Deduplication:** Messages that appear in more than one file (overlap between exports) are deduplicated. For `.html`/`.json` files the Discord message snowflake ID is used as the key. For `.txt` files (which have no message IDs) the key is `timestamp|author|full content`, and each message is allowed up to the maximum number of times it appears in any single file — so genuinely repeated messages are kept while true cross-file overlap is removed.

### Date range filter

Restrict the output to a specific time window. Messages outside the selected from/to dates are excluded before any other processing. Useful when you only care about a particular week buried in a months-long export.

### Keyword priority retention

Messages containing specified terms are **always kept** regardless of age, even if they would normally be trimmed by the token budget. The remaining budget is then filled with the newest non-priority messages.

Supports plain text keywords (one per line) and regex patterns wrapped in `/pattern/`:

```
deployment
bug
meeting
/release\s*v\d+/
```

### User filters

**Low-activity filter:** When enabled, any participant whose message count in the final (post-trim) output is below the threshold is removed entirely. The filter runs _after_ token trimming, so the count reflects what actually appears in the file.

**User whitelist:** After files are loaded, a list of every participant is shown with approximate message counts. Select specific users to include (none selected = include everyone).

**Bot tagging:** Click the "bot?" badge next to any user to tag them as a bot. Enable "Exclude bot messages" to strip all messages from tagged users.

### Content filters

- **Exclude system notifications** — Join/leave/pin/boost messages. For `.html` exports these are detected from the DOM structure. For `.txt` exports a heuristic matches common system message patterns.
- **Exclude media-only messages** — Messages that contain only images, stickers, or media tokens with no actual text content.

### Privacy & redaction

- **Anonymize header** — Removes real usernames from the participant legend, keeping only the short IDs (`U1`, `U2`, …).
- **Strip URLs** — Replaces all `http(s)://…` links with `[URL]`.
- **Strip emails & phone numbers** — Replaces with `[EMAIL]` and `[PHONE]`.

Redaction runs as a final pass over the rendered output, so it catches content from all sources (message text, embeds, attachments).

### Custom preamble

A free-text field whose content is prepended to the output file. Useful for injecting LLM system instructions, e.g.:

```
You are analyzing a Discord server about game development.
Focus on technical discussions and decisions made by the team.
```

### Output formats

| Format      | Extension | Best for                                        |
| ----------- | --------- | ----------------------------------------------- |
| Compact TXT | `.txt`    | Direct LLM context injection (default)          |
| JSON        | `.json`   | Programmatic analysis, function-calling models  |
| Markdown    | `.md`     | Models that handle Markdown well, human reading |
| CSV         | `.csv`    | Spreadsheet analysis                            |

### Chunked output

When the total content exceeds a single context window, enable chunking to automatically split the output into sequential files. Each chunk fits within the token budget. A configurable overlap (default: 500 messages) is shared between adjacent chunks to maintain context continuity across multi-pass LLM analysis. Chunking works with all four output formats.

### Statistics dashboard

After processing, a dashboard shows:

- **Totals** — raw message count, messages kept, unique users, average message length, date range.
- **Per-user bar chart** — top 15 participants by message count.
- **Token budget breakdown** — how much of the budget each user consumes, with an overall usage percentage.

### Live output preview

A scrollable preview of the first 300 lines of the rendered output is shown before downloading, with a line/character/token count summary and a copy-to-clipboard button.

### Dark & light themes

The default is a dark theme with a near-black neutral palette. A light theme is available via the toggle in the top-right corner. The preference is saved to `localStorage`.

### Settings persistence

All configuration — token limit, model preset, filter states, redaction toggles, output format, chunk settings — is saved to `localStorage` and restored on next visit.

---

## Privacy

Everything runs locally in your browser. No data is sent anywhere. The built `dist/index.html` makes **zero network requests** — fonts are self-hosted and inlined, there is no analytics, and there are no external runtime dependencies. The build also embeds a restrictive Content-Security-Policy (`connect-src 'none'`, plus `default-src 'none'` with tightly scoped exceptions) that blocks the standard network APIs — `fetch`, `XMLHttpRequest`, WebSocket, `EventSource`, and `navigator.sendBeacon` — as defense-in-depth. Untrusted export content is HTML-escaped before display. (Note: because the single-file build inlines its script, the CSP necessarily allows inline scripts, so the CSP complements — but does not replace — careful escaping.)

---

## Limitations

- Timestamp parsing for `.txt` files uses local time (the timezone the export was created in), which matches what Discord showed the user but may differ from UTC.
- Reactions in `.txt` exports don't include counts (the format doesn't provide them), so they appear as `^{👍}` rather than `^{👍:3}`.
- Edited message content is not tracked — only the current version at export time is included.
- The default build uses the 1 token ≈ 4 characters approximation, a rough average that varies by model and tokeniser. For exact counts, use the accurate build (`dist/index-accurate.html`) and enable "Accurate token counting" — it uses a real BPE tokenizer (GPT cl100k_base), the closest public proxy for current models.
- The token-budget trimming is calibrated for the **Compact TXT** output (it measures the rendered TXT). The JSON, Markdown, and CSV formats — and chunk sizes — may be larger than the selected budget. Keyword-priority messages are always kept even if they alone exceed the budget (the app warns when this happens).
- System message detection in `.txt` exports is heuristic-based and may not catch all system message variants across Discord locales.

---

## Development

The app is developed as ES modules under `src/` and built into a single, dependency-free `dist/index.html` (all JS, CSS, and fonts inlined) so the "double-click to run, no server" experience is preserved.

```
npm install        # install dev/build deps (Vite, Vitest, fonts, tokenizer)
npm run dev        # live dev server with HMR
npm test           # run the Vitest suite
npm run build      # produce the lean standalone dist/index.html (char/4 estimate)
npm run build:all  # also build dist/index-accurate.html (bundles a real BPE tokenizer)
```

Two builds are produced from the same source:

| File                       | Size    | Token counting                                               |
| -------------------------- | ------- | ------------------------------------------------------------ |
| `dist/index.html`          | ~265 KB | Fast `1 token ≈ 4 chars` estimate                            |
| `dist/index-accurate.html` | ~2.3 MB | Real BPE tokenizer (GPT cl100k_base) behind an opt-in toggle |

A build-time flag dead-code-eliminates the tokenizer from the lean build, so the default file stays small. Use `npm run dev:accurate` to run the accurate variant in dev.

Layout:

| Path                          | Contents                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `src/core/`                   | grouping, processing pipeline, chunking, token estimation, time/format helpers |
| `src/parsers/`                | HTML and TXT export parsers                                                    |
| `src/render/`                 | TXT / JSON / Markdown / CSV renderers                                          |
| `src/ui/`                     | markup styles + the DOM controller (`app.js`)                                  |
| `src/worker.js`               | Web Worker: off-main-thread parse + pipeline (main-thread fallback)            |
| `test/`                       | Vitest suites + synthetic DCE fixtures                                         |
| `reference/legacy-index.html` | the original single-file build, frozen as a behavior oracle                    |

All parsing/processing/rendering logic lives in tested modules; `src/ui/app.js` is the thin DOM glue.
