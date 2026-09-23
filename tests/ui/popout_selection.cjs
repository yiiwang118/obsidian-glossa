#!/usr/bin/env node
// Browser evidence harness; no vault, credentials, or live model requests.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node tests/ui/popout_selection.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { build, transformSync } = require('esbuild');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.UI_SCREENSHOT_DIR || path.join(root, 'tests/.cache/popout-selection');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const result = await build({
    stdin: {
      contents: `export { Popup } from './src/ui/popup';
        export { setTrustedSvg } from './src/utils/dom';
        export { ICON } from './src/ui/icons';
        export { SelectionTranslationController } from './src/features/selection_translation';`,
      resolveDir: root,
    },
    bundle: true, write: false, format: 'iife', globalName: 'GlossaFixture', platform: 'browser',
    plugins: [{ name: 'host-boundary-stubs', setup(build) {
      build.onResolve({ filter: /^(obsidian)$|providers\/(registry|custom_api)$|context\/sources$|utils\/(markdown|notice)$/ }, args => ({ path: args.path, namespace: 'host-stub' }));
      build.onLoad({ filter: /.*/, namespace: 'host-stub' }, () => ({ contents: `
        export class Menu {};
        export class CustomApiProvider {};
        export function getCurrentSelection() { return null; }
        export function buildProvider() { throw new Error('No live requests in UI fixture'); }
        export function quickNotice() {}
        export function hasMarkdownMath() { return false; }
        export function renderInto() {}
        export function trimIncompleteMath(text) { return text; }
      ` }));
    } }],
  });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
    await page.setContent('<!doctype html><html><body><h1>Obsidian main window fixture</h1><p>The settings menu belongs to the separate settings document.</p></body></html>');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
    const theme = `:root { --background-primary: #fff; --background-secondary: #f5f6fa; --text-normal: #202534; --text-muted: #64748b; --text-faint: #8491a5; --background-modifier-border: #dce2ed; --interactive-accent: #6756dc; --background-modifier-hover: #edf0fa; --font-interface: Arial; }
      body { font: 15px/1.5 Arial, sans-serif; margin: 0; padding: 32px; color: #202534; background: #f6f7fb; }
      h1 { font-size: 23px; margin: 0 0 12px; } h2 { font-size: 18px; }
      .fixture-tag { font-size: 12px; color: #64748b; letter-spacing: .04em; text-transform: uppercase; }
      .fixture-card { margin-top: 28px; padding: 24px; border: 1px solid #dce2ed; border-radius: 12px; background: white; }
      .fixture-note { color: #64748b; font-size: 13px; }
      .nc-popup { z-index: 2000; }
      .nc-selection-translation-action { animation: none; }
      button { font: inherit; }
      .paper { margin-top: 24px; padding: 42px; background: white; border: 1px solid #dce2ed; font: 20px/1.9 Georgia,serif; }
      mark { color: inherit; background: #bcd4ff; }
    `;
    await page.addScriptTag({ content: `window.installHostDom = function(win) {
      win.HTMLElement.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
      win.HTMLElement.prototype.createEl = function(tag) { return this.appendChild(this.ownerDocument.createElement(tag)); };
      win.createEl = tag => win.document.createElement(tag);
    }; installHostDom(window); window.activeDocument = document; window.activeWindow = window;` });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.addStyleTag({ content: styles + theme });
    const opened = page.waitForEvent('popup');
    await page.evaluate(() => { window.settingsFixture = window.open('about:blank', 'glossa-settings-fixture', 'width=640,height=520'); });
    const settings = await opened;
    await settings.setViewportSize({ width: 640, height: 520 });
    await settings.setContent('<!doctype html><html><body><div class="fixture-tag">Chromium UI fixture · separate window</div><h1>Glossa · Models &amp; web</h1><p class="fixture-note">The model picker is owned by this settings document.</p><section class="fixture-card"><h2>Detected models</h2><button class="nc-aligned-select" id="models" aria-haspopup="listbox">MiniMax-M2.7-highspeed ▾</button></section><p class="fixture-note">Regression checks: owner document, local viewport, keyboard selection, outside click, close and reopen.</p></body></html>');
    await settings.addStyleTag({ content: styles + theme });
    await page.evaluate(() => {
      const win = window.settingsFixture;
      installHostDom(win);
      const anchor = win.document.getElementById('models');
      window.menu = new GlossaFixture.Popup();
      window.items = ['MiniMax-M2.7-highspeed', 'MiniMax-M3'].map(label => ({ label, checked: label === 'MiniMax-M2.7-highspeed', onSelect() { window.selected = label; } }));
      // activeDocument and activeWindow deliberately still point at the main window.
      menu.show(anchor, items);
    });
    await settings.waitForFunction(() => document.querySelector('.nc-popup')?.style.top);
    assert.equal(await page.locator('.nc-popup').count(), 0);
    assert.equal(await settings.locator('.nc-popup').count(), 1);
    await settings.screenshot({ path: path.join(output, 'popout-model-menu.png') });
    await settings.keyboard.press('ArrowDown');
    await settings.keyboard.press('ArrowDown');
    await settings.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.selected), 'MiniMax-M3');
    assert.equal(await page.evaluate(() => menu.isOpen()), false);
    await page.evaluate(() => menu.show(settingsFixture.document.getElementById('models'), items));
    await settings.locator('h1').click();
    assert.equal(await page.evaluate(() => menu.isOpen()), false);
    await page.evaluate(() => { menu.show(settingsFixture.document.getElementById('models'), items); menu.destroy(); });
    assert.equal(await settings.locator('.nc-popup').count(), 0);

    await page.setContent('<!doctype html><html><body><div class="fixture-tag">Chromium UI fixture · selection action</div><h1>PDF selection · Glossa translation</h1><p class="fixture-note">A hidden copy of the same brand icon precedes the action button.</p><div id="hidden-brand" style="display:none"></div><div class="paper">Language connects ideas across disciplines.<br><mark id="selection">Translate the selected passage.</mark><br>The action icon remains visible after remounting.</div><p class="fixture-note">Uses the production SelectionTranslationController and SVG renderer. PDF text and host APIs are fixtures.</p></body></html>');
    await page.addStyleTag({ content: styles + theme });
    const renderState = await page.evaluate(() => {
      const { setTrustedSvg, ICON, SelectionTranslationController } = GlossaFixture;
      setTrustedSvg(document.getElementById('hidden-brand'), ICON.bot);
      const controller = new SelectionTranslationController({ settings: {}, app: {} });
      const rect = document.getElementById('selection').getBoundingClientRect();
      const geometry = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      controller.showSelectionAction(geometry, [geometry], 'fixture', false);
      const oldAction = document.querySelector('.nc-selection-translation-action');
      const previousId = oldAction.querySelector('[id]').id;
      controller.hideSelectionAction();
      controller.showSelectionAction(geometry, [geometry], 'fixture', false);
      const action = document.querySelector('.nc-selection-translation-action');
      const gradient = action.querySelector('[id]');
      const hiddenGradient = document.querySelector('#hidden-brand [id]');
      window.fixtureController = controller;
      return { count: action.querySelectorAll('svg').length, gradientId: gradient.id, hiddenId: hiddenGradient.id, previousId,
        reference: action.querySelector('g[stroke]').getAttribute('stroke'), oldConnected: oldAction.isConnected,
        ownGradient: document.getElementById(gradient.id) === gradient };
    });
    assert.equal(renderState.count, 1);
    assert.equal(renderState.oldConnected, false);
    assert.equal(renderState.ownGradient, true);
    assert.notEqual(renderState.gradientId, renderState.hiddenId);
    assert.notEqual(renderState.gradientId, renderState.previousId);
    assert.equal(renderState.reference, `url(#${renderState.gradientId})`);
    await page.screenshot({ path: path.join(output, 'selection-action-remounted.png') });
    await page.locator('.nc-selection-translation-action').screenshot({ path: path.join(output, 'selection-action-detail.png') });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: await browser.version(), platform: os.platform(), popout: 'passed', selection: renderState, limitations: 'Chromium fixture, not native Obsidian/PDF.js end-to-end verification' }, null, 2));
    if (process.env.UI_BASELINE_REF) {
      const source = execFileSync('git', ['show', `${process.env.UI_BASELINE_REF}:src/utils/dom.ts`], { cwd: root, encoding: 'utf8' });
      const legacy = transformSync(source, { loader: 'ts', format: 'iife', globalName: 'LegacyDom' }).code;
      await page.setViewportSize({ width: 540, height: 220 });
      await page.setContent('<body style="font:16px Arial;background:#f7f8fc;padding:20px"><div style="display:none" id="hidden"></div><p id="label"></p><button id="action" style="background:white;border:2px solid #7ca5f4;border-radius:7px;width:72px;height:72px;padding:8px"></button></body>');
      await page.addScriptTag({ content: legacy });
      await page.evaluate(() => {
        LegacyDom.setTrustedSvg(document.getElementById('hidden'), GlossaFixture.ICON.bot);
        LegacyDom.setTrustedSvg(document.getElementById('action'), GlossaFixture.ICON.bot);
        document.getElementById('label').textContent = 'Baseline: hidden duplicate gradient ID';
      });
      await page.screenshot({ path: path.join(output, 'selection-icon-baseline.png') });
      await page.evaluate(() => {
        GlossaFixture.setTrustedSvg(document.getElementById('action'), GlossaFixture.ICON.bot);
        document.getElementById('label').textContent = 'Fixed: independent gradient reference';
      });
      await page.screenshot({ path: path.join(output, 'selection-icon-fixed.png') });
    }
    console.log(`Browser regression checks passed. Screenshots: ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
