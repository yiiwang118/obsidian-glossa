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

Glossa turns the sidebar into a working surface, not a separate chatbot. The active note can enter context automatically, explicit attachments stay grounded as the task target, and every file-changing action goes through visible tools and approval rules.

## What Glossa Does

| | Capability | What it means in practice |
|---|---|---|
| 🧠 | **Understands context** | Work with the active note, selections, attached files, PDFs, images, and prior task state without repeatedly pasting content. |
| ✍️ | **Edits precisely** | Patch one section, replace exact text, coordinate multi-file changes, and preserve surrounding Markdown instead of rewriting everything. |
| 📚 | **Reads serious documents** | Inspect papers by page, search PDF text, render visual pages, examine screenshots, run OCR, and inspect charts or UI details. |
| 🌐 | **Researches the web** | Search bounded public sources, extract useful content, verify paper identity, and save validated downloads with provenance. |
| 🧩 | **Runs focused Skills** | Use built-in workflows for Markdown, Canvas, Bases, PDFs, images, or create and validate your own vault Skills. |
| 🔐 | **Keeps actions accountable** | Start read-only, approve writes, inspect tool results, and restore checkpointed files when an edit needs to be rolled back. |

## New in 0.6.7

### Less context overhead, more useful work

- **Smart current-file context.** Summarize, explain, translate, or analyze the open note without selecting it first. Explicit attachments still take priority when the user names another target.
- **Reliable follow-ups.** Short instructions such as “continue”, “use Chinese”, or “save it below” retain the previous title, URL, output folder, failed attempt, and requested object.
- **Targeted and batch reads.** `read_note` can read an exact line range; `read_files` reads up to eight known text files in one bounded call.
- **Active context pruning.** Stale read/search results can leave the model prompt without deleting visible chat history. Write confirmations, downloads, failures, Skills, and plans stay protected.
- **Deferred specialized tools.** The first request stays compact. Canvas, backlinks, frontmatter, batch reading, Skill validation, and other specialist schemas load only when needed.
- **Loop protection.** Returned tool errors are represented as real errors, repeated failures force a strategy change, and identical-call loops are stopped before they waste the run.

### Better documents and media

- **Task-aware PDF reading.** Inspect identity, summarize, search concepts, read page ranges, or render visual evidence for formulas, tables, figures, and scans.
- **Purpose-built image inspection.** Choose description, OCR, UI review, chart analysis, detail crops, or exact pixel-color sampling.
- **Stable math rendering.** Existing `\(...\)` and `\[...\]` formulas are normalized for the reading view while code fences and inline code remain untouched.
- **Faster repeated media work.** PDF text, rendered pages, image reads, and crops use bounded in-memory caches keyed by file identity and processing options.

### Skills that are easier to trust

Glossa includes six focused Skills:

`obsidian-markdown` · `obsidian-canvas` · `obsidian-bases` · `pdf-analysis` · `image-analysis` · `skill-creator`

The Skill Creator defines positive and negative trigger examples, chooses an appropriate constraint level, writes a focused `SKILL.md`, and validates naming, activation cues, path safety, workflow structure, and tool references.

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

## Safety by Design

- **Plan mode and read-only permissions** are the conservative starting point.
- **Write approvals** can be scoped by tool, path, folder, or session.
- **Checkpoints** snapshot affected files before destructive edits.
- **Network tools** use bounded responses, redirect checks, private-network blocking, and explicit download intent.
- **Validated downloads** enforce size limits and file signatures before writing.
- **Community builds** do not execute shell commands, read system identity, or use direct system filesystem access.

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

## Build and Verify

```bash
git clone https://github.com/yiiwang118/obsidian-glossa.git
cd obsidian-glossa
npm install
npm run check
```

`npm run check` runs TypeScript checks, review and strict lint, directive auditing, the complete test suite, dependency audit, production build, generated-bundle review scanning, and release metadata validation.

For development builds:

```bash
GLOSSA_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/glossa" npm run dev
```

## Project

- Desktop-only in the current release.
- New installations default to Plan mode with read-only permissions.
- Release assets are built and attested by GitHub Actions.
- Issues and focused, reproducible bug reports are welcome.
- This open-source project recognizes the [LINUX DO community](https://linux.do/).

## License

[MIT](LICENSE) © yiiwang
