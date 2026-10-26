const path = require('node:path');
exports.run = async (t, load) => {
  const { SubtaskRegistry } = await load(path.resolve(__dirname, '../src/agent/subtasks.ts'));
  const { forkSkill } = await load(path.resolve(__dirname, 'support/agent_runtime.ts'));
  const { recoverRuns } = await load(path.resolve(__dirname, '../src/agent/run_journal.ts'));
  const records = [], registry = new SubtaskRegistry(records), parent = new AbortController();
  const a = registry.start('A', parent.signal), b = registry.start('B', parent.signal);
  t.ok(registry.steer(a.record.id, 'Correction'), 'active child accepts steering');
  t.eq(registry.takeSteering(b.record.id), [], 'steering never leaks to siblings');
  t.eq(registry.takeSteering(a.record.id), ['Correction'], 'steering consumed once');
  t.eq(registry.takeSteering(a.record.id), [], 'consumed steering not repeated');
  registry.stop(a.record.id);
  t.ok(a.signal.aborted && !b.signal.aborted && !parent.signal.aborted, 'stop affects one child only');
  t.ok(!registry.steer(a.record.id, 'Late'), 'stopping child rejects late steering');
  registry.finish(a.record);
  t.eq(a.record.phase, 'cancelled', 'stop is not successful completion');
  parent.abort(); registry.finish(b.record);
  t.eq(b.record.phase, 'cancelled', 'parent stop reaches every descendant');
  registry.update(a.record, { output: 'late data' });
  t.eq(a.record.output, '', 'terminal progress never reopens');
  recoverRuns({ messages: [], subtasks: [{ ...a.record, phase: 'running', queued: 2 }] });
  const restored = { messages: [], subtasks: [{ ...a.record, phase: 'running', queued: 2 }] };
  recoverRuns(restored); t.eq(restored.subtasks[0].phase, 'interrupted', 'restart does not automatically execute child');
  for (let i = 0; i < 30; i++) registry.finish(registry.start('finished').record);
  t.eq(records.length, 20, 'finished progress bounded');

  const app = { vault: { adapter: { exists: async () => false }, getName: () => 'Test', getAbstractFileByPath: () => null }, workspace: {}, metadataCache: {} };
  const tool = { spec: { name: 'test_write', description: 'Test write', parameters: { type: 'object', properties: { path: { type: 'string' } } } }, dangerous: true,
    isReadOnly: () => false, describe: () => 'Write', run: async () => { writes++; return 'Saved'; } };
  let writes = 0, approvals = 0;
  const opts = { app, systemPrompt: 'Parent', skill: { name: 'child', source: 'vault', path: 'skills/child.md', body: 'Do task' }, args: '', permissionLevel: 'workspace-write', runMode: 'act', autoApproveTools: [], neverApproveTools: [], maxSteps: 3,
    runtimeTools: [tool], approver: async () => { approvals++; return { ok: true }; } };
  const requests = [];
  const scripted = () => ({ async *stream(req) {
    requests.push(req);
    if (req.messages.length === 1) yield { type: 'tool_call', id: 'w', name: 'test_write', args: { path: 'allowed/test.md' } };
    else yield { type: 'text', text: 'Done' };
    yield { type: 'final', text: '' };
  } });
  const active = new SubtaskRegistry([]);
  let queued = false;
  const watched = new SubtaskRegistry([], () => {
    const item = watched.records[0];
    if (item?.tool && !queued) { queued = true; watched.steer(item.id, 'Preserve links'); }
  });
  const result = await forkSkill({ ...opts, provider: scripted(), subtasks: watched });
  t.eq(result.error, undefined, 'fork error detail');
  t.ok(result.ok && approvals === 1 && writes === 1, 'child uses parent approval handler and tool registry');
  t.ok(requests.at(-1).messages.some(m => m.content === 'Preserve links'), 'child receives steering at next model step');
  t.eq(watched.records[0].phase, 'completed', 'completed child progress visible');
  t.eq(watched.records[0].output, 'Done', 'child output available');
  await forkSkill({ ...opts, provider: scripted(), runMode: 'plan', subtasks: active });
  t.eq(writes, 1, 'plan child cannot write');
  await forkSkill({ ...opts, provider: scripted(), workspaceFolders: ['elsewhere'] });
  t.eq(writes, 1, 'child respects parent workspace boundaries');
  const stopped = new SubtaskRegistry([]);
  const stopProvider = { async *stream(req) {
    yield { type: 'text', text: 'Partial' };
    stopped.stop(stopped.records[0].id);
    yield { type: 'text', text: 'Late' };
    yield { type: 'final', text: '' };
  } };
  const cancelled = await forkSkill({ ...opts, provider: stopProvider, subtasks: stopped });
  t.ok(!cancelled.ok && cancelled.result === 'Partial', 'cancel retains partial result without late output');
  const depth = await forkSkill({ ...opts, provider: scripted(), forkDepth: 5 });
  t.ok(!depth.ok && depth.error.includes('depth'), 'depth limit is explicit per branch');
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => forkSkill({ ...opts, runMode: 'plan', provider: scripted() })));
  t.ok(concurrent.every(r => r.ok), 'independent forks do not consume each other’s depth budget');
  const waiting = new SubtaskRegistry([]);
  let waitingSignal;
  const approvalStop = await forkSkill({ ...opts, provider: scripted(), subtasks: waiting,
    approver: async (_tool, _args, signal) => {
      waitingSignal = signal;
      const denied = new Promise(resolve => signal.addEventListener('abort', () => resolve({ ok: false }), { once: true }));
      waiting.stop(waiting.records[0].id);
      return denied;
    },
  });
  t.ok(waitingSignal.aborted && !approvalStop.ok, 'stopping an approval-waiting child uses the child signal');
  t.eq(writes, 1, 'stopping during approval never executes the pending write');

};
