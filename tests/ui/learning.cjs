#!/usr/bin/env node
// Real learning UI, storage, discovery and evaluation; only host/model boundaries mocked.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'tests/.cache/learning');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const bundle = await build({
    stdin: { resolveDir: root, contents: `export { openLearningModal } from './src/ui/learning_modal'; export { discoverSkills } from './src/agent/skills'; export { skillTool } from './src/agent/tools/skill'; export { setLanguage } from './src/utils/i18n';` },
    bundle: true, write: false, format: 'iife', globalName: 'Fixture', platform: 'browser',
    plugins: [{ name: 'host', setup(b) {
      b.onResolve({ filter: /^obsidian$|providers\/registry$|\.\/confirm_modal$/ }, args => ({ path: args.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
        export class TFile {} export class TFolder {}
        export class Modal {
          constructor(app) { this.app = app; this.modalEl = activeDocument.createElement('div'); this.modalEl.className = 'modal'; this.modalEl.setAttribute('role', 'dialog'); this.contentEl = this.modalEl.createDiv({cls:'modal-content'}); }
          open() { activeDocument.body.appendChild(this.modalEl); this.onOpen(); }
          close() { this.onClose(); this.modalEl.remove(); }
        }
        export function buildProvider() { return window.fixtureProvider; }
        export async function confirmModal() { return true; }
      ` }));
    } }],
  });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 980, height: 900 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent('<!doctype html><body></body>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') + `
      :root { --background-primary:#fff; --background-secondary:#f5f6f8; --background-modifier-border:#dce1e8; --text-normal:#242932; --text-muted:#627083; --text-error:#b53340; --font-ui-small:13px; }
      body { font:14px/1.5 system-ui; background:#e8ebf2; margin:0; padding:20px; color:var(--text-normal); }
      .modal { margin:0 auto; background:white; border-radius:14px; padding:20px; box-sizing:border-box; } .modal-content { max-height:80vh; } h2 { margin-top:0; font-size:22px; }
      input, textarea, select, button { font:inherit; padding:7px; border:1px solid #dce1e8; border-radius:5px; } button { cursor:pointer; } button:disabled { opacity:.4; cursor:default; } .mod-cta { background:#6552cf; color:white; }
    ` });
    await page.addScriptTag({ content: `
      window.installHost = win => {
        const p = win.HTMLElement.prototype;
        p.createEl = function(tag, opts = {}) { const n = this.ownerDocument.createElement(tag); if (opts.text !== undefined) n.textContent = opts.text; if (opts.cls) n.className = opts.cls; if (opts.type) n.type = opts.type; if (opts.value !== undefined) n.value = opts.value; for (const [k,v] of Object.entries(opts.attr || {})) n.setAttribute(k,v); this.appendChild(n); return n; };
        p.createDiv = function(opts) { return this.createEl('div',opts); }; p.createSpan = function(opts) { return this.createEl('span',opts); };
        p.empty = function() { this.replaceChildren(); }; p.addClass = function(cls) { this.classList.add(cls); }; p.removeClass = function(cls) { this.classList.remove(cls); }; p.setText = function(text) { this.textContent = text; };
      }; installHost(window); window.activeDocument = document;
      window.files = new Map(); window.calls = []; window.stall = false; window.aborted = false; window.cleanup = [];
      window.skill = { name:'paper-notes', title:'论文笔记整理', description:'保留原有 YAML 和摘要，将新来源追加到引用区，避免覆盖已经整理好的论文笔记内容。', whenToUse:'当用户要求整理论文笔记时使用。', body:'# Goal\\n整理论文笔记。\\n# Workflow\\n保留 YAML 和原摘要，将来源追加到引用区。\\n# Guardrails\\n不覆盖原文。\\n# Done when\\n原字段和摘要完整保留。', examples:[
        {name:'保留论文甲',request:'整理论文甲',input:'---\\ntitle: 论文甲\\n---\\n原摘要甲',shouldTrigger:true,includes:['title: 论文甲','原摘要甲'],excludes:[]},
        {name:'保留论文乙',request:'整理论文乙',input:'原摘要乙',shouldTrigger:true,includes:['原摘要乙'],excludes:[]},
        {name:'不干扰计算',request:'只输出 2+2 的结果',input:'',shouldTrigger:false,includes:['4'],excludes:['引用']}
      ]};
      window.fixtureProvider = { async *stream(req) {
        calls.push(req);
        if (stall) { await new Promise(resolve => req.signal.addEventListener('abort', () => { aborted = true; resolve(); }, {once:true})); return; }
        if (req.messages[0].content.startsWith('Create one narrow')) { yield {type:'final',text:JSON.stringify(skill)}; return; }
        const task = JSON.parse(req.messages[1].content); const hasSkill = !req.messages[0].content.endsWith('(none)');
        yield {type:'final',text:JSON.stringify({applySkill:hasSkill && !!task.input, output:task.input ? (hasSkill ? task.input : '摘要已重写') : '4'}),usage:{input:120,output:25}};
      }};
      window.plugin = {app:{vault:{getAbstractFileByPath:()=>null,adapter:{
        exists:async p=>files.has(p),read:async p=>files.get(p),write:async(p,text)=>{files.set(p,text);},mkdir:async p=>{files.set(p,'');},remove:async p=>{files.delete(p);},rename:async(a,b)=>{files.set(b,files.get(a));files.delete(a);}
      }}},settings:{activeEndpointId:'api',endpoints:[{id:'api',kind:'custom-api',model:'fixture-model'}],globalProxy:''},getDecryptedEndpoint:async e=>e,register:fn=>cleanup.push(fn)};
    ` });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => { Fixture.setLanguage('zh'); Fixture.openLearningModal(plugin, { context:'用户：保留摘要。\\n助手：已重写。',source:{sessionId:'s',turnId:'t',messageId:'m',model:'original-model',tools:[]} }); });
    await page.getByLabel('下次应该怎么做？').fill('保留 YAML 和原来的摘要，把来源追加到引用区。');
    await page.getByRole('button', { name:'生成草稿',exact:true }).click();
    await page.getByLabel('操作步骤').waitFor();
    assert.equal(await page.getByRole('button', { name:'启用此版本' }).isEnabled(), false);
    await page.getByRole('button', { name:'保存草稿',exact:true }).click();
    await page.getByText('草稿已保存，尚未启用。').waitFor();
    assert.equal(await page.evaluate(async () => (await Fixture.discoverSkills(plugin.app)).length), 0);
    await page.getByText('版本历史（1）', {exact:true}).click();
    await page.getByRole('button', { name:'作为草稿编辑',exact:true }).click();
    await page.getByRole('button', { name:'验证样例（6 次调用）',exact:true }).click();
    await page.getByText('样例已通过。检查结果后可以启用技能。').waitFor();
    assert.equal(await page.getByRole('button', { name:'启用此版本' }).isEnabled(), true);
    assert.equal(await page.evaluate(() => calls.length), 7);
    await page.getByLabel('标题', {exact:true}).fill('论文笔记整理与引用');
    assert.equal(await page.getByRole('button', { name:'启用此版本' }).isEnabled(), false, 'editing a validated draft disables activation');
    await page.getByRole('button', { name:'验证样例（6 次调用）',exact:true }).click();
    await page.getByText('样例通过：1 → 3 / 3', {exact:true}).waitFor();
    await page.getByText('与当前启用版本的差异', {exact:true}).click();
    await page.getByRole('button', {name:'启用此版本'}).scrollIntoViewIfNeeded();
    await page.screenshot({ path:path.join(output,'learning-validation.png') });
    await page.getByRole('button', {name:'启用此版本'}).click();
    await page.getByText('技能已启用，将用于后续对话。').waitFor();
    const first = await page.evaluate(async () => {
      const skills = await Fixture.discoverSkills(plugin.app);
      const run = await Fixture.skillTool.run(plugin.app,{skill:'paper-notes'});
      return {skills,run};
    });
    assert.equal(first.skills.length, 1);
    assert.equal(first.run.skillVersion, first.skills[0].learningVersion);
    assert.ok(first.run.text.includes('保留 YAML'));
    await page.getByRole('button', {name:'继续改进',exact:true}).click();
    await page.getByLabel('下次应该怎么做？').fill('引用区还需要带上页码。');
    await page.getByLabel('操作步骤').fill(first.skills[0].body + '\n引用带页码。');
    await page.getByRole('button', {name:'验证样例（6 次调用）',exact:true}).click();
    await page.getByText('这些样例未显示通过率提升。').waitFor();
    await page.getByRole('button', {name:'启用此版本'}).click();
    await page.getByText('技能已启用，将用于后续对话。').waitFor();
    assert.ok(await page.evaluate(async () => (await Fixture.discoverSkills(plugin.app))[0].body.endsWith('引用带页码。')));
    await page.getByText('版本历史（3）', {exact:true}).click();
    await page.getByRole('button', {name:'恢复此版本',exact:true}).click();
    await page.getByRole('button', {name:'停用',exact:true}).waitFor();
    assert.equal(await page.evaluate(async () => (await Fixture.discoverSkills(plugin.app))[0].learningVersion), first.skills[0].learningVersion);
    await page.getByRole('button', {name:'停用',exact:true}).click();
    await page.getByText('paper-notes · 已停用 / 草稿', {exact:true}).waitFor();
    assert.equal(await page.evaluate(async () => (await Fixture.discoverSkills(plugin.app)).length), 0);
    await page.setViewportSize({width:360,height:780});
    await page.screenshot({path:path.join(output,'learning-history-narrow.png')});
    assert.ok(await page.locator('.modal').evaluate(node => node.scrollWidth <= node.clientWidth), 'narrow modal does not overflow horizontally');
    await page.getByRole('button', {name:'记录新纠正',exact:true}).click();
    await page.getByLabel('下次应该怎么做？').fill('Keep original headings');
    await page.evaluate(() => { stall = true; });
    await page.getByRole('button', {name:'生成草稿',exact:true}).click();
    await page.getByText('正在整理技能与验证样例…').waitFor();
    await page.getByRole('button', {name:'关闭',exact:true}).click();
    await page.waitForFunction(() => aborted);
    assert.equal(await page.getByRole('dialog').count(), 0, 'closing cancels the model request');
    await page.evaluate(() => { stall = false; Fixture.openLearningModal(plugin); });
    await page.getByRole('button', {name:'记录新纠正',exact:true}).waitFor();
    assert.equal(await page.evaluate(() => cleanup.length), 1, 'reopening does not retain a callback per closed dialog');
    await page.evaluate(() => cleanup[0]());
    assert.equal(await page.getByRole('dialog').count(), 0, 'plugin unload closes its remaining dialog');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output,'results.json'), JSON.stringify({passed:true,checks:['draft persistence','validation gate','fresh baseline comparisons','dirty draft invalidation','runtime skill invocation','revision provenance','restore','disable','narrow layout','cancellation']},null,2));
    console.log('Learning UI checks passed. Screenshots: ' + output);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
