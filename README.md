<div align="center">

# 𝓖𝓵𝓸𝓼𝓼𝓪

**A clean, local-first AI sidebar for Obsidian.**

Chat with your notes, attach real context, run careful vault tools, and switch between API providers or local coding agents without leaving your workspace.

[![Obsidian plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md/plugins?id=glossa)
[![Release](https://img.shields.io/github/v/release/yiiwang118/obsidian-glossa?display_name=tag&sort=semver)](https://github.com/yiiwang118/obsidian-glossa/releases)
[![CI](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml/badge.svg)](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-111827.svg)](LICENSE)

</div>

---

## Why Glossa

Most AI note tools are either too small to be useful or too closed to trust. Glossa is built for people who actually work inside Obsidian: researchers, engineers, writers, and anyone who needs an assistant that can read context, explain files, edit notes, and stay accountable.

Glossa is not a cloud service. It runs as a local Obsidian desktop plugin. Your data goes only to the model providers, embedding endpoints, websites, MCP servers, or local CLI tools you explicitly configure or approve.

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

1. Open **Settings → Community plugins → Browse**.
2. Search for **Glossa**.
3. Install and enable the plugin.
4. Open the Glossa sidebar and add a provider in **Settings → Providers**.

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
| 🌐 Web page | Fetch and use external context with explicit intent. |

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
npm test
```

For local development:

```bash
GLOSSA_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/glossa" npm run dev
```

## Project Notes

- Desktop-only for now, because full agent mode uses Node/Electron capabilities.
- New installs start conservatively: Plan mode + read-only permissions.
- Release assets are built from source by GitHub Actions.
- Contributions, issues, and focused bug reports are welcome.

## Community

This open-source project is linked with and recognizes the [LINUX DO community](https://linux.do/).

## License

[MIT](LICENSE) © yiiwang
