/* Browser smoke test of the production settings renderer with a minimal Obsidian UI shim.
 * PLAYWRIGHT_MODULE and CHROME_PATH may point to an existing local installation. */
const path = require('path');
const assert = require('assert/strict');
const esbuild = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

const shim = `
export class App {}
export class Notice {}
export class Modal {}
export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
class TextComponent {
  constructor(parent, tag) { this.inputEl = parent.createEl(tag); }
  setValue(value) { this.inputEl.value = value; return this; }
  setPlaceholder(value) { this.inputEl.placeholder = value; return this; }
  onChange(callback) { this.inputEl.addEventListener('input', () => callback(this.inputEl.value)); return this; }
}
class ButtonComponent {
  constructor(parent) { this.buttonEl = parent.createEl('button'); }
  setButtonText(text) { this.buttonEl.textContent = text; return this; }
  setDisabled(value) { this.buttonEl.disabled = value; return this; }
  setDestructive() { return this; }
  onClick(callback) { this.buttonEl.addEventListener('click', callback); return this; }
}
export class Setting {
  constructor(parent) {
    this.settingEl = parent.createDiv({ cls: 'setting-item' });
    const info = this.settingEl.createDiv({ cls: 'setting-item-info' });
    this.nameEl = info.createDiv({ cls: 'setting-item-name' });
    this.descEl = info.createDiv({ cls: 'setting-item-description' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
  }
  setName(text) { this.nameEl.textContent = text; return this; }
  setDesc(text) { this.descEl.textContent = text; return this; }
  addText(callback) { callback(new TextComponent(this.controlEl, 'input')); return this; }
  addTextArea(callback) { callback(new TextComponent(this.controlEl, 'textarea')); return this; }
  addButton(callback) { callback(new ButtonComponent(this.controlEl)); return this; }
  addToggle(callback) {
    const input = this.controlEl.createEl('input', { type: 'checkbox' });
    callback({ setValue(value) { input.checked = value; return this; }, onChange(fn) { input.onchange = () => fn(input.checked); return this; } });
    return this;
  }
}
export async function requestUrl() { throw new Error('Network calls are disabled in this harness.'); }
`;

(async () => {
  const bundle = await esbuild.build({
    stdin: { contents: `import { GlossaSettingTab } from './src/settings'; import { setLanguage } from './src/utils/i18n'; window.SettingsHarness = { GlossaSettingTab, setLanguage };`, resolveDir: root },
    bundle: true, format: 'iife', write: false,
    plugins: [{ name: 'host-shim', setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'shim' }));
      build.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: shim }));
      const unrelated = {
        './agent/skills': 'export const discoverSkills = () => [];',
        './agent/skill_validation': 'export const validateSkillDefinition = () => ({});',
        './ui/capability_catalog': 'export const buildToolCapabilities = () => []; export const BUNDLED_SKILL_ZH = {}; export const TOOL_CATEGORY_COPY = {}; export const TOOL_CATEGORY_ORDER = [];',
        './features/inline_completion_settings': 'export const renderInlineCompletionSettings = () => {};',
      };
      build.onResolve({ filter: /^\.\/(agent|ui|features)\// }, args => unrelated[args.path] ? ({ path: args.path, namespace: 'unrelated' }) : undefined);
      build.onLoad({ filter: /.*/, namespace: 'unrelated' }, args => ({ contents: unrelated[args.path] }));
    } }],
  });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html><body class="theme-light"><h1>Custom API settings</h1><p>Production Glossa renderer · mocked Obsidian host · no network calls</p><main></main></body></html>');
    await page.addStyleTag({ content: `body{font:15px system-ui;color:#272833;background:#f7f8fb;margin:32px;--text-normal:#272833;--text-muted:#667085;--text-faint:#98a2b3;--background-primary:#fff;--background-secondary:#f3f4f6;--background-modifier-border:#ddd;--interactive-accent:#7055df;--radius-s:6px;--radius-m:10px;} main{max-width:1080px}.setting-item{display:flex;padding:12px 0;gap:20px;border-bottom:1px solid #eee}.setting-item-info{flex:1}.setting-item-description{color:#667085;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.setting-item-control{display:flex;align-items:center;gap:8px;width:390px}input,textarea,button{font:inherit;border:1px solid #ccd0d9;border-radius:6px;padding:8px;background:white;color:#272833}input:not([type=checkbox]),textarea{width:100%;box-sizing:border-box}textarea{font:13px monospace}summary{cursor:pointer}[aria-invalid=true]{border-color:#c63d3d}[role=status]{color:#b32424}h1{margin:0}` });
    await page.addStyleTag({ path: path.join(root, 'styles.css') });
    await page.evaluate(() => {
      window.activeDocument = document;
      window.activeWindow = window;
      window.createEl = tag => document.createElement(tag);
      HTMLElement.prototype.createEl = function(tag, options = {}) {
        const el = this.ownerDocument.createElement(tag);
        if (options.cls) el.className = options.cls;
        if (options.text) el.textContent = options.text;
        if (options.type) el.type = options.type;
        for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
        this.appendChild(el); return el;
      };
      HTMLElement.prototype.createDiv = function(options) { return this.createEl('div', options); };
      HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', options); };
      HTMLElement.prototype.setText = function(text) { this.textContent = text; };
      HTMLElement.prototype.empty = function() { this.replaceChildren(); };
      HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
      HTMLElement.prototype.removeClass = function(...names) { this.classList.remove(...names); };
      HTMLElement.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const endpoint = { id: 'demo', label: 'MiniMax', kind: 'custom-api', apiStyle: 'anthropic', baseUrl: 'https://api.minimax.io/anthropic', model: 'MiniMax-M3', extraBody: { thinking: { type: 'disabled' } } };
      window.endpoint = endpoint;
      window.saved = [];
      const plugin = { settings: { endpoints: [endpoint] }, saveSettings: async () => window.saved.push(JSON.parse(JSON.stringify(endpoint))) };
      const tab = new window.SettingsHarness.GlossaSettingTab({}, plugin);
      tab.renderEndpointCard(document.querySelector('main'), endpoint);
      document.querySelectorAll('details').forEach(el => { el.open = true; });
    });
    const setting = name => page.locator('.setting-item').filter({ has: page.locator('.setting-item-name', { hasText: new RegExp(`^${name}$`) }) });
    assert.match(await setting('Request URL').innerText(), /anthropic\/v1\/messages/);
    await setting('Base URL').locator('input').fill('https://api.minimax.io/anthropic/v1/');
    assert.match(await setting('Request URL').innerText(), /anthropic\/v1\/messages/);
    await setting('API format').locator('button').click();
    await page.getByRole('option', { name: 'OpenAI-compatible' }).click();
    assert.match(await setting('Request URL').innerText(), /anthropic\/v1\/chat\/completions/);
    await setting('API format').locator('button').click();
    await page.getByRole('option', { name: 'Anthropic-style' }).click();
    await setting('Base URL').locator('input').fill('https://api.minimax.io/anthropic');
    assert.match(await setting('Request URL').innerText(), /anthropic\/v1\/messages/);
    const extra = setting('Extra JSON body').locator('textarea');
    await extra.fill('{"thinking":{"type":"disabled"},"reasoning_split":true}');
    assert.equal(await page.evaluate(() => window.endpoint.extraBody.reasoning_split), true);
    const output = path.join(root, 'docs/screenshots/custom-api-settings.png');
    await page.screenshot({ path: output, fullPage: true });
    await extra.fill('{"stream":true}');
    assert.equal(await extra.getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => window.endpoint.extraBody.reasoning_split), true);
    await page.screenshot({ path: path.join(root, 'docs/screenshots/custom-api-validation.png'), fullPage: true });
    await extra.fill('');
    assert.deepEqual(await page.evaluate(() => window.endpoint.extraBody), {});
    assert.deepEqual(errors, []);
    console.log('Custom API settings browser smoke passed: URL, persistence, invalid-input retention, clear.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
