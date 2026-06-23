<div align="center">

# Glossa

**An AI sidebar for your knowledge base — multi-provider chat, agent mode, context-aware editing, vault-native skills.**

[![CI](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml/badge.svg)](https://github.com/yiiwang118/obsidian-glossa/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/yiiwang118/obsidian-glossa?display_name=tag&sort=semver)](https://github.com/yiiwang118/obsidian-glossa/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-96_passed-brightgreen)](tests/)
[![zh](https://img.shields.io/badge/中文-README-orange)](README.zh-CN.md)

</div>

---

## What it is

Glossa is a side-panel assistant for Obsidian desktop. It speaks to multiple LLM providers (OpenAI, Anthropic, compatible gateways, Codex CLI, and local CLI bridges), reads your selection / current note / arbitrary files via `@`-mentions, runs a tool-using agent over your vault with explicit per-action approval, and stays out of your way the rest of the time.

It is **not** a cloud service. Glossa is a local plugin; network calls go to provider endpoints you configure, embedding endpoints you choose, public URLs you attach / approve, and any MCP or local CLI tools you explicitly enable.

## Features

- **Multi-provider** · OpenAI, Anthropic, any OpenAI/Anthropic-compatible gateway (DeepSeek, GLM, Qwen, Groq, MiniMax, Gemini-via-proxy, local Ollama, …), plus Codex CLI and Codex App-Server. One sidebar, one chat history, switch endpoint per session.
- **Context the model can see** · `@file`, `@folder`, `@tag`, `@selection`, `@clipboard`, `@web url`; auto-attach current file / selection; per-chip pin & remove.
- **Agent mode with sandboxed tools** · 40+ tools covering read / edit / search / RAG / canvas / frontmatter / tags / templater / dataview / tasks / web. Three permission levels (read-only / workspace-write / full). Per-tool, per-folder, per-session approval rules. Audit log of every decision.
- **`apply_patch` envelopes** · Codex-style multi-file diffs with progressive matching (exact → rstrip → trim → unicode-normalised) and preview-before-apply.
- **Semantic search (RAG)** · Local cosine over your own embedding endpoint; incremental rebuild on file change; never sends content to anyone except the embedding endpoint *you* picked, with a one-time consent gate.
- **Skills** · Markdown files in `.glossa/skills/` become callable agent skills with their own allowed-tools list. Conditional activation by glob (`paths: ['*.canvas']`).
- **MCP bridge** · Hook in any MCP server (filesystem, GitHub, Slack, …). Tools surface in the agent loop; permission rules apply.
- **Encryption** · Optional passphrase encrypts API keys at rest (PBKDF2 + AES-GCM-256, key never extractable from memory).
- **Slash commands** · `/translate`, `/summarize`, `/critique`, `/improve`, `/diagram`, `/skill`, `/tldr` etc. — fully customisable.
- **Checkpoints** · Every destructive tool snapshots affected files first; one-click rollback per turn.
- **Auto-compaction** · Long sessions get summarised in-place when crossing a token budget; undo available.

## Screenshots

Screenshots are kept in `docs/screenshots/` for release submissions. They are not required to build the plugin.

## Install

### From the in-app community marketplace (after acceptance)

1. Settings → Community plugins → Browse → search **Glossa**
2. Install → Enable
3. Open the right sidebar; the Glossa icon appears
4. Click the gear → Providers → add at least one endpoint

### Beta / pre-release via BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. BRAT → Add Beta plugin → `yiiwang118/obsidian-glossa`
3. Enable in Community plugins

### Manual

```bash
# in your vault
mkdir -p .obsidian/plugins/glossa
cd .obsidian/plugins/glossa
# Download main.js / manifest.json / styles.css from the latest release:
curl -L -o main.js       https://github.com/yiiwang118/obsidian-glossa/releases/latest/download/main.js
curl -L -o manifest.json https://github.com/yiiwang118/obsidian-glossa/releases/latest/download/manifest.json
curl -L -o styles.css    https://github.com/yiiwang118/obsidian-glossa/releases/latest/download/styles.css
```

Then reload the host app and enable Glossa under Community plugins.

## Quick start

1. Open the sidebar (ribbon icon or command palette → "Open sidebar")
2. Settings → Providers → **Add endpoint** → paste an API key
3. New installs start in **Plan** + **read-only**. Switch to **Act** or raise permissions only when you want the agent to write files.
4. Type, or `@` to attach context, or `/` to fire a slash command
5. Shift-Enter for newline, Enter to send

## Provider matrix

| Provider | Streaming | Tool calls | Thinking / Reasoning | Image input |
|---|---|---|---|---|
| OpenAI / OpenAI-compat | ✅ | ✅ | ✅ (reasoning_effort) | ✅ data-URI |
| Anthropic | ✅ | ✅ | ✅ (extended thinking) | ✅ |
| Codex CLI (legacy `exec --json`) | ✅ | ✅ | ✅ (xhigh effort) | ✅ tmp-file |
| Codex App-Server (stdio JSON-RPC) | ✅ | ✅ | ✅ | ✅ |
| Claude Code CLI (local, experimental) | ✅ | ✅ | ✅ | depends |
| Custom (any HTTP gateway) | ✅ | ✅ | depends | depends |

Use Obsidian system-proxy mode (`useObsidianFetch`) for gateways behind corporate / GFW proxies.

## Agent mode

New installs default to **Plan** mode with **read-only** permission. Three permission levels are available:

- **read-only** — only tools tagged `isReadOnly: true` (read_note, search_vault, semantic_search, …) can run
- **workspace-write** — read + write tools (file_edit, write_note, patch_note, apply_patch, …); destructive calls hit the approval modal
- **full** — same as above, plus execute_command and dangerous codex sandboxes (use with caution)

Approval rules can be saved with three scopes — global (any args), folder (path prefix), exact path — and three behaviors — allow, deny, ask. Every decision is appended to a 200-entry audit log.

## Privacy & security

See [PRIVACY.md](PRIVACY.md) for the exact data-flow map (what goes to which provider when), and [SECURITY.md](SECURITY.md) for vuln disclosure policy.

**Short version**:
1. Your chat / prompt / attached context goes to the **provider you configured**. Glossa's author cannot see it.
2. RAG / embedding rebuild **uploads every markdown file's content** to your chosen embedding endpoint. A one-time consent modal asks before the first build.
3. API keys default to plaintext in `data.json`. Turn on encryption in Settings → Security if you want a passphrase gate at unlock.
4. Local CLI endpoints (`codex`, `claude`) spawn subprocesses and may inherit whitelisted shell proxy / API-key environment so those tools work from the Obsidian desktop app.
5. MCP child processes inherit a *filtered* env (LLM credentials stripped). If you use other-tool secrets (GitHub PAT, AWS keys), put them in the per-MCP-server env override instead of your shell rc.

## Skills

Drop a Markdown file in your vault at `.glossa/skills/<your-skill>/SKILL.md`:

```yaml
---
name: critique-this
description: Reviewer-style critical pass with strict line-budget.
allowed-tools: [read_note, file_edit]
paths: ['Reviews/*.md']    # optional: activate only when this glob matches the active file
---

Review the attached document with the eye of an ICML reviewer. Output:
- 3 strongest points (1 line each)
- 5 weaknesses (1 line each, ordered by severity)
- 1 line on whether you'd accept

Use `read_note` first if the document isn't already in context.
```

The agent will find it via `tool_search` and invoke it via the `skill` tool.

## MCP servers

Settings → MCP → Marketplace, or add manually:

```json
{
  "id": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
}
```

Tools expose as `github__list_issues`, `github__create_pr`, etc. Permission rules can target individual MCP tools or the whole server via `mcp:github:*`.

## Build from source

```bash
git clone https://github.com/yiiwang118/obsidian-glossa.git
cd obsidian-glossa
npm install
npm run dev        # rebuild on save
npm run build      # production bundle (main.js)
npm run typecheck  # tsc --noEmit
npm test           # in-tree Node tests
npm run release:check -- --allow-dirty
```

## Testing

Glossa currently ships a focused in-tree Node test suite in `tests/`:

| Area | Covered by |
|---|---|
| permissions / MCP rules | `permission_rule.test.cjs`, `agent_permission.test.cjs` |
| patch envelopes / globbing / stable stringify | `patch_envelope.test.cjs`, `list_files_glob.test.cjs`, `stable_stringify.test.cjs` |
| compaction / model context / PDF extraction | `compact.test.cjs`, `model_context.test.cjs`, `pdf_extract.test.cjs` |
| Codex CLI argument safety | `codex_cli_args.test.cjs` |
| release defaults / large diff guard | `release_readiness.test.cjs` |

```bash
npm test              # 10 test files, 96 assertions at this release
npm run typecheck
npm run build
npm run release:check -- --allow-dirty
```

## Roadmap

See [open issues with the **enhancement** label](https://github.com/yiiwang118/obsidian-glossa/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement) and the [milestones tab](https://github.com/yiiwang118/obsidian-glossa/milestones).

Short-term focus areas:
- Skill marketplace (curated `.glossa/skills/` bundles)
- Per-message branching (alt-response trees)
- Local-only mode (Ollama / llama.cpp / no network)
- Mobile build (currently desktop-only because of `child_process` and `node:fs` use)

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the build / test loop. Before opening a PR:

1. `npm test`, `npm run typecheck`, and `npm run build` clean
2. New tools include focused tests in `tests/*.test.cjs`
3. UI-visible changes include a screenshot in the PR description
4. No `console.log` left in production paths

## Acknowledgements

The agent loop, `apply_patch` envelope, skill system, and tool registry shape are heavily inspired by [Claude Code](https://github.com/anthropics/claude-code) and Codex. The settings / approval / rollback patterns borrow from [Cline](https://github.com/cline/cline). Thanks to all the open-source predecessors that made this possible.

## License

[MIT](LICENSE) © yiiwang
