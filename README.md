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

[Install](#install) · [Quick start](#start-in-a-minute) · [Background chats](#conversations-and-background-work) · [Models and CLI](#models-reasoning-and-local-cli) · [Upgrade guide](#upgrading-and-local-history) · [Privacy](PRIVACY.md)

## What Glossa Does

| | Capability | What it means in practice |
|---|---|---|
| 🧠 | **Understands context** | Work with the active note, selections, attached files, PDFs, images, and prior task state without repeatedly pasting content. |
| ✍️ | **Edits precisely** | Patch one section, replace exact text, coordinate multi-file changes, and preserve surrounding Markdown instead of rewriting everything. |
| ⌨️ | **Suggests what comes next** | Optionally request bounded, low-latency Markdown continuations while writing and accept the ghost text directly in the editor. |
| 📚 | **Reads serious documents** | Inspect papers by page, search PDF text, render visual pages, examine screenshots, run OCR, and inspect charts or UI details. |
| 🌐 | **Researches the web** | Search bounded public sources, extract useful content, verify paper identity, and save validated downloads with provenance. |
| 🧩 | **Runs focused Skills** | Use built-in workflows for Markdown, Canvas, Bases, PDFs, images, or create and validate your own vault Skills. |
| 🔐 | **Keeps actions accountable** | Start read-only, approve writes, inspect tool results, and restore checkpointed files when an edit needs to be rolled back. |

## New in 1.1.0

[**1.1.0 — October 20, 2026**](https://github.com/yiiwang118/obsidian-glossa/releases/tag/1.1.0) adds background conversations, per-chat history files, folder operations and model-aware reasoning controls.

- **Keep several conversations moving.** Switch chats, start a new one or close the panel while a response continues. History shows which chats are running or waiting for approval; notifications take you back to the relevant chat.
- **Keep more history with less rewriting.** Chats are saved individually, loaded when opened and no longer limited to the 100 most recent. Search uses a bounded preview of your questions and the answers, excluding attached source text.
- **Organize files as well as conversations.** Create empty vault folders, move or rename folders, and send files or whole folders to Obsidian's configured trash. Eligible text files can be restored from the turn's change summary.
- **Choose reasoning that fits the model.** Recognized official API endpoints show model-specific levels and defaults. Compatible gateways retain flexible effort values. Each OpenAI-compatible endpoint also has an automatic, fixed or omitted temperature setting.
- **Read clearer replies.** More interface text follows your language, Markdown spacing is tighter, leading thinking blocks appear in the reasoning card, and code blocks use Obsidian's native copy button.
- **Keep parallel work separate.** Skill approval scopes belong to their own run, writes to the same note are serialized, and stopping a waiting task prevents its pending file change.

![Composer layout with file references left and runtime, provider and model controls right; screenshot from 1.0.0](docs/screenshots/1.0.0/composer.png)

**Requirements:** desktop Obsidian **1.12.0 or newer**. Existing API endpoints and model choices are retained. See [Upgrading and local history](#upgrading-and-local-history) before upgrading, and the [full changelog](CHANGELOG.md#110--2026-10-20) for details.

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

Reasoning labels follow the chosen model. **Default** leaves the provider in control; **Thinking off** is shown when Glossa has a matching disable setting. Some models always reason or have no adjustable depth. Translation and inline completion choose the lightest supported reasoning setting; this does not guarantee that thinking can be disabled.

Quick translation gives MiniMax M2.x an output limit of 16,384 tokens to leave room for thinking. This is a maximum, not a fixed charge or a guarantee of completion; explicit extra-body token limits take precedence. Thinking-only and truncated Anthropic responses display an error with a Retry button instead of a completed translation. In Auto mode, each new eligible selection is sent to your configured translation endpoint; turn Auto off to require a manual action.

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

## Conversations and background work

- **Organize history:** click `+` below history search to create a conversation folder, then use a chat's `··· → Move to folder`. Renaming or removing these folders does not move or delete vault notes; removing a folder keeps its chats unfiled.
- **Run more than one chat:** switch chats or close the Glossa panel after sending. The active run continues while Obsidian and the plugin remain enabled. Reopen history to see running and approval states; the history button counts background runs.
- **Approve in the right chat:** a background chat waits when approval is needed. Open it from history or its notification to review the operation. Closing the panel does not approve a request.
- **Steer or queue:** while an API chat is running, Enter supplies text to its next model step. Use the composer menu to queue the next turn instead; CLI follow-ups always queue. Up to 20 text messages can wait, and pending messages can be edited or removed. Queues scheduled during a run continue when you switch chats or close the panel. Stop ends continuation; after restarting Obsidian, pending messages require a manual send.
- **Set a bounded task:** use the header's `◎` button and Resume. Tasks keep their objective, progress and blockers, with 1–20 rounds (default 3). They can continue in the background; errors, blockers and the round limit stop continuation. Restored tasks require explicit resume. This feature requires a tool-enabled API endpoint.
- **Stop deliberately:** use Stop in the chat to cancel its run and further queued/task continuation. Quitting Obsidian or disabling the plugin also stops runs. Already completed file changes remain recorded.
- **Export diagnostics:** the export menu downloads up to 500 metadata events, including model, tool sequence, duration and error codes. It excludes prompts, note content, tool arguments, paths, endpoint URLs and credentials, and is never uploaded automatically.

## Models, reasoning and local CLI

File references stay on the left; the compact selector on the right follows **API / CLI → provider or CLI app → model**.

| Control | How it works |
|---|---|
| API provider | Choose a configured OpenAI-compatible, Anthropic-compatible or local HTTP endpoint, then select its model. Presets include Gemini, xAI, Z.ai, Kimi, MiniMax, OpenRouter and LM Studio. |
| Reasoning | For recognized official API models, the menu shows the supported levels, switches and defaults. Models with no adjustable reasoning explain why the control is unavailable. |
| Compatible gateway | Third-party API endpoints offer flexible effort values and custom input; choose values accepted by that endpoint. |
| Temperature | Under an OpenAI-compatible endpoint's **Advanced → Temperature**, leave blank for automatic handling, enter `off` to omit the parameter, or enter a number from `0` to `2`. Model-specific restrictions still apply. |
| Local CLI | Select **Codex**, **Claude Code** or **Grok**, then a model and an available effort level. Custom effort input remains available. |

Install and sign in to the CLI in your terminal first; Glossa does not install, update or authenticate it. Detection checks standard executable locations; set an explicit binary path under Providers if needed. Selecting CLI reads its native model catalog and per-model effort levels. Returning from API restores the last CLI provider and its choices. Catalogs are cached for 10 minutes, can be refreshed from the model menu, and remain available after a failed refresh. An empty model uses the CLI default. Global/per-endpoint proxy settings apply without reading shell startup scripts.

CLI requires a desktop filesystem vault and runs from the vault root. Codex uses its native read-only or workspace-write sandbox. Claude Code requires `--restricted` support and exposes Read/Glob/Grep, plus Edit/Write for writable Act mode. External MCP configuration is disabled for Codex and Claude Code. Grok requires `streaming-messages-json` support, requests its native read-only/workspace sandbox and limits built-in tools to read/search plus `search_replace` in writable Act mode; built-in shell and subagents are excluded. No CLI enables permission bypass. Native configuration, sandbox support and provider terms still apply; Grok continues to load its local configuration.

**CLI actions use the CLI's own permissions.** They do not use Glossa's per-tool approvals, workspace-subfolder restrictions, learned skills or undo checkpoints. Keep your own file history for important changes. CLI supports text and note context; use API mode for images. Conversations remain available for folders and export.

## Vault file and folder operations

In API mode, keep **Plan** for reading. To change files, select **Act** with writable permissions and describe the intended operation, for example:

- “Create an empty `Research/Reading` folder.”
- “Move `Inbox/Papers` to `Research/Papers`.”
- “Move `Drafts/Old` and its contents to the trash.”

Writes follow your approval rules. Deletions use Obsidian's configured trash location; the vault root and configuration directory are protected. Inspect the turn's file change summary for results and eligible undo actions. Text snapshots cannot fully restore moves, renames or binary files, and large operations can exceed the snapshot limits. Use file recovery or your backups when undo is unavailable.

## Upgrading and local history

1. Update through Obsidian, or replace **only** `main.js`, `manifest.json` and `styles.css` with the files from the same release. Keep your existing settings and history files.
2. On first load, Glossa migrates the old single-file history to `chats/<id>.json`, with `chats.json` holding folders, summaries and search previews. It retains the old store until every chat is written and retries an incomplete migration.
3. A migration copy, `chats.v3-backup.json`, is kept for 30 days. It can recover missing chat files while available. Deleting a chat also removes its copy from this backup; clearing all chats removes the backup.

These files live under the configured plugin directory, normally `.obsidian/plugins/glossa/`. Chat history, previews, pending messages and task state are **plain text** and may be included in vault sync. API-key encryption does not encrypt chat history. Keep a separate backup before upgrading or downgrading; older versions do not understand the new per-chat storage format. The migration copy is a temporary recovery aid, not a permanent backup.

## Learned skills

**Learn from a correction.** Use **Remember this correction** beside an assistant reply to turn feedback into an editable skill draft. Choose an existing learned skill to improve it, or create a new one. Review the conversation excerpt and workflow diff, then inspect the generated examples or add your own. Each example runs with fresh context against both the candidate and the currently enabled version (or no skill), checking exact output fragments and whether the skill should apply. Editing the draft or examples invalidates the results; every candidate example must pass before you can enable it. Tied scores are shown as no measured gain.

This first version validates **text behavior**, not live tool execution or changes to real notes. Generation uses the selected chat model; validation makes two model calls per example (3–5 examples). The model does not receive the expected output checks. Review the excerpt before sending it; tool result bodies and automatic attachment contents are not collected by the learning feature. There is no background training or model-weight update.

Use **Glossa: Manage learned skills** or **Learning history** in the dialog to inspect results, disable a skill, edit a draft, or restore a previously tested version. Enabled skills join normal skill discovery for future turns and keep the existing tool approval rules. Built-in and manually authored skills are not overwritten. Drafts, workflow versions, feedback references, model identity and validation outputs are stored locally in `.glossa/learning.json`, with up to 12 versions per skill and 60 learned skills. Learning history is plain text and can be included in vault sync; API-key encryption does not encrypt this file. Simultaneous edits are checked before saving. Historical validation results describe the model and examples used at that time.

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
- **Deleting and moving** files or whole folders follows the configured approval rules. Deleted items go to the trash set in Obsidian, and the vault root and configuration folder are never deleted or moved.
- **Network tools** use bounded responses, redirect checks, private-network blocking, and explicit download intent.
- **Validated downloads** enforce size limits and file signatures before writing.
- **API mode** uses vault tools and Glossa approvals. **CLI mode** explicitly launches an installed local program under the separate boundaries described above.

Glossa itself is not a hosted AI service. Conversation content and selected context are sent to the model endpoint you configure; web content is accessed only for the web action being performed. See [Privacy](PRIVACY.md) and [Security](SECURITY.md) for the exact boundaries.

## Build and Verify

```bash
git clone https://github.com/yiiwang118/obsidian-glossa.git
cd obsidian-glossa
npm ci
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
