# Privacy & Data Flow

Glossa is a **local plugin**. There is no Glossa-controlled server, no telemetry, no analytics, no crash reporting. The plugin author cannot see what you type or any content of your vault.

What follows is a map of network calls and stored data for API chat and optional desktop CLI use.

## Outbound network calls

| When | Destination | Payload | Trigger | Avoidable? |
|---|---|---|---|---|
| You send a chat message | The LLM endpoint **you configured** | Full prompt: system prompt + history + attached context (file content of any `@` chips) + your current message | You press Enter | Yes — don't send the message |
| Streaming a response | Same as above | Server-Sent Events stream back; no extra outbound | Implicit when sending | — |
| Tool call (agent mode) | The LLM endpoint | Tool result text as the next user turn | Agent loop after a tool runs | Yes — switch to Plan mode (read-only) or run tools manually |
| Web search and repository search | DuckDuckGo, optional Brave / Tavily / Exa / SerpAPI, or GitHub search API | Search query and a configured search-service key when required | Network tool approval or configured auto-approval | Yes — deny approval / disable auto-approval |
| Academic search and download candidate discovery | OpenAlex, arXiv, DuckDuckGo and Yahoo | Search terms or paper titles | Approved search / download workflow | Yes — don't invoke or approve the workflow |
| `web_fetch` tool | The URL you / the model fetched | HTTP GET; standard `User-Agent` | Tool invocation; approval prompt | Yes — deny the approval |
| `@url` mention attaching a web page | That URL | HTTP GET | You typed an `@http...` reference | Yes — don't attach |
| Endpoint connection test | The selected Custom API endpoint (`/models` or a Messages ping) | API key and configured extra body parameters; the ping defaults to a 1-token output limit unless explicitly overridden | You click "Test" / "Test active endpoint" in settings | Yes — don't click |
| Quick translation | The translation endpoint you selected | Selected PDF, Markdown, or HTML text and a translation prompt, plus configured extra body parameters | You invoke translation, or enable Auto mode and make a new selection | Yes — turn selection translation off and don't invoke it |
| Version check | GitHub's public releases API for `yiiwang118/obsidian-glossa` | A request for release metadata; no vault text or API keys | Automatic checks (enabled by default), or you click "Check for updates" | Yes — disable update checks |
| Inline completion | The completion endpoint you selected | Current file path, nearest preceding heading, and configurable text before/after the cursor (defaults: 800 before, 200 after) | You explicitly enable inline completion, then pause while editing Markdown | Yes - keep inline completion off |

Pasting a screenshot reads image data only from that explicit paste event. Glossa does not poll, monitor, or read ambient clipboard contents. The pasted image remains a local composer attachment until you send the message; sending then follows the first row above.

**The author of Glossa does not run any of these endpoints.** Glossa only calls configured provider URLs and public web URLs you attach or approve.

## Local subprocesses and shell environment

Selecting Codex, Claude Code or Grok explicitly starts the installed local binary. Detection runs its version command; sending passes the system prompt, conversation and selected text context over stdin for Codex/Claude Code. Grok receives a private temporary prompt file outside the vault in the OS temporary directory (owner-only permissions on POSIX), removed after completion, failure or cancellation. Conversation text is never placed in command-line arguments. An abrupt host crash can leave the temporary file for the OS to clean up. The CLI contacts its configured provider using its existing login. Glossa does not read authentication files, run login shells, install dependencies or upload telemetry. Child processes inherit the application environment, with common executable directories added to PATH and any explicitly configured proxy applied. The home directory is used only to find standard executable locations.

The current vault is the CLI working directory. Codex uses its native read-only/workspace-write sandbox; Claude Code uses restricted mode and a limited set of file tools. Codex and Claude Code disable external MCP configuration. Grok requests native read-only/workspace sandboxing, limits built-in file tools and disables subagents; its local configuration, including hooks and MCP settings, still applies. Permission bypass is never enabled. Native CLI commands and file operations do not pass through Glossa approvals, workspace-subfolder restrictions or checkpoints. CLI settings, instructions and the CLI provider's privacy policy remain relevant; its own data retention or telemetry is outside Glossa's control. Glossa does not log in automatically or start unsolicited CLI conversations. Once you send a message, its CLI run can continue while you switch chats or close the panel; Stop, plugin unload or quitting Obsidian ends the run.

Queued text is stored until consumed. A resumed persistent task authorizes up to its configured number of additional model rounds. Stop, errors, blockers or the round limit end continuation; a reopened task never resumes automatically. Diagnostic export is an explicit local download containing allowlisted metadata, without prompts, note text, tool arguments, paths, headers, endpoint URLs or keys.

Opt-in **Native Codex sessions** use the installed Codex App Server. Glossa saves the thread association in the chat file; Codex also retains the conversation in its own local storage. Resetting the association or deleting a Glossa chat does not delete Codex’s copy. Native sessions use the same vault-level sandbox boundary described above.

Skill generation and text/file evaluations send the reviewed correction, skill and supplied examples to the selected model. File evaluation gives the API model access only to temporary sample files via a restricted tool set, without shell, network tools or existing notes. Expected file contents are checked locally and are not included in prompts. Samples and evaluation results are stored in `.glossa/learning.json`. Temporary files under `.glossa/evaluations/<run-id>/` are removed after completion, failure or cancellation; abrupt host termination can leave them on disk. Both locations are plaintext and may be synced with the vault.

Opt-in idle compaction makes one additional request to the chat’s API endpoint after an eligible large conversation becomes idle near its configured cache expiry. It may resend the previous request prefix and results to request a summary. The prefix is retained in memory only until the attempt is finished or cancelled, is capped in size, and is not restored after restart. Cache lifetime is user-declared; a cache hit and lower cost are not guaranteed. Typing, new requests, pending messages and active tasks prevent the attempt. Manual and context-pressure compaction can also send history to the configured model.

## Temporary discussions

Temporary chat is a separate, API-only text discussion. Each question sends the passages quoted with it (and, for a quoted reply, the visible question it answered) and the earlier turns of that temporary chat, including stopped or failed ones marked as unfinished. The quotes are shown with each question. Nothing else from the main conversation is sent: no other messages, vault notes, attachments, hidden reasoning, tool output or CLI sessions, and it has no tools. When a discussion is too long for the model, the oldest turns are left out rather than sent. The API endpoint the temporary chat uses (the main chat's, otherwise your first API endpoint, or the one picked in the window's menu) receives these requests and its retention policy applies.

Temporary quotes, messages, reasoning shown in the window and drafts live only in plugin memory. They are not written to chat files, the chat index or the saved workspace view state; a temporary chat window restored from a saved layout closes itself. Closing a window stops generation but keeps the discussion for reopening during this app lifetime; restarting Obsidian or disabling Glossa clears it. Two explicit actions move content out of memory: **Place in main composer** puts one reply into the source chat's composer without sending it (if you send it, it becomes part of the ordinary persisted main conversation), and **Save as note** writes the discussion, with its quotes, as a plaintext Markdown note in your chats folder.

## Data stored locally

All paths are inside the user's vault under its configured plugin directory (normally `.obsidian/plugins/glossa/`). The configuration directory can be customized. These files may be synced if your vault sync setup (Obsidian Sync, iCloud, Dropbox, …) includes that directory.

| File | What's in it | Encrypted? |
|---|---|---|
| `data.json` | Settings, endpoint configs (incl. API keys and extra JSON body parameters) | API keys: opt-in via passphrase (Settings → Security). Other fields, including extra body parameters: plaintext. Use the API key field for credentials. |
| `chats.json` | Chat index: folders, titles, timestamps and a bounded search preview of what you typed and the answers | Plaintext, including its `.bak` copy. |
| `chats/<id>.json` | One file per chat: messages, pending text, task and subtask progress with bounded recent output, bounded run-status events, optional Codex thread association, bounded diagnostic metadata, tool events, reasoning and timestamps | Plaintext. |
| `chats.deleted.json` | IDs and times of deleted chats, so a synced older copy cannot bring them back | Plaintext (no chat content). |
| `chats.v3-backup.json` | Copy of the single-file `chats.json` kept when upgrading to per-chat files. Deleting a chat removes it here too; the copy is removed after 30 days or when you clear all chats | Plaintext. |
| `embeddings.json` | Legacy semantic-index data from older builds, if present. The community review build does not rebuild it. | Encrypted **only** if encryption was enabled when created. Otherwise plaintext legacy data. |
| `checkpoints.json` | Pre-edit snapshots of files touched by destructive tools (7-day TTL, 200-entry cap) | Encrypted **only** if encryption is enabled. |
| `nested_skill_dirs.json` | Cached list of `.glossa/skills/` directories discovered in your vault | Plaintext (just paths). |
| `tool_outputs/*.txt` | Tool results that exceeded inline-size cap, persisted for the model to re-reference | Plaintext. |

If you turn encryption ON in Settings → Security, API keys and newly written checkpoint payloads use AES-GCM-256, with a key derived from your passphrase via PBKDF2 (600,000 iterations for current keys). Chat history and ordinary settings, including extra body parameters, remain plaintext. Legacy encrypted data may use the earlier 200,000-iteration format. The key never leaves the WebCrypto layer — JavaScript sees only an opaque `CryptoKey` handle, which is dropped when you "lock" the plugin.

## What is *not* sent

- No usage analytics
- No crash reports
- No identifier of you, your machine, or your vault
- No content unless you explicitly send/queue a message, resume a bounded task, attach context, approve a web fetch or note tool, invoke translation, run skill generation/evaluations or compaction, or enable idle compaction, automatic translation or inline completion
- PDF text extraction is local through Obsidian/PDF.js; extracted text is only sent if you attach it or the agent returns it to the LLM as tool context

## Provider-side privacy

Whatever you send to the LLM endpoint is subject to **that provider's** privacy policy, not Glossa's. Read theirs.

- OpenAI: <https://openai.com/policies/privacy-policy/>
- Anthropic: <https://www.anthropic.com/legal/privacy>
- DeepSeek / GLM / Qwen / others: check their respective policies

Some providers retain prompts for training by default. Disable training opt-in there if you care.

## A short list of opinionated defaults

- API keys default to **plaintext** in `data.json`. We recommend enabling encryption (Settings → Security) — but we do *not* force it, because losing the passphrase locks you out of your own keys.
- Semantic indexing is disabled in the community review build.
- New installs default to **Plan** + **read-only** mode. Raising permission to `workspace-write` or `full` is an explicit user action.
- In API mode, Plan/read-only blocks write tools. Writable modes consult explicit deny/ask rules, configured approvals and tool permission checks. Matching allow rules or a loaded skill's allowed tools can skip individual prompts; skill allowances are isolated to that chat run.

## Questions

File a [discussion](https://github.com/yiiwang118/obsidian-glossa/discussions) — not an issue, since this isn't a bug.

Local CLI model discovery exchanges initialization and model-list metadata with the installed CLI, without sending chat messages or starting a model turn. Glossa caches model names and supported effort levels in its local settings; credentials remain managed by the CLI.
