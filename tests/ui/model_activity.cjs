#!/usr/bin/env node
// Production popup, translation controller and edit-summary UI; mocked host/provider only.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.UI_SCREENSHOT_DIR || path.join(root, 'tests/.cache/model-activity');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      export { Popup } from './src/ui/popup';
      export { modelPickerItems, modelPickerOptions } from './src/ui/model_picker';
      export { renderEditSummary } from './src/ui/edit_summary';
      export { summarizeToolActivity } from './src/utils/tool_activity';
      export { SelectionTranslationController } from './src/features/selection_translation';
      export { setLanguage } from './src/utils/i18n';` },
    bundle: true, write: false, format: 'iife', globalName: 'Fixture', platform: 'browser',
    plugins: [{ name: 'host-stubs', setup(b) {
      b.onResolve({ filter: /^obsidian$|providers\/(registry|custom_api)$|context\/sources$|utils\/(markdown|notice)$/ }, args => ({ path: args.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
        export class TFile {} export class TFolder {} export class MarkdownView {} export class Menu {} export class CustomApiProvider {}
        export function getAllTags() { return []; }
        export function loadPdfJs() { throw new Error('No PDF requests in this fixture'); }
        export function requestUrl() { throw new Error('No network requests in this fixture'); }
        export function getCurrentSelection() { return null; }
        export function buildProvider() { throw new Error('No live requests in this fixture'); }
        export function quickNotice() {}
        export function hasMarkdownMath() { return false; }
        export function renderInto() {}
        export function trimIncompleteMath(text) { return text; }
      ` }));
    } }],
  });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 760 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent('<!doctype html><body><h1>Glossa · 模型与执行结果</h1><p>Browser fixture · production UI with mocked host APIs</p><button id="models">模型</button><div class="glossa-view" id="summary"></div></body>');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8') + `
      :root { --background-primary: #fff; --background-secondary: #f6f7fa; --text-normal: #202534; --text-muted: #64748b; --text-faint: #8491a5; --text-error: #c63838; --background-modifier-border: #dce2ed; --nc-border: #dce2ed; --interactive-accent: #6756dc; --font-interface: system-ui; }
      body { font: 14px/1.5 system-ui; padding: 24px; margin: 0; color: var(--text-normal); background: var(--background-primary); }
      h1 { font-size: 23px; } #models { position: fixed; right: 24px; bottom: 32px; }
      #summary { width: 420px; max-width: 100%; margin-top: 24px; }
      button, input { font: inherit; } button { cursor: pointer; }
    `;
    await page.addStyleTag({ content: styles });
    await page.addScriptTag({ content: `
      window.installHost = win => {
        win.createEl = tag => win.document.createElement(tag);
        win.HTMLElement.prototype.createEl = function(tag) { return this.appendChild(this.ownerDocument.createElement(tag)); };
        win.HTMLElement.prototype.empty = function() { this.replaceChildren(); };
        win.HTMLElement.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
      };
      installHost(window); window.activeDocument = document; window.activeWindow = window;
    ` });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      Fixture.setLanguage('zh');
      window.endpoints = [
        { id: 'research', kind: 'custom-api', label: 'Research', model: 'model-60', availableModels: Array.from({ length: 80 }, (_, i) => 'model-' + i) },
        { id: 'writing', kind: 'custom-api', label: 'Writing', model: 'writer-fixture', availableModels: ['writer-fixture'] },
      ];
      window.picker = new Fixture.Popup();
      window.chosen = null;
      document.getElementById('models').onclick = () => picker.show(document.getElementById('models'), Fixture.modelPickerItems(endpoints, 'research', 'model-60', (endpoint, model) => { chosen = [endpoint.id, model]; }), Fixture.modelPickerOptions());
    });
    await page.locator('#models').click();
    const search = page.getByRole('combobox');
    await search.waitFor({ state: 'visible' });
    assert.equal(await page.locator('.nc-popup-item').count(), 81);
    const originalBox = await page.locator('.nc-popup').boundingBox();
    await search.fill('RESEARCH model-79');
    assert.equal(await page.locator('.nc-popup-item').count(), 1);
    assert.deepEqual(await page.locator('.nc-popup').boundingBox(), originalBox, 'filtering keeps menu placement and size stable');
    await search.press('Enter');
    assert.deepEqual(await page.evaluate(() => chosen), ['research', 'model-79']);

    await page.locator('#models').click();
    await search.fill('no-matching-model');
    assert.equal(await page.getByRole('status').textContent(), '没有匹配的模型');
    await search.press('Enter');
    assert.equal(await page.locator('.nc-popup').count(), 1, 'empty result does not execute another action');
    await search.press('Escape');
    assert.equal(await page.locator('#models').evaluate(node => node === document.activeElement), true);

    // The translation panel must survive search clicks and the first Escape.
    await page.evaluate(() => {
      window.host = { settings: { endpoints, activeEndpointId: 'research', selectionTranslateMode: 'button' }, getDecryptedEndpoint: async () => null, saveSettings: async () => {} };
      window.translation = new Fixture.SelectionTranslationController(host);
      translation.openPopup({ text: 'Read this selected sentence.', source: 'pdf' }, 'Chinese', { left: 200, top: 160, right: 500, bottom: 185, width: 300, height: 25 }, []);
    });
    await page.locator('.nc-selection-translation-model').click();
    await search.click();
    await search.fill('model-79');
    assert.equal(await page.locator('.nc-selection-translation-popover').count(), 1);
    await search.press('Enter');
    await page.waitForFunction(() => host.settings.translationModel === 'model-79');
    assert.equal(await page.locator('.nc-selection-translation-model').textContent(), 'model-79');
    await page.locator('.nc-selection-translation-model').click();
    await search.press('Escape');
    assert.equal(await page.locator('.nc-popup').count(), 0);
    assert.equal(await page.locator('.nc-selection-translation-popover').count(), 1, 'first Escape only closes model menu');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.nc-selection-translation-popover').count(), 0);

    await page.evaluate(() => {
      window.undoCalls = []; window.openCalls = [];
      window.checkpoint = { sessionId: 'fixture', turnId: 'turn', takenAt: Date.now(), snapshots: [
        { path: 'Research/Paper notes.md', after: { change: { kind: 'modified', adds: 8, dels: 3 } } },
        { path: 'Research/实验摘要.md', after: { change: { kind: 'created', adds: 12, dels: 0 } } },
        { path: 'Archive/Old notes.md', after: { change: { kind: 'deleted', adds: 0, dels: 4 } } },
      ] };
      const activity = document.createElement('p');
      activity.textContent = Fixture.summarizeToolActivity([
        { id: '1', name: 'read_files', args: { requests: [{ path: 'A.md' }, { path: 'B.md' }] }, status: 'success' },
        { id: '2', name: 'web_search', args: {}, status: 'success' },
        { id: '3', name: 'write_note', args: { path: 'Research/Paper notes.md' }, status: 'success' },
      ]);
      document.getElementById('summary').appendChild(activity);
      Fixture.renderEditSummary(document.getElementById('summary'), checkpoint, { busy: () => false, open: path => openCalls.push(path), undo: async paths => { undoCalls.push(paths ?? 'all'); } });
    });
    assert.match(await page.locator('.nc-edit-summary').textContent(), /本轮修改 · 3 个文件/);
    await page.getByRole('button', { name: 'Research/Paper notes.md', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => openCalls), ['Research/Paper notes.md']);
    await page.locator('.nc-edit-summary-file').first().getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => undoCalls), [['Research/Paper notes.md']]);
    await page.getByRole('button', { name: '撤销全部', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => undoCalls), [['Research/Paper notes.md'], 'all']);
    await page.locator('#models').click();
    await search.fill('writing');
    await page.screenshot({ path: path.join(output, 'model-search-and-changes.png') });
    await search.press('Escape');
    await page.setViewportSize({ width: 360, height: 780 });
    assert.equal(await page.locator('.nc-edit-summary').evaluate(node => node.scrollWidth <= node.clientWidth), true, 'narrow summary has no horizontal overflow');
    await page.locator('#models').click();
    await page.waitForFunction(() => document.querySelector('.nc-popup')?.style.left);
    const narrow = await page.locator('.nc-popup').boundingBox();
    await page.screenshot({ path: path.join(output, 'narrow-model-search.png') });
    assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 360 && narrow.y >= 0 && narrow.y + narrow.height <= 780, JSON.stringify(narrow));
    await search.press('Escape');

    // Same production picker in a separate document, including IME key handling.
    const opened = page.waitForEvent('popup');
    await page.evaluate(() => { window.child = window.open('about:blank', 'model-fixture', 'width=500,height=500'); });
    const child = await opened;
    await child.setContent('<body><button id="models">Models</button></body>');
    await child.addStyleTag({ content: styles });
    await page.evaluate(() => {
      installHost(child);
      picker.show(child.document.getElementById('models'), Fixture.modelPickerItems(endpoints, 'research', 'model-60', (endpoint, model) => { chosen = [endpoint.id, model]; }), Fixture.modelPickerOptions());
    });
    const childSearch = child.getByRole('combobox');
    await childSearch.fill('writer');
    await childSearch.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    assert.equal(await child.locator('.nc-popup').count(), 1, 'IME confirmation does not select a model');
    await childSearch.press('Enter');
    assert.deepEqual(await page.evaluate(() => chosen), ['writing', 'writer-fixture']);
    assert.equal(await child.locator('.nc-popup').count(), 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: await browser.version(), checks: ['81 models', 'search and empty results', 'stable geometry', 'translation menu event layering', 'single-file and all-file actions', 'narrow layout', 'popout and IME'], limitation: 'Mocked Obsidian APIs; no live model or native Windows host' }, null, 2));
    console.log('Model and activity UI checks passed: ' + output);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
