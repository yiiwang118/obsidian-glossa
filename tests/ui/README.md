# Popout menu and selection icon regression fixture

`popout_selection.cjs` bundles the production `Popup`, `SelectionTranslationController`, and SVG helper. Only Obsidian/provider boundaries are stubbed; no vault or model API is accessed. It uses a real secondary Chromium window while `activeDocument` / `activeWindow` remain on the primary window, then exercises selection action removal and recreation with an earlier hidden brand SVG.

Run after installing the repository dependencies, with Playwright and Chromium already available:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_PATH=/absolute/path/to/chrome \
UI_BASELINE_REF=39301f3a321f6ac66860eb8366831c61e16624c1 \
node tests/ui/popout_selection.cjs
```

`PLAYWRIGHT_MODULE` and `CHROME_PATH` are optional if Playwright and its managed browser resolve normally. `UI_BASELINE_REF` optionally renders the old SVG helper from that Git revision next to the fixed result. Output goes to `tests/.cache/popout-selection`; `UI_SCREENSHOT_DIR` can override it. Browser automation is optional and separate from `npm test`, which runs the deterministic document/listener and SVG-reference regression tests without browser dependencies.

Verified with Chrome 152.0.7977.83 on macOS. The committed screenshots in `docs/screenshots/popout-selection/` show:

- `popout-model-menu.png`: menu mounted and positioned in the trigger's secondary document, with keyboard selection, outside dismissal, and destroy checks.
- `selection-action-remounted.png`: actual selection controller button after removal and recreation, with a distinct local gradient reference.
- `selection-icon-baseline.png` / `selection-icon-fixed.png`: the baseline helper produces an empty button when an earlier SVG with the same gradient ID is hidden; the fixed helper paints the icon under the same conditions.

These are Chromium fixtures, not native Obsidian 1.13.7 or PDF.js end-to-end verification. The PDF passage and host APIs are fixtures; testing selection capture in a real vault and macOS native window focus remains a manual follow-up.
