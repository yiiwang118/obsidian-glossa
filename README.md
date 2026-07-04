<div align="center">

# 𝓖𝓵𝓸𝓼𝓼𝓪

**Local-first AI assistant for your vault.**

Chat with notes, attach selections and files, search your vault, and run approved agent tools without leaving your workspace.

[![Obsidian plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md/plugins?id=glossa)
[![Release](https://img.shields.io/github/v/release/yiiwang118/obsidian-glossa?display_name=tag&sort=semver)](https://github.com/yiiwang118/obsidian-glossa/releases)
[![CI](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml/badge.svg)](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-111827.svg)](LICENSE)

<img src="docs/assets/glossa-hero.png" alt="Glossa running inside Obsidian" width="100%">

</div>

---

## Why Glossa

Most AI note tools are either too small to be useful or too closed to trust. Glossa is built for people who work in long-lived knowledge bases: researchers, engineers, writers, and anyone who needs an assistant that can read context, explain files, edit notes, and stay accountable.

Glossa is not a cloud service. It runs locally as a desktop plugin. Your data goes only to the model providers, embedding endpoints, websites, MCP servers, or local CLI tools you explicitly configure or approve.

## What's New

- **2026-07-04 — 0.6.3 update notice polish.** The update prompt now prioritizes the in-app plugin page, with GitHub kept as a fallback.
- **2026-07-04 — 0.6.2 release-readiness polish.** Tightened marketplace metadata, refreshed the README and changelog, removed review-scan noise from CSS/network/lint checks, and added stricter release checks.
- **2026-07-03 — ⚡ Faster selection translation.** Select text and press Enter twice to translate; mixed-language Markdown now detects the natural-language source more carefully.
- **2026-07-03 — 🧹 Cleaner selection card.** The selection preview stays compact, with the quick-translate hint moved into the composer placeholder.
- **2026-06-30 — ![NEW](https://img.shields.io/badge/NEW-EF4444?style=flat-square) 🌐 Web research pipeline.** Glossa can now search through the free auto provider or Brave, Tavily, Exa, and SerpAPI, then fetch bounded source notes instead of dumping raw pages.
- **2026-06-30 — ![NEW](https://img.shields.io/badge/NEW-EF4444?style=flat-square) 📥 Safer downloads.** Public PDFs, images, release assets, datasets, and other files can be saved into the vault with size caps, private-network redirect blocking, SHA-256 hashes, and optional `.source.json` provenance.
- **2026-06-30 — ✨ Update awareness.** A small sidebar notice can tell you when a newer GitHub release is available, with a manual check command and a dismiss option.
- **2026-06-29 — 🧭 Long-chat navigation.** A compact conversation rail records user prompts only, highlights the current prompt, and lets you jump back without cluttering the transcript.
- **2026-06-26 — 📎 Context clarity.** Uploaded files now remain visible on the user message after sending, while the composer separates user attachments from the current open file.

<details>
<summary>Earlier updates from the first community release path (2026-06-23 — 2026-06-26)</summary>

- **2026-06-26 — 0.5.0 UI refresh.** AI Studio-inspired sidebar polish, cleaner activity rows, better PDF context handling, fixed duplicate Thinking indicators, and improved history/session behavior.
- **2026-06-25 — 0.4.3 release polish.** Better PDF and image workflow guidance, `xhigh` reasoning-effort support, safer selection capture, and custom API tool-call fixes.
- **2026-06-23 — 0.4.2 submission follow-up.** Obsidian release-readiness cleanup, trusted SVG rendering without unsafe `innerHTML`, and GitHub Actions artifact provenance.
- **2026-06-23 — 0.4.1 initial community submission pass.** Added `read_pdf`, release checks, local CLI warning banners, conservative default permissions, and safer large-diff previews.

</details>

## Highlights

| | |
|---|---|
| 🧠 **Context-aware chat** | Attach the current file, selected text, PDFs, images, folders, tags, clipboard text, web pages, or `@`-mentioned notes. |
| 🛠 **Agent tools** | Read, search, edit, patch, create, rename, inspect PDFs, query metadata, manage tags/frontmatter, run skills, and more. |
| 🔐 **Permission-first workflow** | Start in Plan/read-only mode, then approve write actions per tool, path, folder, or session. |
| 🔎 **RAG / semantic search** | Build a vault index with the embedding endpoint you choose, with a clear consent gate before upload. |
| ⚡ **Provider flexibility** | Use OpenAI-style APIs, Anthropic-style APIs, compatible gateways, Codex CLI, Codex App-Server, or Claude Code CLI. |
| 🧩 **Skills + MCP** | Turn Markdown playbooks into callable skills and connect external MCP servers under the same approval model. |
| 🧯 **Checkpoints** | Destructive edits create snapshots first, so agent changes can be reviewed and rolled back. |

## Install

### Recommended: Obsidian Plugin Marketplace

Open **Settings → Community plugins → Browse**, search for **Glossa**, then install and enable it. Add your first model endpoint in **Glossa Settings → Providers**.

[Open Glossa in the Obsidian plugin marketplace](https://obsidian.md/plugins?id=glossa)

### GitHub Release

Download the latest release assets from GitHub:

- `main.js`
- `manifest.json`
- `styles.css`

Place them in:

```text
<your-vault>/.obsidian/plugins/glossa/
```

Then reload Obsidian and enable **Glossa** under Community plugins.

[Download the latest GitHub release](https://github.com/yiiwang118/obsidian-glossa/releases/latest)

## Quick Start

1. Open Glossa from the ribbon icon or command palette.
2. Add a provider endpoint.
3. Ask a question, use `/commands`, or attach context with `@`.
4. Stay in **Plan** for read-only reasoning, switch to **Act** when you want file operations.
5. Review approvals before any sensitive write or shell action.

## What You Can Attach

| Source | Use it for |
|---|---|
| 📄 Current note | Explain, rewrite, summarize, continue writing. |
| 🧾 PDF | Extract titles, summaries, methods, tables, citations, or page-specific details. |
| 🖼 Image | Ask about screenshots, diagrams, UI bugs, or visual evidence. |
| 🗂 Folder / tag | Give the model a scoped view of a project area. |
| ✂ Selection | Transform exactly the selected passage without pasting it manually. |
| 🌐 Web page / search | Fetch a known page, search current sources, or download public assets with explicit approval. |

Glossa treats user-attached files as the primary target for phrases like “this file” or “this PDF”. The current open file is kept as ambient context unless you explicitly ask for it.

## Privacy & Security

- Chats and attached context are sent to the provider you configure.
- Semantic indexing sends note chunks to the embedding endpoint you choose.
- API keys can be encrypted at rest with a passphrase.
- Local CLI providers and MCP servers run on your machine and follow Glossa permission controls.
- Tool calls, approvals, and destructive edits are designed to be visible before they matter.

Read more:

- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)

## Build From Source

```bash
git clone https://github.com/yiiwang118/obsidian-glossa.git
cd obsidian-glossa
npm install
npm run build
npm run typecheck
npm run lint:review
npm test
npm run release:check
```

For local development:

```bash
GLOSSA_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/glossa" npm run dev
```

## Project Notes

- Desktop-only for now, because full agent mode uses Node/Electron capabilities.
- New installs start conservatively: Plan mode + read-only permissions.
- Release assets are built from source by GitHub Actions and attached to GitHub Releases.
- `npm run lint:review` mirrors the TypeScript rules that commonly surface in community review scans.
- `npm run release:check` verifies version metadata, release files, and manifest description constraints.
- Update checks are optional and can be disabled in settings.
- Contributions, issues, and focused bug reports are welcome.

## Community

This open-source project is linked with and recognizes the [LINUX DO community](https://linux.do/).

## License

[MIT](LICENSE) © yiiwang
