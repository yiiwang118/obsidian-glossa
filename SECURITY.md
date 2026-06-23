# Security Policy

## Supported versions

Only the latest minor version receives security fixes. As of this writing:

| Version | Supported |
|---|---|
| 0.4.1   | ✅ |
| 0.4.0   | ❌ (please upgrade) |
| 0.3.x   | ❌ (please upgrade) |
| < 0.3   | ❌ |

## Reporting a vulnerability

**Please do NOT file a public GitHub issue for security problems.** Instead use one of:

- **Preferred**: [GitHub Security Advisories](https://github.com/yiiwang118/obsidian-glossa/security/advisories/new) — encrypted, gives me a private channel to acknowledge and patch before disclosure.
- Email: `str.wangy@gmail.com` with subject `[glossa-security]`.

Expected response time: within 5 business days for an initial reply. A fix and coordinated disclosure timeline will be agreed within 14 days for critical issues.

## Scope

The following are explicitly in scope:

- **Path traversal** in any vault tool (`view_image`, `read_note`, `file_edit`, etc.) — anything that lets the model escape the vault directory
- **API-key leakage** — keys appearing in error messages, logs, telemetry, audit logs, devtools output, or persistence files outside their encrypted form
- **MCP child env leakage** — any non-LLM secret that escapes the env allowlist into a third-party MCP server process
- **Approval bypass** — any way for the model to invoke a `dangerous: true` tool without hitting the approval modal or matching a persisted rule
- **Permission rule confusion** — MCP namespace patterns that match more than the user intended
- **SSRF / DNS rebinding** in `web_fetch`, `@url` mentions, or the proxy override path
- **Marketplace command injection** — external MCP catalog entries that auto-spawn destructive commands without user confirmation
- **Crypto correctness** — IV reuse, weak KDF, verifier tampering, plaintext fallback when locked
- **Atomic write races** — situations where `chats.json` / `embeddings.json` / `checkpoints.json` can be silently corrupted

Out of scope:

- Vulnerabilities in upstream packages (`obsidian`, `esbuild`, etc.) — report those to their maintainers
- Issues that require physical access to the user's machine
- Provider-side issues (rate-limiting bypass, etc.) — these belong with the provider

## Hardening already in place

For attackers reading this: yes, we know. Recent audit findings already addressed (see [CHANGELOG.md](CHANGELOG.md) 0.4.0):

- `view_image` path validation
- `assertVaultPath` URL-decoding to block `..%2F` traversal
- `checkpoint.snapshot` write mutex (FIFO queue) to prevent read-modify-write races
- `chats.json` / `embeddings.json` / `checkpoints.json` atomic write via tmp+rename
- MCP child env strips `OPENAI_*` / `ANTHROPIC_*` keys
- AES-GCM-256 with PBKDF2 (200k iterations) for at-rest API-key encryption

## Bounty

Glossa is a one-person free open-source project. **No monetary bounty** is offered. Reporters of valid issues will be credited in the changelog and security advisory unless they request anonymity.
