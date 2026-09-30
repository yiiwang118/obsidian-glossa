const path = require('path'), fs = require('fs'), os = require('os');
exports.run = async (t, load) => {
  const {parseCliModels, reconcileCliEffort, cliModelLabel} = await load(path.resolve(__dirname,'../src/providers/cli_catalog.ts'));
  const {reasoningOptionsForEndpoint} = await load(path.resolve(__dirname,'../src/types.ts'));
  const {cliArguments} = await load(path.resolve(__dirname,'../src/providers/cli_protocol.ts'));
  const {cliModelItems} = await load(path.resolve(__dirname,'../src/ui/cli_picker.ts'));
  const rows = [{model:'fast',displayName:'Fast',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'},{reasoningEffort:'injected'},{reasoningEffort:'low'}],defaultReasoningEffort:'low'}, {model:'hidden',hidden:true}, {model:'bad id'}, null];
  const models = parseCliModels('codex-cli', rows);
  t.eq(models.length,1,'hidden and malformed models omitted');
  t.eq(models[0].efforts,['low','high'],'only reported known effort values retained without duplicates');
  const ep={id:'cli',label:'CLI',kind:'codex-cli',model:'fast',reasoningEffort:'xhigh',cliModels:models};
  t.eq(cliModelLabel({...ep,model:undefined}),'','unset native model never displays the first catalog entry as current');
  t.eq(cliModelItems({...ep,model:undefined},()=>{}).filter(m=>m.checked).length,1,'unset native model marks only follow-default option');
  t.eq(reasoningOptionsForEndpoint(ep),['off','low','high'],'effort options match selected native model');
  reconcileCliEffort(ep); t.eq(ep.reasoningEffort,'off','unsupported effort reset to CLI default');
  ep.reasoningEffort='high';reconcileCliEffort(ep);t.eq(ep.reasoningEffort,'high','compatible effort preserved');
  const request={messages:[],execution:{mode:'plan',permission:'read-only'}};
  t.ok(cliArguments(ep,request,'/vault').includes('model_reasoning_effort="high"'),'Codex selected effort reaches CLI');
  const claudeRows=[{value:'default',resolvedModel:'claude-opus-test',displayName:'Default',supportedEffortLevels:['low','high']},{value:'opus',resolvedModel:'claude-opus-test',displayName:'Opus',supportedEffortLevels:['low','high']},{value:'haiku',displayName:'Haiku'}];
  const cc={...ep,kind:'claude-code-cli',model:'opus',cliModels:parseCliModels('claude-code-cli',claudeRows)};
  const args=cliArguments(cc,request,'/vault'); t.eq(args[args.indexOf('--effort')+1],'high','Claude selected effort is passed via --effort');
  cc.model='haiku';reconcileCliEffort(cc);t.eq(cc.reasoningEffort,'off','model without effort resets prior setting');
  t.ok(!cliArguments(cc,request,'/vault').includes('--effort'),'no effort parameter for unsupported model');
  cc.model='';cc.reasoningEffort='high'; t.eq(reasoningOptionsForEndpoint(cc),['off'],'unknown local default capabilities are not guessed');
  t.ok(!cliArguments(cc,request,'/vault').includes('--effort'),'native default never gets stale incompatible effort');
  cc.model='claude-opus-test';let selected;
  const items=cliModelItems(cc,m=>{selected=m});t.eq(items.filter(i=>i.checked).length,1,'resolved aliases yield only one current selection');
  await items.find(i=>i.hint==='opus').onSelect();t.eq(selected,'opus','picker retains executable native model id');

  const grokRows=[{modelId:'grok-native',name:'Grok Native',_meta:{reasoningEfforts:[{id:'deep',value:'high'},{id:'fast',value:'low'}]}},{modelId:'grok-plain'}];
  const grok={id:'g',label:'Grok',kind:'grok-cli',model:'grok-native',cliModels:parseCliModels('grok-cli',grokRows),reasoningEffort:'high'};
  t.eq(reasoningOptionsForEndpoint(grok),['off','high','low'],'Grok ACP capabilities produce native effort choices');
  grok.customReasoningEffort='deep';reconcileCliEffort(grok);
  const grokArgs=cliArguments(grok,request,'/vault');
  t.eq(grokArgs[grokArgs.indexOf('--effort')+1],'deep','manual Grok effort bypasses cached capability filtering');
  t.eq(grokArgs[grokArgs.indexOf('--sandbox')+1],'read-only','Grok Plan requests read-only sandbox');
  t.ok(!grokArgs.includes('--always-approve')&&!grokArgs.includes('bypassPermissions'),'Grok never bypasses approvals');
  t.eq(grokArgs[grokArgs.indexOf('--tools')+1],'read_file,grep,list_dir','Grok Plan excludes editing and shell tools');
  const grokAct=cliArguments(grok,{...request,execution:{mode:'act',permission:'workspace-write'}},'/vault');
  t.eq(grokAct[grokAct.indexOf('--tools')+1],'read_file,grep,list_dir,search_replace','Grok Act allows native note edits');
  const {discoverLocalCliModels}=await load(path.resolve(__dirname,'../src/providers/local_cli.ts'),{Platform:{isDesktopApp:true,isWin:false}});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glossa-catalog-test-'));
  const body=`#!/usr/bin/env node
const fs=require('fs'),path=require('path');
if(process.argv.includes('--version')){console.log('Fixture CLI');process.exit(0);}
const broken=process.argv[1].endsWith('broken'),empty=process.argv[1].endsWith('empty'),hang=process.argv[1].endsWith('hang');
const out=v=>process.stdout.write(JSON.stringify(v)+'\\n');
const log=path.join(process.cwd(),'requests.jsonl');fs.appendFileSync(log,JSON.stringify({argv:process.argv.slice(2),pid:process.pid})+'\\n');
require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(log,line+'\\n');
if(hang)return;if(broken){process.stdout.write('invalid-json\\n');return;}
if(m.method==='initialize')out({id:m.id,result:{}});
if(m.method==='_x.ai/models/list')out({jsonrpc:'2.0',id:m.id,result:{result:{currentModelId:'grok-native',availableModels:[{modelId:'grok-native',name:'Grok Native',_meta:{reasoningEfforts:[{value:'high'}]}}]}}});
if(m.method==='model/list'){const more=!m.params.cursor;out({id:m.id,result:{data:empty?[]:[{model:more?'first':'second',supportedReasoningEfforts:[{reasoningEffort:more?'low':'high'}]}],nextCursor:empty?null:more?'next':null}});}
if(m.type==='control_request')out({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{models:empty?[]:[{value:'sonnet',resolvedModel:'claude-test',supportedEffortLevels:['low','high']}]}}});
});
`;
  const binary=path.join(dir,'fake-cli');fs.writeFileSync(binary,body,{mode:0o755});
  try {
    // Match the desktop plugin loader: CommonJS require is available, while
    // Chromium's dynamic import loader cannot import Node builtin modules.
    const bundle=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/providers/local_cli.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['obsidian']}).outputFiles[0].text;
    const module={exports:{}};
    require('vm').runInNewContext(bundle,{module,exports:module.exports,window:globalThis,URL,require:name=>name==='obsidian'?{Platform:{isDesktopApp:true,isWin:false}}:require(name)});
    const desktopCatalog=await module.exports.discoverLocalCliModels({...ep,binaryPath:binary},dir);
    t.eq(desktopCatalog.length,2,'desktop CommonJS host resolves Node modules without browser dynamic imports');
    const catalog=await discoverLocalCliModels({...ep,binaryPath:binary},dir);
    t.eq(catalog.map(m=>m.id),['first','second'],'real child discovery follows Codex pagination');
    const ccCatalog=await discoverLocalCliModels({...cc,binaryPath:binary},dir);
    t.eq(ccCatalog[0].resolvedModel,'claude-test','Claude initialization reports native resolved model');
    const grokCatalog=await discoverLocalCliModels({...grok,binaryPath:binary},dir);
    t.eq(grokCatalog[0].efforts,['high'],'Grok child uses ACP model extension without a session or prompt');
    t.ok(grokCatalog[0].isDefault,'Grok current catalog model is marked default');
    const messages=fs.readFileSync(path.join(dir,'requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    t.ok(messages.every(m=>!m.messages&&!m.prompt&&m.type!=='user'),'metadata discovery sends no conversation or user prompt');
    t.ok(messages.some(m=>m.argv?.includes('--tools')&&m.argv.at(-1)===''),'Claude discovery disables all tools');
    t.ok(messages.some(m=>m.method==='initialized'),'Codex protocol handshake completed before listing');
    for(const suffix of ['broken','empty']){
      const file=binary+'-'+suffix;fs.writeFileSync(file,body,{mode:0o755});let failed=false;
      try{await discoverLocalCliModels({...ep,binaryPath:file},dir)}catch{failed=true}
      t.ok(failed,`${suffix} catalog fails visibly rather than claiming success`);
    }
    const file=binary+'-hang';fs.writeFileSync(file,body,{mode:0o755});const ctl=new AbortController();
    const start=Date.now();const promise=discoverLocalCliModels({...ep,binaryPath:file},dir,undefined,ctl.signal);
    setTimeout(()=>ctl.abort(),200);let cancelled=false;try{await promise}catch{cancelled=true}
    t.ok(cancelled&&Date.now()-start<3000,'cancelled metadata probe closes its owned process promptly');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
};
