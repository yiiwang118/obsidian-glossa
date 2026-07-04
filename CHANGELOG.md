# Changelog

All notable changes to this project will be documented in this file. Format adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.3] — 2026-07-04

Update notice polish.

### Changed
- Made the update popover's primary action open the Glossa page inside the Obsidian app via `obsidian://show-plugin?id=glossa`.
- Kept GitHub Release as the secondary fallback for users whose in-app catalog has not synced yet.

## [0.6.2] — 2026-07-04

Release-readiness polish for community directory review.

### Changed
- Refreshed README positioning around vault context, local execution, approvals, and release checks.
- Updated marketplace metadata to keep the manifest description concise and free of redundant platform wording.
- Added this changelog entry so the 0.6.2 release has a clear review-facing summary.
- Replaced direct browser fetch calls in review-facing code paths with `requestUrl` or a small streaming HTTP boundary where response streaming is required.
- Replaced CSS `:has()` selectors with renderer-managed state classes for older WebView compatibility.

### Checks
- Tightened `npm run release:check` so future releases fail if the manifest description includes redundant platform wording or exceeds the review-friendly length cap.
- Added `npm run lint:review` for the TypeScript rules used by review scans and cleaned the current tree to pass it with zero warnings.
- Updated dev tooling so `npm audit --omit=optional` reports zero known vulnerabilities.

## [0.6.1] — 2026-07-03

Selection translation and review feedback fixes.

### Added
- Added double-Enter quick translation for selected text when the composer is empty.
- Added mixed-language selection detection that ignores Markdown URLs and lowers the weight of model names, provider names, and other proper nouns.
- Added browser-global shims for the Node test runner so integration tests can exercise browser-oriented code paths.

### Changed
- Kept the selection preview compact by moving the quick-translate hint into the composer placeholder.
- Shortened the marketplace description and removed redundant platform wording from metadata.
- Updated README release notes for selection translation behavior.

### Fixed
- Reset the active chat cleanly if the current session is deleted from history.
- Preserved scroll position during streaming unless the user is already following the bottom of the conversation.

## [0.6.0] — 2026-06-30

Web research, safer downloads, and source provenance.

### Added
- Added `web_search` with provider routing for DuckDuckGo, Brave, Tavily, Exa, and SerpAPI, including domain filters, deduplication, and simple trust/asset ranking.
- Added `web_research`, a bounded search + fetch + extract pipeline for current information and download discovery.
- Added `download_file` for saving public HTTP(S) assets into the vault with redirect safety, size caps, overwrite controls, SHA-256 hashes, and optional `.source.json` provenance.
- Added optional post-download PDF inspection so downloaded papers can be quickly classified before deeper `read_pdf` extraction.
- Added Advanced settings for web search provider/API key, default download folder, size caps, auto-download permission, and provenance records.

### Changed
- Reworked `web_fetch` around capped byte reads, cleaner HTML-to-Markdown extraction, metadata output, link extraction, and prompt-guided source excerpts.
- Updated agent workflow guidance so unknown URLs use `web_research`, known URLs use `web_fetch`, and explicit saves use `download_file`.
- Consolidated shared web-tool helpers for provider normalization, permission handling, domain normalization, and numeric caps.

### Tests
- Added web content extraction tests, web tool registration/ranking tests, and large-page performance coverage for extraction and prompt-guided summarization.

## [0.5.3] — 2026-06-30

Update awareness and long-session polish.

### Added
- Added a lightweight update checker that can surface newer GitHub releases inside the Glossa sidebar, with a dismiss option and a manual "Check for updates" command.
- Added a General settings toggle for update checks plus a "Check now" control for explicit refreshes.
- Added semver comparison coverage so patch releases like `0.5.10` sort correctly after `0.5.2`.

### Fixed
- Fixed left conversation-rail hover previews duplicating the selected prompt or leaving multiple native/browser tooltips visible.
- Fixed narrow composer layouts where the current-file context chip could overflow or repeat labels.
- Fixed unsupported Markdown image-source handling without paying the full post-render scan cost on ordinary messages.

### Changed
- Reduced repeated DOM queries during long-running agent turns by caching elapsed/status elements and coalescing rail active-state updates with animation frames.
- Kept the update notice quiet and local: it checks GitHub releases on a throttle, can be disabled in settings, and does not change provider behavior.

## [0.5.2] — 2026-06-29

Long-chat navigation and render-noise cleanup.

### Added
- Added a compact left-side conversation rail for long sessions. It records user prompts only, highlights the current prompt while scrolling, and lets users jump back to an earlier question without cluttering the transcript.
- Added hover previews for rail markers with the original user prompt and relative time.
- Added regression coverage for unsupported Markdown image sources.

### Fixed
- Replaced unsupported `upload://...` image URLs before Markdown rendering, preventing Chromium `ERR_UNKNOWN_URL_SCHEME` console noise from imported or copied web content.
- Added a post-render scrub for any unsupported image URL that survives Markdown parsing.
- Reset the conversation rail whenever a session is compacted, regenerated, switched, or cleared so stale markers cannot point at old DOM nodes.

### Changed
- Kept the rail visually close to Codex-style navigation: dense edge markers, active-state darkening, and magnetic expansion only while hovering.
- Avoided extra MathJax work for ordinary prose by keeping Markdown rendering on the lighter path unless math is actually present.

## [0.5.1] — 2026-06-26

Polish release after the 0.5 UI and context updates.

### Added
- Added visible attachment chips to user messages so uploaded files remain traceable after sending.
- Added a clearer current-file context model in the composer, separating the active note from uploaded files.
- Added README and Chinese README refreshes with concise install instructions, screenshots guidance, and community acknowledgement.

### Fixed
- Fixed uploaded attachments remaining in the composer after send.
- Fixed several context-display edge cases where the active file and uploaded file were visually ambiguous.
- Fixed Markdown rendering paths that could wake MathJax unnecessarily for non-math content.

### Changed
- Refined the empty-state branding, command suggestions, tool rows, reasoning rows, and action summaries for a cleaner AI Studio-inspired UI.
- Improved settings modal spacing and endpoint form layout across light and dark themes.

## [0.5.0] — 2026-06-26

Major UI and agent-experience refresh.

### Added
- Added an AI Studio-inspired visual refresh for the sidebar, input composer, action rows, and status pills.
- Added richer PDF browsing behavior and clearer PDF context handling in the agent pipeline.
- Added support for displaying uploaded file context in the active conversation flow.

### Fixed
- Fixed multiple sidebar icon color mismatches and toolbar contrast problems.
- Fixed duplicate or stale Thinking indicators during long-running agent turns.
- Fixed several history/session naming and empty-chat persistence edge cases.

### Changed
- Reworked agent activity presentation from verbose tool logs into compact process/action summaries.
- Improved provider and endpoint settings layout, warnings, and reasoning-effort handling.
- Temporarily disabled unstable reference-hover preview triggers while keeping the code path available for later refinement.

## [0.4.3] — 2026-06-25

Follow-up release after the initial community listing.

### Added
- Improved task-aware PDF browsing and image inspection guidance for agent workflows.
- Added support for `xhigh` reasoning effort without silent fallback, so compatible proxy endpoints can expose the highest reasoning tier directly.

### Fixed
- Restricted automatic selection capture to actual file content and Glossa output, preventing unrelated Obsidian UI selections from appearing in the composer.
- Improved custom API tool-call handling on non-streaming `requestUrl` endpoints.
- Reduced stale hover/overlay and duplicate-style issues in the sidebar and endpoint settings UI.

### Changed
- Optimized provider stream parsing, trusted SVG rendering, code-block decoration, and several small runtime paths.
- Cleaned unused code paths and tightened runtime polish around MCP, skills, context, and settings.

## [0.4.2] — 2026-06-23

Release follow-up for the community plugin submission.

### Fixed
- Cleared the remaining Obsidian-specific ESLint findings from the release-readiness pass.
- Reworked trusted inline SVG rendering so icons render correctly without `innerHTML`.
- Preserved release-safe UI text while keeping CLI flags, URLs, and brand names readable.

### Changed
- Release workflow now builds root-level artifacts and attaches provenance attestations for `main.js`, `manifest.json`, and `styles.css`.

## [0.4.1] — 2026-06-23

Release-readiness pass for Obsidian community submission.

### Added
- `read_pdf` tool and PDF context extraction through Obsidian/PDF.js.
- `npm run release:check` for manifest/version/docs metadata validation.
- Warning banners and notices for local Codex / Claude CLI endpoints, including dangerous Codex sandbox / approval-policy combinations.
- `docs/screenshots/` release screenshot checklist.

### Changed
- New installs now default to `Plan` + `read-only` instead of `Act` + `workspace-write`.
- Network testing now targets the selected endpoint's own `testConnect` path instead of spawning `curl` against OpenAI unconditionally.
- README / CONTRIBUTING / CI now describe the actual in-tree test suite: 10 files, 96 assertions at this release.
- Release process documentation now points to the current Obsidian community submission flow.
- Large diff previews fall back to bounded output instead of allocating huge LCS tables.
- Privacy documentation now covers local CLI subprocesses, shell-env capture, PDF extraction, endpoint tests, and MCP catalog fetches.

### Notes
- Codex / Claude local CLI bridges remain available. Dangerous combinations are warned in the UI but not hard-blocked in this release.

## [0.4.0] — 2026-05-19

First open-source release. Focuses on hardening: 6 high/medium-severity findings from a third-party audit landed as concrete fixes with regression tests.

### Added
- **`tests/` in-tree runner** — focused Node coverage for security fixes and provider/tool regressions.
- **Atomic file writes** — new `src/utils/safe_write.ts` with `safeWrite` / `safeWriteJson` / `safeReadJson`. Used by `chats.json`, `embeddings.json`, `checkpoints.json`. Mid-write crash no longer truncates files.
- **First-build consent gate for RAG** — explicit modal lists endpoint + file count + payload size before the first embedding upload. Consent persisted in settings.
- **Skill frame fork-safety** — `snapshotFrames` / `restoreFrames` API in `skill_scoped_allow.ts` so a forked sub-agent can't wipe the parent's frames.
- **`PRIVACY.md`** — exhaustive data-flow disclosure.
- **`SECURITY.md`** — scope + reporting process.
- **CI** — GitHub Actions: typecheck + tests + build on every PR.
- **Release automation** — tag push (e.g. `0.4.0`, no `v` prefix per Obsidian spec) produces a Release with `main.js / manifest.json / styles.css` attached.

### Fixed (security / correctness)
- **`view_image` path validation** — was the only vault tool missing `assertVaultPath`. 10 attack paths (`../etc/passwd`, `C:\Windows\…`, UNC, etc.) now rejected.
- **URL-encoded path traversal** — `assertVaultPath` now decodes URI escapes before segment-checking; `..%2Fetc/passwd` no longer bypasses 18 vault tools.
- **`checkpoint.snapshot` race condition** — added FIFO write mutex (`withWriteMu`). Concurrent destructive tools no longer lose each other's snapshots.
- **`patch_envelope` truncation detection** — `parseEnvelope` now throws if `*** End Patch` is missing instead of silently applying a half-baked diff.
- **`listToolSpecs` deferred filter** — `shouldDefer:true` tools (legacy `edit_section`, `append_to_note`, `discover_skills`, `run_skill`) excluded from the default model-facing spec list. Architectural cleanup: the duplicate filter in `loop.ts` removed.
- **`plugin_bridges` defensive read** — `bases_query.isReady` now uses `app?.vault?.adapter` to avoid TypeError during hot-reload / plugin lifecycle edge cases.

### Changed
- **`listToolSpecs(opts?)`** — signature added `{ includeDeferred?: boolean }`. Default behavior changed to exclude deferred tools. Pass `includeDeferred: true` to restore the old global semantics if you depend on it.
- **`assertVaultPath`** — now URL-decodes input before checking. Files with literal `%2F` / `%2E` etc. in their names are no longer addressable through tools (extremely rare; trade-off justified to block `..%2F` traversal).
- **`safeWriteJson`** — replaces direct `adapter.write(path, JSON.stringify(...))` everywhere persistence is done. Writes go via `<path>.tmp` then rename; previous file rolled to `<path>.bak`.

### Known issues / decisions
- **F2 stream-render percentage metric** — the previous "main-thread blocked %" was a pure-JS-DOM artifact (jsdom under-renders, so the loop's only work is rendering and the ratio trivially approaches 100%). Replaced with absolute naive-vs-optimized timing comparison. For production-accurate latency, see `tests/G_chromium/G1_stream_render_rate.test.js`.
- **Some audit findings deferred to 0.5** — including: scoping skill frames to per-agent context (1.1), proxy propagation into streaming fetch (1.3), Anthropic `thinking_delta` parsing (1.4), Codex auto-approve in `danger-full-access` mode (1.5), endpoint deletion cascading cleanup (1.7), MCP namespace symmetric normalization (1.19), skill activation debounce (1.20).

### Provider parity matrix (no regressions in 0.4.0)
- OpenAI / OpenAI-compatible: full streaming, tool calls, reasoning_effort, image input ✅
- Anthropic: full streaming, tool calls, extended thinking (note: `thinking_delta` parsing arrives in 0.5), image input ✅
- Codex CLI (legacy `exec --json`): full streaming, tool calls, xhigh reasoning, tmp-file images ✅
- Codex App-Server (stdio JSON-RPC): full streaming, tool calls, reasoning, images ✅
- Claude Code CLI: deprecated bridge present in source, **no plans to ship the CC bridge in 0.4.x**

---

## [0.3.0] — 2026-04-08

Last pre-open-source version. Internal-only. Not published.

[0.6.2]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.2
[0.6.1]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.1
[0.6.0]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.6.0
[0.5.3]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.5.3
[0.5.2]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.5.2
[0.5.1]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.5.1
[0.5.0]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.5.0
[0.4.3]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.4.3
[0.4.2]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.4.2
[0.4.1]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.4.1
[0.4.0]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.4.0
[0.3.0]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.3.0
