# Privacy & Data Flow

Glossa is a **local plugin**. There is no Glossa-controlled server, no telemetry, no analytics, no crash reporting. The plugin author cannot see what you type or any content of your vault.

What follows is a map of network calls and stored data for the community review build.

## Outbound network calls

| When | Destination | Payload | Trigger | Avoidable? |
|---|---|---|---|---|
| You send a chat message | The LLM endpoint **you configured** | Full prompt: system prompt + history + attached context (file content of any `@` chips) + your current message | You press Enter | Yes — don't send the message |
| Streaming a response | Same as above | Server-Sent Events stream back; no extra outbound | Implicit when sending | — |
| Tool call (agent mode) | The LLM endpoint | Tool result text as the next user turn | Agent loop after a tool runs | Yes — switch to Plan mode (read-only) or run tools manually |
| `web_fetch` tool | The URL you / the model fetched | HTTP GET; standard `User-Agent` | Tool invocation; approval prompt | Yes — deny the approval |
| `@url` mention attaching a web page | That URL | HTTP GET | You typed an `@http...` reference | Yes — don't attach |
| Endpoint connection test | The selected Custom API endpoint (`/models` or a 1-token ping) | API key as required by that endpoint | You click "Test" / "Test active endpoint" in settings | Yes — don't click |

Pasting a screenshot reads image data only from that explicit paste event. Glossa does not poll, monitor, or read ambient clipboard contents. The pasted image remains a local composer attachment until you send the message; sending then follows the first row above.

**The author of Glossa does not run any of these endpoints.** Glossa only calls configured provider URLs and public web URLs you attach or approve.

## Local subprocesses and shell environment

The community review build does not spawn local binaries, read shell environment variables, or start MCP servers. Local CLI endpoint kinds from older settings are kept disabled and return a message directing users to Custom API endpoints.

## Data stored locally

All paths are inside the user's vault under `.obsidian/plugins/glossa/`. None of this is synced unless your vault sync setup (Obsidian Sync, iCloud, Dropbox, …) explicitly includes `.obsidian/`.

| File | What's in it | Encrypted? |
|---|---|---|
| `data.json` | Settings, endpoint configs (incl. API keys) | API keys: opt-in via passphrase (Settings → Security). Other fields: plaintext. |
| `chats.json` | Every chat session: messages, tool events, reasoning, timestamps | Plaintext. |
| `embeddings.json` | Legacy semantic-index data from older builds, if present. The community review build does not rebuild it. | Encrypted **only** if encryption was enabled when created. Otherwise plaintext legacy data. |
| `checkpoints.json` | Pre-edit snapshots of files touched by destructive tools (7-day TTL, 200-entry cap) | Encrypted **only** if encryption is enabled. |
| `nested_skill_dirs.json` | Cached list of `.glossa/skills/` directories discovered in your vault | Plaintext (just paths). |
| `tool_outputs/*.txt` | Tool results that exceeded inline-size cap, persisted for the model to re-reference | Plaintext. |

If you turn encryption ON in Settings → Security, API keys and the four `.json` blobs above are sealed with AES-GCM-256, key derived from your passphrase via PBKDF2 (200 000 iterations). The key never leaves the WebCrypto layer — JavaScript sees only an opaque `CryptoKey` handle, which is dropped when you "lock" the plugin.

## What is *not* sent

- No usage analytics
- No crash reports
- No identifier of you, your machine, or your vault
- No content unless you explicitly send a message, attach context, approve a web fetch, or approve a note tool
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
- The agent's `read-only` and `workspace-write` permission levels are designed so the LLM cannot run anything irreversible without you clicking "Approve" — even when auto-approve rules are configured, destructive tools never go through silently the first time.

## Questions

File a [discussion](https://github.com/yiiwang118/obsidian-glossa/discussions) — not an issue, since this isn't a bug.
