#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../..');
const output=path.join(root,'tests/.cache/workspace');
async function main(){
 fs.mkdirSync(output,{recursive:true});
 const bundle=await build({stdin:{resolveDir:root,contents:`export { GlossaView } from './src/ui/view'; export { renderHistoryPopover } from './src/ui/history_modal'; export { renderSessionControls } from './src/ui/session_controls'; export { DEFAULT_SETTINGS } from './src/types'; export { setLanguage } from './src/utils/i18n'; export { ChatStore } from './src/chat_store'; export { FileSystemAdapter } from 'obsidian';`},bundle:true,write:false,platform:'browser',format:'iife',globalName:'Fixture',plugins:[{name:'host',setup(b){
  b.onResolve({filter:/^obsidian$|providers\/(registry|local_cli|custom_api)$|utils\/markdown$/},a=>({path:a.path,namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`
  export class ItemView { constructor(leaf){this.app=leaf.app;this.containerEl=leaf.containerEl;} registerEvent(){} registerDomEvent(){} }
  export class WorkspaceLeaf {} export class FileView {} export class MarkdownView {} export class TFile {} export class TFolder {} export class FileSystemAdapter { getBasePath(){return '/fixture';} }
  export class App {} export class Component {} export class Notice { constructor(text){window.notices.push(text);} }
  export class Modal {constructor(app){this.app=app;this.modalEl=document.body.createDiv({cls:'modal'});this.contentEl=this.modalEl.createDiv();}open(){this.onOpen?.();}close(){this.onClose?.();this.modalEl.remove();}}
  export class Menu {items=[]; addItem(cb){const item={title:'',disabled:false,setTitle(t){this.title=t;return this;},setIcon(){return this;},setChecked(){return this;},setWarning(){return this;},setDisabled(v){this.disabled=v;return this;},onClick(fn){this.action=fn;return this;}};cb(item);this.items.push(item);return this;}addSeparator(){}showAtMouseEvent(){this.show();}showAtPosition(){this.show();}show(){document.querySelector('.host-menu')?.remove();const host=document.body.createDiv({cls:'host-menu menu'});for(const item of this.items){const btn=host.createEl('button',{text:item.title});btn.disabled=item.disabled;btn.onclick=()=>{host.remove();item.action?.();};}}}
  export class CustomApiProvider {} export function buildProvider(){return window.fixtureProvider;} export function supportsNativePdfInput(){return false;} export async function findLocalCli(){return '/fixture/codex';}
  export async function discoverLocalCliModels(ep,cwd,proxy,signal){window.cliDiscoveryCalls.push(ep.kind);if(window.catalogFailure)throw Error('fixture discovery failure');if(window.deferCatalog)await new Promise(resolve=>window.releaseCatalog=resolve);if(signal?.aborted)throw Error('cancelled');return ep.kind==='grok-cli'?[{id:'grok-fixture',label:'Grok Fixture',efforts:['low','high','xhigh']}]:ep.kind==='codex-cli'?[{id:'codex-deep',label:'Codex Deep',efforts:['low','high','xhigh']},{id:'codex-fast',label:'Codex Fast',efforts:['low','high']}]:[{id:'opus',resolvedModel:'claude-opus-fixture',label:'Opus',efforts:['low','high','max']},{id:'haiku',resolvedModel:'claude-haiku-fixture',label:'Haiku',efforts:[]}];}
  export const Platform={isDesktopApp:true,isWin:false}; export function getAllTags(){return [];} export function prepareSimpleSearch(){return null;} export function normalizePath(p){return p;} export function getFrontMatterInfo(){return {exists:false};} export function parseYaml(){return {};} export function stringifyYaml(){return '';} export function requestUrl(){throw Error('No live network');} export function loadPdfJs(){throw Error('No PDF');} export const Keymap={isModEvent:()=>false}; export class MarkdownRenderer{};
  export async function renderInto(_app,text,host){host.textContent=text;}export function decorateCodeBlocks(){}export function trimIncompleteMath(t){return t;}export function hasMarkdownMath(){return false;}
  `}));
 }}]});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 try {
 const page=await browser.newPage({viewport:{width:1000,height:850},deviceScaleFactor:1});
 page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('UI error:',e.message);});
 await page.setContent('<html><body><main id="workspace"><aside id="chat"></aside></main></body></html>');
 const theme=`:root{--background-primary:#fff;--background-secondary:#f6f7f9;--background-secondary-alt:#f6f7f9;--text-normal:#252a35;--text-muted:#747d8d;--text-faint:#9ca3ae;--text-error:#d34646;--text-accent:#7464dc;--interactive-accent:#7464dc;--background-modifier-border:#e0e4eb;--background-modifier-hover:#eef0f6;--font-interface:system-ui;--font-text:system-ui;}body.theme-dark{--background-primary:#202226;--background-secondary:#282b30;--background-secondary-alt:#282b30;--text-normal:#e6e9ee;--text-muted:#a7aeba;--text-faint:#717986;--background-modifier-border:#3a3f48;--background-modifier-hover:#323842;}body{margin:0;font:14px/1.5 system-ui;background:var(--background-secondary);color:var(--text-normal);}#workspace{width:440px;height:830px;margin:10px auto;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:14px;overflow:hidden;}#chat{height:100%;}button,input,textarea{font:inherit;color:var(--text-normal);}button{background:var(--background-secondary);border:1px solid #333;border-radius:5px;cursor:pointer;}input[type=text]:focus,textarea:focus{border:4px solid #333;outline:2px solid #333;box-shadow:0 0 0 2px #333;} .host-menu{position:fixed;top:100px;right:20px;padding:8px;background:var(--background-primary);border:1px solid var(--background-modifier-border);z-index:9999;display:flex;flex-direction:column;gap:5px;} .modal{position:fixed;inset:100px 20%;background:var(--background-primary);border:1px solid var(--background-modifier-border);z-index:9999;padding:20px;} .modal label{display:block;}.modal textarea{display:block;}`;
 await page.addStyleTag({content:theme});
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 await page.addScriptTag({content:`window.notices=[];window.activeDocument=document;window.activeWindow=window;Object.defineProperty(Document.prototype,'win',{get(){return this.defaultView;}});window.createEl=(tag,o={})=>{const el=document.createElement(tag);if(o.cls)el.className=o.cls;if(o.text)el.textContent=o.text;if(o.type)el.type=o.type;for(const[k,v]of Object.entries(o.attr||{}))el.setAttribute(k,v);return el;};window.createDiv=o=>createEl('div',o);HTMLElement.prototype.createEl=function(tag,o={}){return this.appendChild(this.ownerDocument.win.createEl(tag,o));};HTMLElement.prototype.createDiv=function(o){return this.createEl('div',o);};HTMLElement.prototype.createSpan=function(o){return this.createEl('span',o);};HTMLElement.prototype.empty=function(){this.replaceChildren();};HTMLElement.prototype.addClass=function(...c){this.classList.add(...c);};HTMLElement.prototype.toggleClass=function(c,b){this.classList.toggle(c,b);};HTMLElement.prototype.setAttr=function(k,v){this.setAttribute(k,v);};HTMLElement.prototype.removeClass=function(...c){this.classList.remove(...c);};HTMLElement.prototype.setCssStyles=function(s){Object.assign(this.style,s);};HTMLElement.prototype.setCssProps=function(s){for(const[k,v]of Object.entries(s))this.style.setProperty(k,v);};HTMLElement.prototype.appendText=function(s){this.appendChild(this.ownerDocument.createTextNode(s));};HTMLElement.prototype.setText=function(s){this.textContent=s;};HTMLElement.prototype.instanceOf=function(c){return this instanceof c;};`});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(async()=>{
  Fixture.setLanguage('zh');
  const data=new Map();const adapter={exists:async p=>data.has(p),read:async p=>data.get(p),write:async(p,v)=>data.set(p,v),rename:async(a,b)=>{data.set(b,data.get(a));data.delete(a);},list:async()=>({files:[],folders:[]}),remove:async p=>data.delete(p)};
  const app={vault:{adapter,getName:()=> 'Test',getAbstractFileByPath:()=>null},workspace:{getActiveFile:()=>null,getActiveViewOfType:()=>null,activeLeaf:null,on:()=>{},onLayoutReady:()=>{},getLeavesOfType:()=>[]},metadataCache:{}};
  const containerEl=document.getElementById('chat');containerEl.createDiv();containerEl.createDiv();
  window.plugin={app,manifest:{dir:'.obsidian/plugins/glossa',version:'0.8.0'},settings:{...Fixture.DEFAULT_SETTINGS,endpoints:[{id:'api',kind:'custom-api',label:'DeepSeek',model:'fixture',availableModels:['fixture','fixture-plus']},{id:'api-two',kind:'custom-api',label:'OpenAI',model:'other-one',availableModels:['other-one','other-two']}],activeEndpointId:'api',runMode:'plan'},saveSettings:async()=>view.refreshFromSettings(),getDecryptedEndpoint:async ep=>ep};
  plugin.store=new Fixture.ChatStore(plugin);await plugin.store.load();
  for(let i=1;i<=6;i++)await plugin.store.saveSession({id:'chat'+i,title:['论文阅读与研究笔记','翻译：神经科学综述','旅行计划','每周工作整理','项目架构讨论','读书摘要'][i-1],messages:[{id:'u'+i,role:'user',content:'Test conversation '+i,timestamp:Date.now()}],createdAt:Date.now(),updatedAt:Date.now()-i*3600000,mode:'chat',endpointId:'api'});
  window.view=new Fixture.GlossaView({app,containerEl},plugin);await view.onOpen();
  // No active documents or live network in this test vault fixture.
 });
 await page.getByRole('button',{name:'Act mode',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Act mode',exact:true}).getAttribute('aria-pressed'),'true');
 const mode=await page.locator('.nc-mode-seg').evaluate(n=>({before:getComputedStyle(n,'::before').display,heights:[...n.children].map(b=>b.getBoundingClientRect().height)}));
 assert.equal(mode.before,'none');assert.deepEqual(mode.heights,[24,24]);
 await page.getByRole('button',{name:'历史对话',exact:true}).click();
 await page.getByRole('button',{name:'新建目录',exact:true}).click();
 await page.getByRole('textbox',{name:'目录名称'}).fill('研究');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.getByRole('button',{name:/全部对话/}).click();
 await page.getByRole('button',{name:'对话操作'}).first().click();
 await page.getByRole('button',{name:'移动到目录…',exact:true}).click();
 await page.getByRole('button',{name:'研究',exact:true}).click();
 await page.getByRole('button',{name:'研究 · 1',exact:true}).click();
 assert.equal(await page.locator('.nc-history-pop-row').count(),1);
 const search=page.locator('.nc-history-pop-search-input');await search.focus();
 const focus=await search.evaluate(n=>({border:getComputedStyle(n).borderWidth,shadow:getComputedStyle(n).boxShadow,outline:getComputedStyle(n).outlineStyle}));
 assert.deepEqual(focus,{border:'0px',shadow:'none',outline:'none'});
 await page.screenshot({path:path.join(output,'history-light.png')});
 await search.fill('absent');await page.waitForTimeout(150);await search.press('Escape');
 await page.locator('.nc-history-pop').waitFor({state:'detached'});assert.equal(await page.locator('.nc-history-pop').count(),0,'Escape closes empty search results');
 await page.getByRole('button',{name:'创建持续任务',exact:true}).click();
 await page.locator('.nc-goal-modal textarea').fill('整理研究笔记，核对来源并生成摘要');
 await page.getByRole('button',{name:'创建任务',exact:true}).click();
 assert.match(await page.locator('.nc-goal-card').textContent(),/已暂停/);
 await page.evaluate(()=>{view.streaming=true;view.updateSubmitBtn();view.inputEl.value='请先核对引用再继续';view.queueComposer();});
 assert.equal(await page.getByRole('button',{name:'Act mode',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByRole('textbox',{name:'编辑待发送消息'}).fill('只整理本周新增的笔记');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 assert.match(await page.locator('.nc-inbox').textContent(),/只整理本周/);
 await page.screenshot({path:path.join(output,'workspace-light.png')});
 await page.evaluate(()=>{document.body.classList.add('theme-dark');});
 await page.waitForTimeout(500);await page.screenshot({path:path.join(output,'workspace-dark.png')});
 await page.setViewportSize({width:360,height:780});
 await page.addStyleTag({content:'#workspace{width:358px;height:778px;margin:0;border-radius:0;}'});
 await page.screenshot({path:path.join(output,'workspace-narrow.png')});
 fs.writeFileSync(path.join(output,'computed.json'),JSON.stringify(await page.evaluate(()=>Object.fromEntries(['.nc-input-wrap','.nc-example-chip','.nc-input-footer','.nc-submit-btn'].map(sel=>{const n=document.querySelector(sel),s=getComputedStyle(n);return [sel,{bg:s.background,bgPrimary:s.getPropertyValue('--background-primary'),filter:s.filter,opacity:s.opacity,rect:n.getBoundingClientRect().toJSON(),animation:s.animation}];}))),null,2));

 await page.evaluate(()=>{
   view.cancelStream();view.streaming=false;view.submitInFlight=false;view.session.inbox=[];view.session.goal=undefined;view.renderSessionControls();view.updateSubmitBtn();
   view.buildSystemPrompt=async()=> 'Test system prompt';view.hydrateCurrentContextForPrompt=async()=>{};view.refreshEditSummaries=async()=>{};
   plugin.settings.autoCompactEnabled=false;plugin.settings.loadProjectContext=false;
   window.requests=[];let calls=0;
   window.fixtureProvider={id:'fixture',displayName:'Fixture',defaultModel:()=>'',isAvailable:async()=>true,async *stream(req){
     requests.push(JSON.parse(JSON.stringify(req)));calls++;
     if(calls===1){await new Promise(resolve=>window.releaseFirst=resolve);yield {type:'tool_call',id:'read',name:'read_note',args:{path:'Missing.md'}};}
     else yield {type:'text',text:'Fixture response '+calls};
     yield {type:'final',text:'',usage:{input:10,output:3}};
   }};
   view.inputEl.value='Read the fixture';window.runPromise=view.submit();
 });
 await page.waitForFunction(()=>window.releaseFirst);
 await page.evaluate(()=>{view.queueKind='steer';view.inputEl.value='Correction for next step';view.queueComposer();view.queueKind='followup';view.inputEl.value='Queued next turn';view.queueComposer();view.inputEl.value='Unsent draft';releaseFirst();});
 await page.waitForFunction(()=>requests.length===3&&!view.submitInFlight);
 const queued=await page.evaluate(()=>({requests:requests.map(r=>r.messages),draft:view.inputEl.value,inbox:view.session.inbox}));
 assert(queued.requests[1].some(m=>m.role==='user'&&m.content==='Correction for next step'));
 assert(queued.requests[2].some(m=>m.role==='user'&&m.content.includes('Queued next turn')));
 assert.equal(queued.draft,'Unsent draft');assert.equal(queued.inbox.length,0);
 await page.evaluate(()=>{
   window.goalCalls=0;
   fixtureProvider.stream=async function*(req){goalCalls++;const prior=req.messages.at(-1);if(prior.role==='tool'){yield {type:'text',text:'Progress saved'};}else{yield {type:'tool_call',id:'goal-'+goalCalls,name:'task_status',args:{phase:'active',progress:'Completed a bounded fixture step'}};}yield {type:'final',text:''};};
   view.session.goal={objective:'Bounded fixture task',phase:'paused',progress:'',rounds:0,maxRounds:2,updatedAt:Date.now()};view.renderSessionControls();
 });
 await page.getByRole('button',{name:'继续',exact:true}).click();
 await page.waitForFunction(()=>view.session.goal.rounds===2&&!view.submitInFlight);
 assert.equal(await page.evaluate(()=>view.session.goal.phase),'paused');assert.equal(await page.evaluate(()=>goalCalls),4,'two goal rounds, each with a status tool and final reply');
 await page.evaluate(()=>{view.session.goal=undefined;view.renderSessionControls();view.startNewSession();});

 await page.evaluate(()=>{
   view.abortCtl=new AbortController();view.streaming=true;view.updateSubmitBtn();
   window.approvalDone=false;
   view.askInlineApproval({spec:{name:'write_note',description:'test',parameters:{}},dangerous:true,describe:()=> 'fixture write',run:async()=>''},{}).then(result=>{window.approvalResult=result;window.approvalDone=true;});
 });
 await page.locator('.nc-inline-approval').waitFor();
 await page.locator('.nc-input').fill('A correction, not an approval');await page.locator('.nc-input').press('Enter');
 assert.equal(await page.evaluate(()=>approvalDone),false,'typing Enter never approves a pending write');
 await page.evaluate(()=>view.cancelStream());
 await page.waitForFunction(()=>approvalDone);
 assert.equal(await page.evaluate(()=>approvalResult.ok),false,'Stop releases pending approval without approving');
 assert.equal(await page.locator('.nc-inline-approval').count(),0);
 await page.evaluate(()=>{view.streaming=false;view.updateSubmitBtn();});
 const overflows=await page.evaluate(()=>[...document.querySelectorAll('.nc-header,.nc-input-footer,.nc-session-controls')].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.className));
 assert.deepEqual(overflows,[],'header, controls and composer fit narrow sidebar');

 await page.evaluate(()=>view.ctx.updateCurrent({id:'current-file',kind:'file',label:'Cascade Speculative Drafting for Even Faster LLM Inference',detail:'Research/Cascade Speculative Drafting.pdf',content:'Fixture note',tokens:10,isCurrent:true}));
 assert.equal(await page.locator('.nc-context-group.current .nc-context-group-label').count(),0,'current file has no redundant Current label');
 assert.equal(await page.locator('.nc-model-choice .nc-model-chip').count(),1,'API model belongs to the third segment');
 await page.waitForTimeout(350);
 const fileRow=await page.evaluate(()=>{const r=document.querySelector('.nc-runtime-bar').getBoundingClientRect(),p=document.querySelector('.nc-context-group.current .nc-pill').getBoundingClientRect();return {sameRow:Math.abs((r.top+r.bottom)-(p.top+p.bottom))<4,short:p.width<=130,left:p.right<r.left,compact:r.width<=290,r:r.toJSON(),p:p.toJSON()};});
 assert(fileRow.sameRow&&fileRow.short&&fileRow.left&&fileRow.compact,'compact selector sits to the right of the file: '+JSON.stringify(fileRow));
 await page.screenshot({path:path.join(output,'composer-api-file.png')});
 assert.equal(await page.locator('.nc-runtime-bar > *').count(),3,'runtime, provider and model form three segments');
 assert.equal(await page.locator('.nc-input-footer .nc-model-chip').count(),0,'no model control at the bottom');
 await page.locator('.nc-api-provider-button').click();await page.getByRole('option',{name:'OpenAI',exact:true}).click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().id),'api-two');
 await page.locator('.nc-model-chip').click();
 const apiModels=await page.locator('.nc-popup-item').allTextContents();
 assert(apiModels.some(s=>s.includes('other-two'))&&!apiModels.some(s=>s==='fixture'),'third segment lists only selected provider models');
 await page.getByRole('option',{name:'other-two',exact:true}).click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().model),'other-two');
 await page.locator('.nc-api-provider-button').click();await page.getByRole('option',{name:'DeepSeek',exact:true}).click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().model),'fixture','switching provider retains its selected model');
 await page.evaluate(()=>{view.streaming=true;view.updateSubmitBtn();});
 assert(await page.locator('.nc-api-provider-button').isDisabled(),'provider selection locks during execution');
 await page.evaluate(()=>{view.streaming=false;view.updateSubmitBtn();});
 // Exercise composer runtime controls with production view logic and catalog fixtures.
 await page.evaluate(()=>{Object.setPrototypeOf(plugin.app.vault.adapter,Fixture.FileSystemAdapter.prototype);window.cliDiscoveryCalls=[];view.session.inbox=[];view.renderSessionControls();view.inputEl.value='Unsent CLI draft';});
 const runtime=page.getByRole('button',{name:'切换运行方式',exact:true});
 assert.equal(await runtime.evaluate(n=>!!n.closest('.nc-input-wrap')),true,'runtime belongs to the composer');
 assert.equal(await page.locator('.nc-header .nc-runtime-button,.nc-input-footer .nc-runtime-button').count(),0);
 assert(await runtime.evaluate(n=>n.parentElement.getBoundingClientRect().bottom<=document.querySelector('.nc-input').getBoundingClientRect().top),'runtime has its own row above the message input');
 await runtime.click();await page.getByRole('option',{name:'本机 CLI',exact:true}).click();
 await page.waitForFunction(()=>plugin.settings.endpoints.find(e=>e.kind==='codex-cli')?.cliModels?.length===2);
 assert.equal(await page.locator('.nc-model-choice .nc-model-chip').count(),1,'CLI model remains in third segment');
 assert.equal(await page.locator('.nc-input-footer .nc-model-chip').count(),0,'CLI has no separate bottom model control');
 assert.equal(await page.locator('.nc-cli-provider-button svg').count(),1,'selected provider uses its brand vector');
 await page.locator('.nc-model-chip').click();await page.getByRole('option',{name:'Codex Deep',exact:true}).click();
 assert.equal(await page.locator('.nc-model-label').textContent(),'Codex Deep');
 assert(await page.locator('.nc-model-label').isVisible(),'CLI model name remains visible in a narrow sidebar');
 await page.locator('.nc-reasoning-pill').click();
 const effortRows=await page.locator('.nc-popup-item').allTextContents();
 assert(effortRows.some(s=>s.includes('xhigh')));assert(!effortRows.some(s=>s.includes('max')));
 await page.locator('.nc-popup-item').filter({hasText:'xhigh'}).click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().reasoningEffort),'xhigh');
 await page.locator('.nc-model-chip').click();await page.getByRole('option',{name:'Codex Fast',exact:true}).click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().reasoningEffort),'off','model switch clears unsupported effort');
 await page.getByRole('button',{name:'CLI 提供方：Codex',exact:true}).click();
 await page.screenshot({path:path.join(output,'cli-provider-menu.png')});
 await page.getByRole('option',{name:'Claude Code',exact:true}).click();
 await page.waitForFunction(()=>view.activeEndpoint().kind==='claude-code-cli'&&view.activeEndpoint().cliModels?.length===2);
 await page.locator('.nc-model-chip').click();
 await page.getByRole('combobox',{name:'搜索模型或服务商…'}).fill('opus');
 await page.getByRole('option',{name:'claude-opus-fixture, opus',exact:true}).click();
 await page.locator('.nc-reasoning-pill').click();
 assert(!(await page.locator('.nc-popup-item').allTextContents()).some(s=>s.includes('xhigh')));
 await page.locator('.nc-popup-item').filter({hasText:'max'}).click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().reasoningEffort),'max');
 await page.screenshot({path:path.join(output,'cli-narrow-dark.png')});
 const cliOverflows=await page.evaluate(()=>[...document.querySelectorAll('.nc-header,.nc-composer-context-row,.nc-runtime-bar,.nc-runtime-choice,.nc-input-footer')].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.className));
 assert.deepEqual(cliOverflows,[],'CLI provider and model controls fit narrow sidebar');
 await page.evaluate(()=>{document.body.classList.remove('theme-dark');});
 await page.locator('.nc-model-chip').click();await page.screenshot({path:path.join(output,'cli-model-menu.png')});await page.keyboard.press('Escape');
 await runtime.click();await page.getByRole('option',{name:'API 助手',exact:true}).click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().id),'api','return restores prior API endpoint');
 assert.equal(await page.locator('.nc-cli-provider-button').isVisible(),false);
 assert.equal(await page.locator('.nc-input').inputValue(),'Unsent CLI draft','runtime switch retains composer draft');
 await runtime.click();await page.getByRole('option',{name:'本机 CLI',exact:true}).click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().model),'opus','CLI runtime returns to last provider and model');
 assert.equal(await page.evaluate(()=>view.activeEndpoint().reasoningEffort),'max','CLI effort survives API round trip');
 assert.deepEqual(await page.evaluate(()=>cliDiscoveryCalls),['codex-cli','claude-code-cli'],'cached catalogs avoid repeated subprocesses on settings save');
 await page.evaluate(()=>{view.streaming=true;view.updateSubmitBtn();});
 assert(await runtime.isDisabled());assert(await page.locator('.nc-cli-provider-button').isDisabled());assert(await page.locator('.nc-model-chip').isDisabled());assert(await page.locator('.nc-reasoning-pill').isDisabled());
 await page.evaluate(()=>{view.streaming=false;view.updateSubmitBtn();window.catalogFailure=true;});
 await page.locator('.nc-model-chip').click();await page.getByRole('option',{name:'刷新模型列表',exact:true}).click();
 await page.waitForFunction(()=>view.cliCatalogErrors.size===1);
 assert.equal(await page.evaluate(()=>view.activeEndpoint().cliModels.length),2,'failed refresh retains last successful model list');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{window.catalogFailure=false;window.deferCatalog=true;window.refreshPromise=view.refreshCliCatalog(view.activeEndpoint(),true);});
 await page.waitForFunction(()=>window.releaseCatalog);
 await runtime.click();await page.getByRole('option',{name:'API 助手',exact:true}).click();
 await page.evaluate(async()=>{releaseCatalog();await refreshPromise;});
 assert.equal(await page.evaluate(()=>view.activeEndpoint().id),'api','late cancelled catalog never switches the active runtime');
 await page.evaluate(()=>{window.deferCatalog=false;});
 await runtime.click();await page.getByRole('option',{name:'本机 CLI',exact:true}).click();
 await page.locator('.nc-cli-provider-button').click();await page.getByRole('option',{name:'Grok',exact:true}).click();
 await page.waitForFunction(()=>view.activeEndpoint().cliModels?.[0]?.id==='grok-fixture');
 await page.locator('.nc-model-chip').click();await page.getByRole('option',{name:'Grok Fixture',exact:true}).click();
 assert.equal(await page.locator('.nc-runtime-choice .nc-cli-provider-button').textContent(),'Grok▾');
 await page.locator('.nc-reasoning-pill').click();await page.getByRole('option',{name:'自定义 effort…',exact:true}).click();
 const effortInput=page.locator('.nc-effort-modal input');
 await effortInput.fill('bad value');await page.locator('.nc-effort-modal button[type=submit]').click();
 assert.equal(await effortInput.getAttribute('aria-invalid'),'true','invalid manual values stay unsaved');
 await effortInput.fill('deep');await page.locator('.nc-effort-modal button[type=submit]').click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().customReasoningEffort),'deep');
 await page.evaluate(()=>view.rebuildChrome());
 assert.equal(await page.locator('.nc-model-chip').count(),1,'chrome rebuild never duplicates a model control');
 assert.equal(await page.locator('.nc-reasoning-pill .nc-pill-sub').textContent(),'deep','manual effort survives rebuild');
 assert.equal(await page.locator('.nc-context-group.current .nc-pill').count(),1,'file survives chrome rebuild');
 await page.waitForTimeout(350);
 await page.screenshot({path:path.join(output,'composer-grok-file.png')});
 await page.locator('.nc-reasoning-pill').click();await page.locator('.nc-popup-item').filter({hasText:'xhigh'}).click();
 assert.equal(await page.evaluate(()=>view.activeEndpoint().customReasoningEffort),undefined,'preset clears manual override');
 await runtime.click();await page.getByRole('option',{name:'API 助手',exact:true}).click();
 await page.evaluate(()=>view.rebuildChrome());
 assert.equal(await page.locator('.nc-model-chip').count(),1,'API rebuild never duplicates a model control');
 assert.equal(await page.locator('.nc-model-choice .nc-model-chip').count(),1);
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({browser:await browser.version(),checks:'Plan/Act, busy lock, folder creation/move/filter, empty search Escape, single focus ring, goal card, editable queue, light/dark/narrow layouts',errors},null,2));
 console.log('Workspace UI passed: '+output);
 } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
