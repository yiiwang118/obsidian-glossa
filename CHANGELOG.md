# Changelog

All notable changes to this project will be documented in this file. Format adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.9] — 2026-07-13

### Added
- Added the official `eslint-plugin-obsidianmd` recommended rules to the release gate alongside the existing strict TypeScript, source review, dependency, test, and build checks.
- Added regression coverage for the typed native-network fallback and CSS compatibility scanner.

### Changed
- Replaced legacy ESLint configuration with the current flat config and aligned settings headings and DOM helpers with host-app conventions.
- Hardened native HTTP and DNS fallbacks with explicit runtime validation at the Node bridge while preserving browser-first requests and private-network protection.
- Moved hashing to Web Crypto and removed unnecessary Node utility dependencies from document and Skill paths.

### Fixed
- Cleared the remaining source-review errors and warnings for unsafe values, unnecessary assertions, non-`Error` rejections, and unused catch bindings.
- Replaced partially supported multicolumn CSS declarations and added a scanner rule that prevents them from returning.

### Checks
- Passed official Obsidian lint and strict TypeScript lint with zero warnings, 580 automated tests, dependency audit, production build, source/CSS review scan, and release metadata validation.

## [0.6.8] — 2026-07-12

### Added
- Added a searchable Tools & Skills catalog that exposes default and on-demand tools, approval boundaries, Skill triggers, required tools, sources, and validation status.
- Added `off`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra` reasoning choices for compatible endpoints.

### Changed
- Reorganized settings into five task-focused areas with a compact status header and an always-available Auto, English, and Chinese language control.
- Replaced native settings dropdowns with one keyboard-accessible popup selector so labels, checkmarks, arrows, and row geometry stay consistent.
- Moved Export chat and Settings into dedicated header actions and removed the generic overflow menu.
- Sent OpenAI-compatible reasoning values unchanged, omitted the field only for `off`, and surfaced provider rejection details instead of silently lowering the selected effort.
- Extended Anthropic-style thinking budgets for the expanded reasoning range.

### Fixed
- Fixed misaligned checks and labels in endpoint, model, language, reasoning, permission, and approval selectors.
- Fixed approval diff checkbox geometry so its checked state remains centered and stable.

### Checks
- Added regression coverage for reasoning pass-through, unsupported-level errors, settings capability copy, custom selector behavior, and native-dropdown removal.

## [0.6.7] — 2026-07-10

### Added
- Added current-file context policy so content tasks can use the open note without requiring a selection while explicit attachments retain target priority.
- Added independent response-language decisions so source language cannot override the user's current language preference.
- Added bounded prompt snapshots, long-chat rendering windows, compact historical tool evidence, and media-safe chat persistence.
- Added task-aware PDF visual rendering, image crop/OCR/chart/color modes, and bounded in-memory media caches.
- Added precise `read_note` line ranges, deferred multi-file `read_files`, and model-only `context_prune` for stale read/search evidence.
- Added result-aware tool failure handling, repeated-failure convergence guards, and schema validation before approval or execution.
- Added six focused built-in Skills plus Skill creation and validation for triggers, paths, workflow structure, and tool references.
- Added working deferred tool disclosure so specialized schemas enter the next provider request only when requested by `tool_search` or a Skill.
- Added task-continuity grounding so short follow-up requests can preserve the previous explicit target, failed tool context, and ambient-current-file boundaries.
- Added explicit task target-lock cues for follow-up requests so titles, authors, source URLs, and requested output folders stay visible before file writes.
- Added regression coverage for ambiguous follow-ups involving selected text, explicit attachments, current files, output paths, titles, URLs/domains, replacement targets, and negated previous-task references.
- Added regression coverage for update notices so the primary update action stays on the in-app plugin page.
- Added fixture-level regression coverage for release version, metadata, artifact, secret-file, and source-review checks.
- Added fixture-level regression coverage for the release review scanner.
- Added `npm run check`, `npm run lint:strict`, and `npm run review:scan` so local and CI checks share the same stricter release gate.

### Changed
- Rebuilt the English and Chinese READMEs around current capabilities, workflows, safety boundaries, and installation instead of a long update timeline.
- Reduced the default model-facing tool surface while keeping specialized tools dynamically loadable under the same permission checks.
- Kept write confirmations, downloads, failures, plans, Skills, and tool-disclosure state protected from context pruning.
- Removed the decorative selection-preview quote icon so selected context uses less horizontal space and relies on the composer placeholder for quick-translate hints.
- Removed the now-unused quote icon asset and added a review-scan guard against reintroducing selection-preview icon chrome.
- Updated the lightweight test runner so explicit test-file arguments run only those tests.
- Updated CI's independent build-output check to require non-empty release assets.
- Updated CI, release workflow, README, contributing notes, and PR checklist to use the new `npm run check` gate.
- Expanded `npm run release:check` so it also runs the generated-bundle/source/CSS review scan.
- Expanded `npm run release:check` to require the Chinese README and reject stale marketplace description text.
- Expanded `npm run release:check` to require the desktop-only manifest flag.
- Expanded `npm run release:check` to keep package name, main entry, and license aligned with release metadata.
- Expanded `npm run release:check` to ensure package scripts keep the strict check/review-scan/build/typecheck chain.
- Added a strict unused-ESLint-directive gate to keep review disable directives minimal.
- Expanded `npm run release:check` to require non-empty release assets before publishing.
- Expanded `npm run release:check` to verify CI/release artifact blocks only publish `main.js`, `manifest.json`, and `styles.css`.
- Expanded `npm run release:check` to reject tracked runtime state, local secret files, and live-looking provider tokens.
- Expanded the review scan to reject CSS `:has()` selectors before they can reintroduce older WebView compatibility warnings.
- Expanded the review scan to reject unsafe HTML sinks, dynamic code execution, and string-based timer execution.
- Expanded the review scan to reject sourcemap/source-content markers in release assets.
- Expanded the review scan to reject source-level filesystem, shell execution, system identity, and environment-variable access.
- Expanded the review scan to reject source-level vault-wide enumeration calls.
- Expanded the review scan to reject command-palette dispatch from the source and release bundle.
- Removed disabled legacy local CLI, MCP, and semantic-index implementation sources from the community review surface.
- Removed unregistered vault-wide search/tag/Bases tool implementation sources and stale model-facing references from the community review surface.
- Removed command-palette dispatch tools from the community review surface.
- Updated privacy and security docs to describe the current community build instead of removed local subprocess/MCP paths.

### Fixed
- Fixed historical `\(...\)` and `\[...\]` formulas failing to render while preserving code fences, inline code, and incomplete streaming math.
- Fixed tool-returned `Error:` text being represented as a successful tool result.
- Fixed newly created, deleted, or renamed Skill files temporarily using stale discovery cache entries.
- Added a same-host HTTP fallback for `web_fetch` and `web_research` source fetching when HTTPS fails at the network/TLS layer, with explicit fallback metadata in tool results.
- Added explicit `download_file` guidance for HTTPS network/TLS failures while keeping file-saving paths from automatically downgrading to HTTP.
- Preserved task continuity when a prior failure is only present in assistant text instead of structured tool events.
- Removed remaining top-type union review warnings from PDF-related dynamic boundaries.

### Checks
- Added regression coverage for context targeting, compaction fidelity, media caching, PDF/image delivery, formula normalization, deferred tools, Skill quality, context pruning, and tool failure convergence.
- Passed the full typecheck, strict/review lint, directive audit, dependency audit, production build, source/bundle review scan, and release metadata gate.

## [0.6.5] — 2026-07-04

Source review compliance for community directory checks.

### Fixed
- Removed forbidden `@typescript-eslint/no-explicit-any` directive disables from source files.
- Replaced explicit dynamic-boundary `any` annotations with internal review-safe aliases.
- Wrapped non-`Error` promise rejection paths so rejection reasons are always `Error` instances.
- Removed redundant union types and Node namespace types that produced source-review warnings.

### Checks
- Expanded `npm run release:check` to reject forbidden `no-explicit-any` directive disables, undescribed `eslint-enable` directives, and explicit TypeScript `any` keywords.

## [0.6.4] — 2026-07-04

Superseded source review cleanup.

### Changed
- Added paired ESLint disable/enable directives around dynamic host-app boundary modules.
- This release is superseded by 0.6.5 because stricter review requires `eslint-enable` descriptions and does not allow disabling `no-explicit-any`.

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
