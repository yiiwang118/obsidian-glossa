# Changelog

All notable changes to this project will be documented in this file. Format adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.4.2]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.4.2
[0.4.1]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.4.1
[0.4.0]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.4.0
[0.3.0]: https://github.com/yiiwang118/obsidian-glossa/releases/tag/0.3.0
