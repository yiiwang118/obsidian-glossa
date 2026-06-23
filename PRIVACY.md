# Privacy & Data Flow

Glossa is a **local plugin**. There is no Glossa-controlled server, no telemetry, no analytics, no crash reporting. The plugin author cannot see what you type or any content of your vault.

What follows is a map of network calls, local subprocesses, and stored data.

## Outbound network calls

| When | Destination | Payload | Trigger | Avoidable? |
|---|---|---|---|---|
| You send a chat message | The LLM endpoint **you configured** | Full prompt: system prompt + history + attached context (file content of any `@` chips) + your current message | You press Enter | Yes — don't send the message |
| Streaming a response | Same as above | Server-Sent Events stream back; no extra outbound | Implicit when sending | — |
| Tool call (agent mode) | The LLM endpoint | Tool result text as the next user turn | Agent loop after a tool runs | Yes — switch to Plan mode (read-only) or run tools manually |
| `web_fetch` tool | The URL you / the model fetched | HTTP GET; standard `User-Agent` | Tool invocation; approval prompt | Yes — deny the approval |
| `@url` mention attaching a web page | That URL | HTTP GET | You typed an `@http...` reference | Yes — don't attach |
| **RAG index build** | The embedding endpoint **you configured** | **Every markdown file's content**, chunked, in batches of 32 | Manual "Rebuild embedding index" command | Yes — never trigger rebuild |
| RAG search at query time | Same embedding endpoint | Your query string only (1 round-trip per search) | A `semantic_search` tool call or any auto-RAG path | Yes — disable semantic_search or remove the embedding endpoint |
| MCP server child process | Wherever that MCP server connects | Depends entirely on the MCP server you installed | MCP-server-initiated | Yes — disable that MCP server |
| Endpoint connection test | The selected endpoint's own test target (`/models`, 1-token ping, or CLI `--version`) | API key or local CLI auth as required by that endpoint | You click "Test" / "Test active endpoint" in settings | Yes — don't click |
| MCP catalog refresh | Built-in or user-added HTTPS catalog URL | HTTP GET for a JSON catalog | You open / refresh MCP marketplace | Yes — don't use marketplace catalogs |

**The author of Glossa does not run any of these endpoints.** Glossa only calls configured provider URLs, embedding endpoints, MCP catalog URLs, public web URLs you attach / approve, and network destinations reached by MCP or local CLI tools you enabled.

## Local subprocesses and shell environment

Glossa is desktop-only because it can spawn local tools.

| When | Process | Environment / data | Trigger |
|---|---|---|---|
| Plugin startup | Your login shell (`$SHELL -lic env`) | Whitelisted variables only: proxy vars, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, locale, cert vars, `CODEX_HOME`, `XDG_CONFIG_HOME` | Plugin loads |
| Codex CLI endpoint | Local `codex` binary | Augmented `PATH`, `HOME`, proxy vars, and the whitelisted shell API-key/base-url vars so Codex can authenticate from Obsidian | You send a message / diagnose / test that Codex endpoint |
| Claude Code CLI endpoint | Local `claude` binary | Same local child-process environment behavior as Codex | You send a message / test that Claude endpoint |
| MCP server | User-configured command | Filtered allowlist env by default. LLM provider credentials are stripped unless you explicitly add them in that MCP server's env override | You enable that MCP server |

The startup shell snapshot is cached in memory. It is not written to disk by Glossa. Local CLI tools may read their own config files, auth files, and working directories according to their own behavior.

## Data stored locally

All paths are inside the user's vault under `.obsidian/plugins/glossa/`. None of this is synced unless your vault sync setup (Obsidian Sync, iCloud, Dropbox, …) explicitly includes `.obsidian/`.

| File | What's in it | Encrypted? |
|---|---|---|
| `data.json` | Settings, endpoint configs (incl. API keys) | API keys: opt-in via passphrase (Settings → Security). Other fields: plaintext. |
| `chats.json` | Every chat session: messages, tool events, reasoning, timestamps | Plaintext. |
| `embeddings.json` | Vector index — embeddings + raw chunk text for snippet display | Encrypted **only** if encryption is enabled. Otherwise plaintext mirror of indexed notes. |
| `checkpoints.json` | Pre-edit snapshots of files touched by destructive tools (7-day TTL, 200-entry cap) | Encrypted **only** if encryption is enabled. |
| `nested_skill_dirs.json` | Cached list of `.glossa/skills/` directories discovered in your vault | Plaintext (just paths). |
| `tool_outputs/*.txt` | Tool results that exceeded inline-size cap, persisted for the model to re-reference | Plaintext. |

If you turn encryption ON in Settings → Security, API keys and the four `.json` blobs above are sealed with AES-GCM-256, key derived from your passphrase via PBKDF2 (200 000 iterations). The key never leaves the WebCrypto layer — JavaScript sees only an opaque `CryptoKey` handle, which is dropped when you "lock" the plugin.

## What is *not* sent

- No usage analytics
- No crash reports
- No identifier of you, your machine, or your vault
- No content unless you explicitly send a message or build the embedding index
- PDF text extraction is local through Obsidian/PDF.js; extracted text is only sent if you attach it or the agent returns it to the LLM as tool context

## Provider-side privacy

Whatever you send to the LLM endpoint is subject to **that provider's** privacy policy, not Glossa's. Read theirs.

- OpenAI: <https://openai.com/policies/privacy-policy/>
- Anthropic: <https://www.anthropic.com/legal/privacy>
- DeepSeek / GLM / Qwen / others: check their respective policies

Some providers retain prompts for training by default. Disable training opt-in there if you care.

## A short list of opinionated defaults

- API keys default to **plaintext** in `data.json`. We recommend enabling encryption (Settings → Security) — but we do *not* force it, because losing the passphrase locks you out of your own keys.
- Embedding index build asks for **explicit consent** before the first upload. After consent, subsequent rebuilds are silent.
- New installs default to **Plan** + **read-only** mode. Raising permission to `workspace-write` or `full` is an explicit user action.
- The agent's `read-only` and `workspace-write` permission levels are designed so the LLM cannot run anything irreversible without you clicking "Approve" — even when auto-approve rules are configured, destructive tools never go through silently the first time.

## Questions

File a [discussion](https://github.com/yiiwang118/obsidian-glossa/discussions) — not an issue, since this isn't a bug.
