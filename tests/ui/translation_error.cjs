#!/usr/bin/env node
// Actual translation popup/controller in Chromium with mocked Obsidian DOM and provider.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node tests/ui/translation_error.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.UI_SCREENSHOT_DIR || path.join(root, 'tests/.cache/translation-error');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      export { SelectionTranslationController } from './src/features/selection_translation';
      export { setLanguage } from './src/utils/i18n';` },
    bundle: true, write: false, format: 'iife', globalName: 'GlossaFixture', platform: 'browser',
    plugins: [{ name: 'host-boundary-stubs', setup(build) {
      build.onResolve({ filter: /^(obsidian)$|providers\/(registry|custom_api)$|context\/sources$|utils\/(markdown|notice)$/ }, args => ({ path: args.path, namespace: 'host-stub' }));
      build.onLoad({ filter: /.*/, namespace: 'host-stub' }, () => ({ contents: `
        export class Menu {}
        export class CustomApiProvider {}
        export function getCurrentSelection() { return null; }
        export function buildProvider() { return { async *stream(request) {
          window.fixtureRequests.push(request);
          for (const chunk of window.fixtureChunks) yield chunk;
        } }; }
        export function quickNotice() {}
        export function hasMarkdownMath() { return false; }
        export function renderInto() {}
        export function trimIncompleteMath(text) { return text; }
      ` }));
    } }],
  });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1050, height: 690 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(5000);
    await page.setContent(`<!doctype html><html><body>
      <div class="fixture-tag">Chromium UI fixture · mocked Obsidian DOM and provider</div>
      <h1>PDF 选区翻译 · 思考预算耗尽</h1>
      <p class="fixture-note">真实 SelectionTranslationController 与插件样式；未连接真实 Obsidian 或 MiniMax API。</p>
      <div class="paper"><mark id="selection">Language connects ideas across disciplines.</mark></div>
      </body></html>`);
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') + `
      :root { --background-primary: #fff; --background-secondary: #f5f6fa; --text-normal: #202534; --text-muted: #64748b; --text-faint: #8491a5; --text-error: #c63838; --background-modifier-border: #dce2ed; --interactive-accent: #6756dc; --background-modifier-hover: #edf0fa; --font-interface: system-ui; --font-text: system-ui; }
      body { font: 15px/1.6 system-ui,sans-serif; margin: 0; padding: 32px; color: #202534; background: #f6f7fb; }
      h1 { font-size: 24px; margin: 10px 0; }
      .fixture-tag { font-size: 12px; color: #64748b; letter-spacing: .03em; }
      .fixture-note { color: #64748b; font-size: 13px; }
      .paper { margin-top: 30px; padding: 30px; background: white; border: 1px solid #dce2ed; font: 21px/1.8 Georgia,serif; }
      mark { color: inherit; background: #bcd4ff; }
      button { font: inherit; }
    ` });
    await page.addScriptTag({ content: `
      window.activeDocument = document; window.activeWindow = window;
      window.createEl = tag => document.createElement(tag);
      HTMLElement.prototype.empty = function() { this.replaceChildren(); };
      HTMLElement.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
      HTMLElement.prototype.createEl = function(tag) { return this.appendChild(document.createElement(tag)); };
      window.fixtureRequests = [];
    ` });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async () => {
      GlossaFixture.setLanguage('zh');
      const endpoint = { id: 'fixture', label: 'MiniMax', kind: 'custom-api', apiStyle: 'anthropic', model: 'MiniMax-M2.7-highspeed' };
      window.fixtureController = new GlossaFixture.SelectionTranslationController({
        settings: { endpoints: [endpoint], activeEndpointId: endpoint.id, globalProxy: '' },
        getDecryptedEndpoint: async () => endpoint,
      });
      window.fixtureSelection = { text: 'Language connects ideas across disciplines.', source: 'pdf' };
      const rect = document.getElementById('selection').getBoundingClientRect();
      fixtureController.openPopup(fixtureSelection, 'Chinese', rect, [rect]);
      window.fixtureChunks = [{ type: 'final', text: '', stopReason: 'max_tokens', hasReasoning: true }];
      await fixtureController.runTranslation(fixtureSelection, 'Chinese');
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(await page.locator('.nc-selection-translation-error').textContent(), /思考阶段达到输出上限/);
    assert.equal(await page.locator('.nc-selection-translation-popover.is-error').count(), 1);
    assert.equal(await page.locator('.nc-selection-translation-retry').textContent(), '重试');
    assert.equal(await page.evaluate(() => fixtureRequests[0].maxTokens), 16384);
    await page.screenshot({ path: path.join(output, 'thinking-budget-error.png') });

    await page.evaluate(async () => {
      window.fixtureChunks = [
        { type: 'text', text: '这是不完整的译文' },
        { type: 'final', text: '这是不完整的译文', stopReason: 'max_tokens', hasReasoning: true },
      ];
      await fixtureController.runTranslation(fixtureSelection, 'Chinese');
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(await page.locator('.nc-selection-translation-error').textContent(), /译文不完整/);
    assert.equal(await page.locator('.nc-selection-translation-popover.is-streaming').count(), 0);
    assert.equal(await page.locator('.nc-selection-translation-retry').count(), 1);
    await page.screenshot({ path: path.join(output, 'partial-translation-error.png') });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: await browser.version(), checks: 'thinking-only and partial-text truncation errors persist after animation frames', limitation: 'Mocked Obsidian DOM and provider; no native Obsidian/PDF.js or live MiniMax verification' }, null, 2));
    console.log(`Translation error browser checks passed. Screenshots: ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
