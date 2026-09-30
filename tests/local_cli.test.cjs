const path = require('path');
const fs = require('fs');
const os = require('os');
exports.run = async (t, load) => {
  const { CliDecoder, cliArguments, cliPrompt } = await load(path.resolve(__dirname, '../src/providers/cli_protocol.ts'));
  const endpoint = { id:'c', label:'CLI', kind:'codex-cli', cliExtraArgs:['--dangerously-bypass-approvals-and-sandbox'], codexSandboxMode:'danger-full-access' };
  const args = cliArguments(endpoint,{messages:[],execution:{mode:'plan',permission:'full'}},'/vault with spaces');
  t.eq(args[args.indexOf('--sandbox')+1],'read-only','Plan stays read-only despite legacy override');
  t.ok(!args.some(v=>v.includes('danger')), 'legacy bypass args never forwarded');
  t.eq(args[args.indexOf('-C')+1],'/vault with spaces','working directory stays one argument');
  t.ok(!args.includes('--model'), 'native default model respected');
  const act=cliArguments(endpoint,{messages:[],execution:{mode:'act',permission:'workspace-write'}},'/vault');
  t.eq(act[act.indexOf('--sandbox')+1],'workspace-write','Act uses workspace sandbox');
  const claude=cliArguments({...endpoint,kind:'claude-code-cli'},{messages:[],execution:{mode:'act',permission:'read-only'}},'/vault');
  t.ok(claude.includes('Read,Glob,Grep')&&!claude.includes('acceptEdits'),'read-only Claude excludes write/command tools');
  t.ok(claude.includes('--restricted')&&claude.includes('--strict-mcp-config'),'Claude filesystem restriction and MCP isolation explicit');
  t.ok(cliPrompt({messages:[{role:'user',content:'hello'}]}).includes('hello'),'context sent through stdin');
  const d=new CliDecoder('codex-cli');
  t.eq(d.decode({type:'item.completed',item:{id:'x',type:'agent_message',text:'hello'}})[0].text,'hello','Codex completed messages rendered');
  t.eq(d.decode({type:'item.completed',item:{id:'t',type:'command_execution',exit_code:2}})[0].status,'error','nonzero native command classified as error');
  t.eq(d.decode({type:'turn.completed',usage:{input_tokens:40,output_tokens:7}})[0].usage.output,7,'Codex usage mapped');
  t.ok(d.completed,'Codex final completion tracked');
  const c=new CliDecoder('claude-code-cli');
  c.decode({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'hello'}}});
  t.eq(c.decode({type:'assistant',message:{content:[{type:'text',text:'hello'}]}}).length,0,'Claude snapshot does not duplicate streamed text');
  t.eq(c.decode({type:'result',is_error:false,result:'hello'})[0].text,'hello','Claude final retains exact text');
  const failed=new CliDecoder('claude-code-cli');
  t.eq(failed.decode({type:'result',is_error:true,errors:['No auth']})[0].type,'error','Claude failure not reported as success');

  const { LocalCliProvider, findLocalCli } = await load(path.resolve(__dirname,'../src/providers/local_cli.ts'),{Platform:{isDesktopApp:true,isWin:false}});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glossa-cli-test-'));
  const executable=path.join(dir,'fake-cli');
  fs.writeFileSync(executable,`#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('fake 1.0');process.exit(0)}\nlet input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{if(input.includes('CANCEL_TEST')){console.log(JSON.stringify({type:'item.started',item:{id:'wait',type:'command_execution',command:'fixture'}}));setInterval(()=>{},1000);return;}const result=JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:input.includes('private fixture')?'pong':'missing context'}});process.stdout.write(result.slice(0,20));setTimeout(()=>{process.stdout.write(result.slice(20)+'\\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}})+'\\n')},5)});`,{mode:0o755});
  try {
    t.eq(await findLocalCli('codex-cli',executable),executable,'installed executable detection is read-only');
    const provider=new LocalCliProvider({...endpoint,binaryPath:executable},dir);
    const chunks=[];for await(const chunk of provider.stream({messages:[{role:'user',content:'private fixture'}]}))chunks.push(chunk);
    t.eq(chunks.filter(c=>c.type==='text').map(c=>c.text).join(''),'pong','real child process receives stdin and decodes split JSON lines');
    const ctl=new AbortController();let count=0;const started=Date.now();
    for await(const chunk of provider.stream({messages:[{role:'user',content:'CANCEL_TEST'}],signal:ctl.signal})){ count++;ctl.abort(); }
    t.ok(count===1&&Date.now()-started<4000,'cancellation terminates owned CLI promptly');
    let imageError='';try{for await(const chunk of provider.stream({messages:[],attachedImages:[{dataUri:'data:image/png;base64,a'}]}))void chunk}catch(error){imageError=error.message}
    t.ok(imageError.includes('image attachments'),'unsupported images fail visibly before execution');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
};
