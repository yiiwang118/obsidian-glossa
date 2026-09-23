# Screenshots

Release screenshots for the Obsidian community submission live here.

Recommended captures before each public release:

- `sidebar.png` — main chat, streaming response, reasoning/process grouping.
- `agent.png` — approval modal and agent tool progress.
- `settings.png` — provider, permission, and security settings.
- `mcp.png` — MCP configuration or marketplace view.

Do not include API keys, private vault content, local paths, or provider account details.

## Custom API settings fixture

`custom-api-settings.png` and `custom-api-validation.png` render the production endpoint settings with a minimal Obsidian UI shim in Chromium. They verify the final URL preview, changing API formats, saving provider parameters, rejecting reserved fields without losing the last valid value, and clearing overrides. No model request or private vault is used; these are not native Obsidian screenshots.

With Playwright and Chrome already installed, run:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_PATH=/absolute/path/to/chrome \
node scripts/custom_api_settings_smoke.cjs
```

Both environment variables are optional when Playwright and its browser resolve normally. The script regenerates the two fixture screenshots.
