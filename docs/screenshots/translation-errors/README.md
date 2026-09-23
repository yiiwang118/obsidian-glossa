# Selection translation error UI evidence

These screenshots run the production `SelectionTranslationController.openPopup`,
`runTranslation`, and `showError` with the repository's `styles.css` in Chromium.
The Obsidian DOM helpers, host settings, and provider response are mocked. They do
not demonstrate native Obsidian/PDF.js behavior or a live MiniMax request.

- `thinking-budget-error.png`: a final response with `stopReason: max_tokens`,
  `hasReasoning: true`, and no text shows the thinking-budget explanation.
- `partial-translation-error.png`: a text chunk followed by `max_tokens` shows
  the incomplete-translation explanation. The error and Retry button persist
  after pending animation frames, instead of being overwritten by stale text.

Both use the actual MiniMax M2.7-highspeed selection budget (16,384). The fixture
contains no API keys or reasoning text. Captured with Chrome 152.0.7977.83 on macOS.

Reproduce with Playwright and Chrome already installed:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROME_PATH=/path/to/chrome \
node tests/ui/translation_error.cjs
```

Fresh screenshots and the browser-check result are written to the ignored
`tests/.cache/translation-error` directory. Set `UI_SCREENSHOT_DIR` to choose
another output directory.
