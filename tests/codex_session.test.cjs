const path = require('path'), fs = require('fs'), os = require('os');
exports.run = async (t, load) => {
  const { CodexSessionProtocol, codexPolicyKey, conversationKey } = await load(path.resolve(__dirname, '../src/providers/codex_session.ts'));
  const ep = { id: 'codex', kind: 'codex-cli', codexNativeSession: true, model: 'fixture', reasoningEffort: 'high', cliModels: [{ id: 'fixture', label: 'Fixture', efforts: ['low', 'high'] }] };
  const request = { systemPrompt: 'Glossa rules\n\n<<<SYSTEM_PROMPT_DYNAMIC_BOUNDARY>>>\n\n# Mode: ACT', execution: { mode: 'act', permission: 'workspace-write' },
    messages: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'previous' }, { role: 'user', content: 'new' }] };
  let binding;
  request.nativeSession = { ownerId: 'chat', historyKey: 'history', clientVersion: '9.9.9', onBinding: async value => { binding = value; } };
  const open = async (endpoint, req, send) => new CodexSessionProtocol(endpoint, req, '/vault', await codexPolicyKey(endpoint, req, '/vault'), send);
  const sent = [], p = await open(ep, request, value => sent.push(value));
  p.start();
  t.eq(sent[0].params.clientInfo.version, '9.9.9', 'the app-server sees the plugin version');
  await p.receive({ id: 1, result: {} });
  const threadStart = sent.at(-1);
  t.eq(threadStart.method, 'thread/start', 'first message starts a native thread');
  t.eq(threadStart.params.sandbox, 'workspace-write', 'thread sandbox follows current mode');
  t.ok(!('baseInstructions' in threadStart.params), 'Codex keeps its own base instructions');
  t.eq(threadStart.params.developerInstructions, 'Glossa rules\n\n\n\n# Mode: ACT', 'Glossa instructions are added once, without the cache marker');
  await p.receive({ id: 2, result: { thread: { id: 'native' } } });
  t.eq(binding.historyKey, '', 'binding is invalidated durably before execution');
  t.ok(sent.at(-1).params.input[0].text.includes('previous'), 'new thread receives prior chat context');
  t.ok(!sent.at(-1).params.input[0].text.includes('Glossa rules'), 'instructions are not repeated in the first input');
  t.eq(sent.at(-1).params.effort, 'high', 'effort is forwarded');
  t.eq(sent.at(-1).params.sandboxPolicy.networkAccess, false, 'native sessions do not widen network access');
  const unsupported = [];
  const other = await open({ ...ep, reasoningEffort: 'xhigh' }, { ...request, nativeSession: { ...request.nativeSession, onBinding: async () => {} } }, value => unsupported.push(value));
  other.start(); await other.receive({ id: 1, result: {} }); await other.receive({ id: 2, result: { thread: { id: 'other' } } });
  t.ok(!('effort' in unsupported.at(-1).params), 'an effort the model does not list is not sent');
  await p.receive({ id: 3, result: { turn: { id: 'turn' } } });
  const usage = (total, last) => ({ method: 'thread/tokenUsage/updated', params: { threadId: 'native', turnId: 'turn', tokenUsage: { total, last } } });
  const counts = (input, output) => ({ inputTokens: input, outputTokens: output, cachedInputTokens: 0 });
  await p.receive({ method: 'item/started', params: { threadId: 'native', turnId: 'turn', item: { id: 'u', type: 'userMessage' } } });
  await p.receive(usage(counts(1000, 100), counts(400, 40)));
  t.eq(await p.receive({ method: 'item/agentMessage/delta', params: { threadId: 'other', itemId: 'a', delta: 'wrong' } }), [], 'foreign thread events are ignored');
  t.eq((await p.receive({ method: 'item/agentMessage/delta', params: { threadId: 'native', turnId: 'turn', itemId: 'a', delta: 'hello' } }))[0].text, 'hello', 'stream delta is mapped');
  await p.receive(usage(counts(1600, 160), counts(600, 60)));
  await p.receive(usage(counts(1600, 160), counts(600, 60)));
  const tool = (await p.receive({ method: 'item/started', params: { threadId: 'native', turnId: 'turn', item: { id: 'c', type: 'commandExecution', command: 'ls', status: 'inProgress' } } }))[0];
  t.eq(tool.name, 'cli_command_execution', 'commands use the compatibility mode name');
  const patch = (await p.receive({ method: 'item/completed', params: { threadId: 'native', turnId: 'turn', item: { id: 'f', type: 'fileChange', changes: [{ path: 'a.md' }], status: 'completed' } } }))[0];
  t.eq([patch.name, patch.args.changes[0].path], ['cli_file_change', 'a.md'], 'file changes never use the name of Glossa apply_patch');
  await p.receive(usage(counts(2300, 230), counts(700, 70)));
  const done = { method: 'item/completed', params: { threadId: 'native', turnId: 'turn', item: { id: 'a', type: 'agentMessage', text: 'hello!' } } };
  t.eq((await p.receive(done))[0].text, '!', 'final snapshot only emits the missing suffix');
  t.eq(await p.receive(done), [], 'repeated item completion never duplicates text');
  await p.receive({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} });
  t.eq(sent.at(-1).result.decision, 'decline', 'unexpected escalation requests are declined');
  p.interrupt(); t.eq(sent.at(-1).method, 'turn/interrupt', 'stop sends the native interrupt');
  const final = (await p.receive({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } }))[0];
  t.ok(p.completed, 'completion is tracked');
  t.eq([final.usage.input, final.usage.output], [1300, 130], 'usage covers every call of the turn, without the earlier total or repeated reports');
  t.eq(final.usage.lastInput, 700, 'the latest prompt size is kept for the context gauge');
  t.eq(await p.receive({ method: 'item/agentMessage/delta', params: { itemId: 'a', delta: 'late' } }), [], 'late text after completion is ignored');
  const fresh = await open(ep, { ...request, nativeSession: { ...request.nativeSession, onBinding: async () => {} } }, () => {});
  fresh.start(); await fresh.receive({ id: 1, result: {} }); await fresh.receive({ id: 2, result: { thread: { id: 'native' } } }); await fresh.receive({ id: 3, result: { turn: { id: 'turn' } } });
  await fresh.receive({ method: 'item/agentMessage/delta', params: { threadId: 'native', turnId: 'turn', itemId: 'a', delta: 'x' } });
  await fresh.receive(usage(counts(500, 50), counts(500, 50)));
  t.eq((await fresh.receive({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } }))[0].usage.input, 500, 'a first report after output counts its own call');

  const resumedSent = [];
  request.nativeSession.binding = { ...binding, historyKey: 'history' };
  const resumed = await open(ep, request, value => resumedSent.push(value));
  resumed.start(); await resumed.receive({ id: 1, result: {} });
  t.eq(resumedSent.at(-1).method, 'thread/resume', 'matching chat resumes its native thread');
  t.ok(!('developerInstructions' in resumedSent.at(-1).params), 'a resumed thread already has its instructions');
  await resumed.receive({ id: 2, result: { thread: { id: 'native' } } });
  t.eq(resumedSent.at(-1).params.input[0].text, 'new', 'resume sends only the new user message');
  for (const mutate of [r => r.nativeSession.ownerId = 'fork', r => r.nativeSession.historyKey = 'edited', r => r.execution.mode = 'plan', r => r.systemPrompt = 'Changed rules']) {
    const r = { ...request, execution: { ...request.execution }, nativeSession: { ...request.nativeSession } }; mutate(r);
    t.ok(!(await open(ep, r, () => {})).resume, 'forks, edited history, permission and instruction changes start fresh');
  }
  const messages = [{ id: '1', role: 'user', content: 'text' }];
  const key = await conversationKey(messages);
  t.eq(await conversationKey([{ ...messages[0], usage: { input: 9 } }]), key, 'display/accounting changes do not break continuity');
  t.ok(await conversationKey([{ ...messages[0], content: 'edited' }]) !== key, 'history edits invalidate continuity');
  t.ok(await codexPolicyKey(ep, request, '/other') !== binding.policyKey, 'vault changes cannot reuse a binding');

  // Exercise the real child-process adapter without a login, model request, or vault.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossa-codex-session-'));
  const binary = path.join(dir, 'codex-fixture');
  fs.writeFileSync(binary, `#!/usr/bin/env node
if(process.argv.includes('--version')) { console.log('fixture'); process.exit(0); }
const rl=require('readline').createInterface({input:process.stdin});
const send=o=>process.stdout.write(JSON.stringify(o)+'\\n');
rl.on('line', line=>{const r=JSON.parse(line);
 if(r.method==='initialize')send({id:r.id,result:{}});
 if(r.method==='thread/start'||r.method==='thread/resume')send({id:r.id,result:{thread:{id:'fixture-thread'}}});
 if(r.method==='turn/start') {
  send({id:r.id,result:{turn:{id:'fixture-turn'}}});
  const prompt=r.params.input[0].text;
  if(prompt.includes('DISCONNECT')) {process.exit(2);return;}
  send({method:'item/agentMessage/delta',params:{threadId:'fixture-thread',turnId:'fixture-turn',itemId:'a',delta:'pong'}});
  if(prompt.includes('WAIT'))return;
  send({method:'item/completed',params:{threadId:'fixture-thread',turnId:'fixture-turn',item:{id:'a',type:'agentMessage',text:'pong'}}});
  send({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed'}}});
 }
});`, { mode: 0o755 });
  try {
    const { LocalCliProvider } = await load(path.resolve(__dirname, '../src/providers/local_cli.ts'), { Platform: { isDesktopApp: true, isWin: false } });
    const provider = new LocalCliProvider({ ...ep, binaryPath: binary }, dir);
    const chunks = [];
    for await (const c of provider.stream({ ...request, nativeSession: { ...request.nativeSession, binding: undefined } })) chunks.push(c);
    t.eq(chunks.filter(c => c.type === 'text').map(c => c.text).join(''), 'pong', 'real app-server connection streams one answer');
    t.eq(chunks.at(-1).type, 'final', 'native connection finishes cleanly');
    const controller = new AbortController();
    for await (const c of provider.stream({ ...request, messages: [{ role: 'user', content: 'WAIT' }], signal: controller.signal })) if (c.type === 'text') controller.abort();
    t.ok(controller.signal.aborted, 'cancellation releases a waiting child process');
    let failed = false;
    try { for await (const c of provider.stream({ ...request, messages: [{ role: 'user', content: 'DISCONNECT' }] })) void c; } catch (e) { failed = /disconnected/.test(e.message); }
    t.ok(failed, 'disconnect fails visibly without falling back or repeating execution');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
