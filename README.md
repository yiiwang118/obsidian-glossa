<div align="center">

# Glossa

### Your vault, in context. Your edits, under control.

A local-first AI workspace for reading, researching, and changing real notes without losing sight of the source.

[![Install](https://img.shields.io/badge/Install-Plugin_marketplace-7C3AED?style=for-the-badge)](https://obsidian.md/plugins?id=glossa)
[![Release](https://img.shields.io/github/v/release/yiiwang118/obsidian-glossa?display_name=tag&sort=semver&style=for-the-badge)](https://github.com/yiiwang118/obsidian-glossa/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/yiiwang118/obsidian-glossa/ci.yml?branch=main&style=for-the-badge&label=checks)](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge)](LICENSE)

[中文说明](README.zh-CN.md) · [Latest release](https://github.com/yiiwang118/obsidian-glossa/releases/latest) · [Changelog](CHANGELOG.md)

<img src="docs/assets/glossa-hero.png" alt="Glossa AI sidebar working with notes" width="100%">

</div>

Glossa turns the sidebar into a working surface, not a separate chatbot. The active note can enter context automatically, explicit attachments stay grounded as the task target, and API file changes follow visible tool and approval rules. Optional local CLI runtimes use their own native permissions, as described below.

## What Glossa Does

**Learn from a correction.** Use **Remember this correction** beside an assistant reply to turn feedback into an editable skill draft. Choose an existing learned skill to improve it, or create a new one. Review the conversation excerpt and workflow diff, then inspect the generated examples or add your own. Each example runs with fresh context against both the candidate and the currently enabled version (or no skill), checking exact output fragments and whether the skill should apply. Editing the draft or examples invalidates the results; every candidate example must pass before you can enable it. Tied scores are shown as no measured gain.

This first version validates **text behavior**, not live tool execution or changes to real notes. Generation uses the selected chat model; validation makes two model calls per example (3–5 examples). The model does not receive the expected output checks. Review the excerpt before sending it; tool result bodies and automatic attachment contents are not collected by the learning feature. There is no background training or model-weight update.

Use **Glossa: Manage learned skills** or **Learning history** in the dialog to inspect results, disable a skill, edit a draft, or restore a previously tested version. Enabled skills join normal skill discovery for future turns and keep the existing tool approval rules. Built-in and manually authored skills are not overwritten. Drafts, workflow versions, feedback references, model identity and validation outputs are stored locally in `.glossa/learning.json`, with up to 12 versions per skill and 60 learned skills. Learning history is plain text and can be included in vault sync; API-key encryption does not encrypt this file. Simultaneous edits are checked before saving. Historical validation results describe the model and examples used at that time.

| | Capability | What it means in practice |
|---|---|---|
| 🧠 | **Understands context** | Work with the active note, selections, attached files, PDFs, images, and prior task state without repeatedly pasting content. |
| ✍️ | **Edits precisely** | Patch one section, replace exact text, coordinate multi-file changes, and preserve surrounding Markdown instead of rewriting everything. |
| ⌨️ | **Suggests what comes next** | Optionally request bounded, low-latency Markdown continuations while writing and accept the ghost text directly in the editor. |
| 📚 | **Reads serious documents** | Inspect papers by page, search PDF text, render visual pages, examine screenshots, run OCR, and inspect charts or UI details. |
| 🌐 | **Researches the web** | Search bounded public sources, extract useful content, verify paper identity, and save validated downloads with provenance. |
| 🧩 | **Runs focused Skills** | Use built-in workflows for Markdown, Canvas, Bases, PDFs, images, or create and validate your own vault Skills. |
| 🔐 | **Keeps actions accountable** | Start read-only, approve writes, inspect tool results, and restore checkpointed files when an edit needs to be rolled back. |

## New in 1.0.0

[**1.0.0 — September 30, 2026**](https://github.com/yiiwang118/obsidian-glossa/releases/tag/1.0.0) brings organized conversations, local CLI runtimes and clearer control over ongoing work.

- **Compact composer:** file references stay left; API/CLI, provider or CLI app, and model selectors stay right. Pick or type an effort value. Plan/Act, focus styles and narrow layouts are more consistent.
- **Local CLI:** use installed Codex, Claude Code or Grok with native model/effort discovery, remembered choices and configured proxy support.
- **History folders:** create, rename and organize conversations without deleting them when removing a folder.
- **Running tasks:** steer the next API step, queue and edit the next turn, or explicitly resume a persistent task with bounded continuation.
- **Learned skills:** turn a correction into an editable workflow, compare examples before enabling it, and inspect or restore earlier versions.
- **Visible changes:** search model menus, inspect tool activity and per-turn file changes, and undo eligible checkpointed edits with stale-content protection.
- **Review readiness:** independent community-rule linting, unload cleanup, and explicit network, CLI and temporary-file disclosures are part of the release checks.

![Glossa 1.0.0 composer with file references left and runtime, provider and model controls right](docs/screenshots/1.0.0/composer.png)

**Upgrade:** existing API endpoints, model choices and conversation history are retained. Local CLI remains optional and requires a separately installed, signed-in CLI. New controls follow the selected API or CLI runtime's documented permissions below. Glossa 1.0.0 requires desktop Obsidian **1.12.0 or newer**.

See the [Changelog](CHANGELOG.md#100--2026-09-30) for the full release notes.

## Typical Workflows

```text
Open a paper
  -> ask for the method or a figure
  -> Glossa chooses text pages or visual evidence
  -> answer stays grounded to page-level content
```

```text
Name a public paper and a vault folder
  -> bounded source discovery
  -> title and response validation
  -> save the real PDF
  -> inspect the downloaded paper
```

```text
Request a note change
  -> read only the relevant source
  -> preview and approve the edit
  -> write the smallest patch
  -> verify the changed region
```

## Context That Behaves Naturally

- The active Markdown note is refreshed when the request is sent.
- A named attachment or explicit selection is treated as the primary target.
- Source language and response language are separate, so an English paper does not override a Chinese request.
- Long chats keep recent evidence complete, compact older tool output, and preserve corrections, URLs, paths, failures, and next actions.
- Persisted chat data strips repeated image payloads and model-only context while keeping useful text and metadata.

## Sessions and Local Runtimes

- **History folders:** create a folder with `+` below history search, then use a chat's `··· → Move to folder`. Folder actions rename or remove the folder while keeping its chats unfiled. Empty folders survive restart.
- **Running input:** Enter sends text to the API agent's next model step. The composer menu can instead queue the next turn. Edit or remove pending messages; the current tool is allowed to finish. CLI input always queues for the next turn. The queue holds up to 20 text messages and requires a manual send after Stop, closing, or switching chats.
- **Persistent tasks:** use the header's `◎` button, then Resume. Tasks retain their objective, progress and blockers, with 1–20 rounds (default 3). Errors, blockers and the round limit stop continuation; reopening always requires explicit resume. Requires a tool-enabled API endpoint. Continuing requests recheck files and retain the existing approval/checkpoint rules.
- **Local diagnostics:** the export menu downloads up to 500 metadata events: plugin version, model, tool sequence, duration, status, error codes, skill versions and context compaction. No messages, note text, tool arguments, file paths, endpoint URLs or credentials; no automatic upload.
- **Context pressure:** old successful read results are pruned before requesting a summary. Call/result pairs stay valid, while recent evidence, failures and write results stay available. Visible history is retained.

Compact file chips align left, with a three-part selector aligned to the right: **API / CLI → provider or CLI app → model**. API mode lists configured providers, then only the selected provider’s models; CLI mode lists **Codex / Claude Code / Grok**, then that CLI’s models. Long filenames and choices truncate with full details on hover. Effort supports both menu choices and **Custom effort…**; custom values are sent as entered and retained, while incompatible menu selections reset to Auto after a model change. Clear the custom value to restore the default.

Install and sign in to the CLI in your terminal first; Glossa does not install, update or authenticate it. Detection checks standard executable locations; set an explicit binary path under Providers if needed. Selecting CLI reads its native model catalog and per-model effort levels. Returning from API restores the last CLI provider and its choices. Catalogs are cached for 10 minutes, can be refreshed from the model menu, and remain available after a failed refresh. An empty model uses the CLI default. Global/per-endpoint proxy settings apply without reading shell startup scripts.

CLI requires a desktop filesystem vault and runs from the vault root. Codex uses its native read-only or workspace-write sandbox. Claude Code requires `--restricted` support and exposes Read/Glob/Grep, plus Edit/Write for writable Act mode. External MCP configuration is disabled for Codex and Claude Code. Grok requires `streaming-messages-json` support, requests its native read-only/workspace sandbox and limits built-in tools to read/search plus `search_replace` in writable Act mode; built-in shell and subagents are excluded. No CLI enables permission bypass. Native configuration, sandbox support and provider terms still apply; Grok continues to load its local configuration. Native CLI actions do not use Glossa's per-tool approval, workspace subfolder restrictions, learned skills or undo checkpoints. Keep your own file history for important changes. Text and note context are supported; use API mode for images. CLI conversations remain available for folders and export.

## Accounts, network use and local files

Glossa is free and does not require a Glossa account. Cloud model and search providers may require their own account, API key, subscription or usage payment; those charges are paid to the provider. A local HTTP model endpoint can be used instead.

| Feature | Service and purpose | Data sent / trigger |
|---|---|---|
| API chat, translation, completion and skill validation | Your configured model endpoint | Prompts and relevant text/context when you invoke the feature; automatic translation and completion require opt-in. |
| CLI chat and model discovery | The installed CLI's configured provider | Chat/context when sent, or model capability requests when selecting/refreshing a CLI; uses the CLI's existing login. |
| Web search | DuckDuckGo; optional Brave, Tavily, Exa or SerpAPI | Search query; configured provider key where needed. Network tool approval applies, including user-configured auto-approval. |
| Academic search and paper downloads | OpenAlex, arXiv, DuckDuckGo and Yahoo | Search terms/paper titles to find sources and download candidates. |
| Repository search | GitHub's public search API | Repository search terms to find project sources. |
| Page reads and downloads | The requested public website | URL request to read a page or download an approved file. |
| Update checks | GitHub releases API for this repository | Release metadata request; no note content or provider keys. Enabled by default, throttled to once per 12 hours; can be disabled. Updates are installed through Obsidian. |

Local CLI use accesses installed executables outside the vault; your home directory is used to locate common executable paths. Grok requires a prompt file, so Glossa writes the conversation and selected context to a private `glossa-grok-*` directory in the OS temporary folder **outside the vault** (owner-only file permissions on POSIX). It deletes this temporary directory after completion, failure or cancellation; an abrupt host crash may leave it behind. Codex and Claude Code receive prompts over stdin. Glossa does not read CLI credential files; the CLI itself uses its own login, configuration and retention policies.

## Safety by Design

- **Plan mode and read-only permissions** are the conservative starting point.
- **Write approvals** can be scoped by tool, path, folder, or session.
- **Checkpoints** snapshot affected files before destructive edits.
- **Network tools** use bounded responses, redirect checks, private-network blocking, and explicit download intent.
- **Validated downloads** enforce size limits and file signatures before writing.
- **API mode** uses vault tools and Glossa approvals. **CLI mode** explicitly launches an installed local program under the separate boundaries described above.

Glossa itself is not a hosted AI service. Conversation content and selected context are sent to the model endpoint you configure; web content is accessed only for the web action being performed. See [Privacy](PRIVACY.md) and [Security](SECURITY.md) for the exact boundaries.

## Install

### Plugin Marketplace

Open **Settings → Community plugins → Browse**, search for **Glossa**, then install and enable it.

[Open Glossa in the plugin marketplace](https://obsidian.md/plugins?id=glossa)

### GitHub Release

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/yiiwang118/obsidian-glossa/releases/latest), then place them in:

```text
<your-vault>/.obsidian/plugins/glossa/
```

Reload the app and enable **Glossa** under Community plugins.

## Start in a Minute

1. Open Glossa from the ribbon or command palette.
2. Add an OpenAI-compatible, Anthropic-compatible, or local HTTP model endpoint.
3. Open a note, attach a file with `@`, or select text.
4. Ask directly. Stay in **Plan** for read-only work; switch to **Act** when you want file changes.
5. Review approvals before writes or downloads.

### Custom API compatibility

For Anthropic-style endpoints, enter an SDK root such as `https://api.minimax.io/anthropic`, a versioned root ending in `/v1`, or a full Messages URL. Glossa displays the final request URL and uses the same path rules for chat, connectivity testing, and model discovery. OpenAI-compatible endpoints still use their versioned root.

Under an endpoint's **Advanced → Extra JSON body**, enter a JSON object such as `{"reasoning_split":true}` (MiniMax OpenAI format) or `{"thinking":{"type":"disabled"}}` for models that support disabling thinking. Explicit parameters replace generated values at the top level, including thinking, sampling, and token limits. Model, messages, system, tools, tool selection, and stream fields are reserved. Invalid input stays unsaved with a validation message; clear the field to remove overrides. Extra body values are stored in plugin settings as ordinary configuration, so use the API key field for credentials.

The reasoning **Off** option normally omits reasoning effort; it does not guarantee thinking is disabled. MiniMax M2.x cannot disable thinking; select a supported model for `thinking.disabled`.

Quick translation gives MiniMax M2.x an output limit of 16,384 tokens to leave room for thinking. This is a maximum, not a fixed charge or a guarantee of completion; explicit extra-body token limits take precedence. Thinking-only and truncated Anthropic responses display an error with a Retry button instead of a completed translation. In Auto mode, each new eligible selection is sent to your configured translation endpoint; turn Auto off to require a manual action.

## Build and Verify

```bash
git clone https://github.com/yiiwang118/obsidian-glossa.git
cd obsidian-glossa
npm install
npm run check
```

`npm run check` runs TypeScript checks, review and strict lint, directive auditing, an independent community-scanner lint pass, the complete test suite, dependency audit, production build, generated-bundle review scanning, and release metadata validation.

For development builds:

```bash
GLOSSA_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/glossa" npm run dev
```

## Project

- Desktop-only in the current release.
- Compatible with app version 1.12.0 and newer; settings search is enhanced automatically on 1.13+.
- New installations default to Plan mode with read-only permissions.
- Release assets are rebuilt and validated by GitHub Actions before publication.
- Issues and focused, reproducible bug reports are welcome.
- This open-source project recognizes the [LINUX DO community](https://linux.do/).

## License

[MIT](LICENSE) © yiiwang
