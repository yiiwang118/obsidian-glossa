# Popout menu and selection icon regression fixture

## Learning from corrections

`learning.cjs` uses the production learning modal, evaluator, storage, skill discovery, and skill invocation with a mocked Obsidian host and deterministic model. It covers saving an inactive draft, paired validation, invalidating edited drafts, explicit activation, revision provenance, history restore, disable, a 360-pixel layout, and cancelling an in-flight request by closing the modal. It uses no live API or real vault.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_PATH=/absolute/path/to/chrome \
node tests/ui/learning.cjs
```

Screenshots and results are written to `tests/.cache/learning`. Unit coverage in `tests/learning.test.cjs` additionally checks parser boundaries, output assertions, withheld answer keys, concurrency conflicts, corrupted storage, history limits, and feedback payload minimization.

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

## Model search and completed changes

`model_activity.cjs` exercises the production model picker, translation controller, activity labels, and changes card with mocked host APIs. It checks all 81 fixture models, cross-provider filtering, an empty result, stable menu placement, IME input, a secondary window, the translation menu's pointer/Escape layering, file-opening and undo callbacks, and a 360-pixel viewport.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_PATH=/absolute/path/to/chrome \
node tests/ui/model_activity.cjs
```

Screenshots and the verification record go to `tests/.cache/model-activity`. File restoration itself is covered separately by `tests/checkpoint_summary.test.cjs`, including stale contents, concurrent edits, same-turn aggregation, creation/deletion, single-file undo, and unsupported snapshots. The browser fixture does not send model requests or modify a real vault.

### Session controls and runtime workspace

`workspace.cjs` mounts the production `GlossaView`, history popover, task/queue controls and chat store with only host and provider boundaries mocked. It checks Plan/Act selection and busy locking; folder creation/moving/filtering; theme-resistant search focus; empty-result Escape; task persistence controls; editable queues; real view-to-agent-loop steering/follow-up delivery without overwriting drafts; bounded task continuation; and cancellation of pending approvals without Enter in the composer authorizing a write. Screenshots cover light, dark and 360px layouts. No credentials or live vault documents are used.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node tests/ui/workspace.cjs
```

Output: `tests/.cache/workspace/` (ignored). Local CLI protocol tests in `tests/local_cli.test.cjs` use an isolated executable fixture to verify split JSON lines, permissions, stdin and cancellation without a network call.

The workspace harness also checks three-part runtime/provider/model controls to the right of compact file references, API provider scoping and remembered model choices, manual effort input and resets, Grok selection, chrome rebuilds, CLI model search, per-model effort filtering and reset, remembered API/CLI choices, metadata caching and retry, cancellation during provider switches, busy locks, and narrow light/dark layouts. Model metadata is stubbed; protocol integration uses temporary executable fixtures in `cli_catalog.test.cjs`.

Grok integration fixtures in `tests/grok_cli.test.cjs` check native message events, private prompt-file permissions and cleanup on success, failed login, early exit and cancellation. Live metadata checks can run without a chat turn; a signed-in CLI is required for a real Grok response.
