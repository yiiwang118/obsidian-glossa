const path = require('path');

function mockApp() {
  return {
    vault: {
      adapter: { exists: async () => false, read: async () => '', write: async () => {}, mkdir: async () => {} },
      getAbstractFileByPath: () => null,
      getName: () => 'Test',
    },
    workspace: {}, metadataCache: {}, fileManager: {},
  };
}

function loopOptions(provider, history) {
  return {
    app: mockApp(), provider, systemPrompt: 'test', userContent: 'continue', history,
    enableTools: true, permissionLevel: 'workspace-write', runMode: 'act', maxSteps: 3,
    autoApproveTools: [], neverApproveTools: [],
    onText: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onStepBoundary: () => {},
    onFinal: () => {}, onError: error => { throw new Error(error); },
  };
}

exports.run = async function(t, loadModule) {
  const pruning = await loadModule(path.resolve(__dirname, '../src/utils/context_pruning.ts'));
  const messages = [
    { role: 'assistant', content: '', toolCalls: [{ id: 'read-1', name: 'read_note', args: { path: 'A.md' } }] },
    { role: 'tool', toolCallId: 'read-1', toolName: 'read_note', content: 'large result' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'skill-1', name: 'skill', args: { skill: 'pdf-analysis' } }] },
    { role: 'tool', toolCallId: 'skill-1', toolName: 'skill', content: 'instructions' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'bad-1', name: 'web_fetch', args: { url: 'x' } }] },
    { role: 'tool', toolCallId: 'bad-1', toolName: 'web_fetch', content: 'Error: failed', toolIsError: true },
    { role: 'assistant', content: '', toolCalls: [{ id: 'write-1', name: 'file_edit', args: { file_path: 'A.md' } }] },
    { role: 'tool', toolCallId: 'write-1', toolName: 'file_edit', content: 'Updated A.md' },
  ];
  const selected = pruning.resolveContextPruneRequest(messages, {
    mode: 'selected', toolCallIds: ['read-1', 'skill-1', 'bad-1', 'write-1', 'missing'], reason: 'stale',
  });
  t.eq(selected.acceptedToolCallIds, ['read-1'], 'only successful side-effect-free evidence is prunable');
  t.eq(selected.ignoredToolCallIds, ['skill-1', 'bad-1', 'write-1', 'missing'], 'control, error, write, and unknown IDs are reported as ignored');

  const filtered = pruning.filterPrunedToolContext(messages, new Set(['read-1']));
  t.ok(!JSON.stringify(filtered).includes('read-1') && !JSON.stringify(filtered).includes('large result'), 'filter removes both sides of a pruned tool protocol pair');
  t.ok(JSON.stringify(filtered).includes('skill-1') && JSON.stringify(filtered).includes('bad-1'), 'filter preserves control instructions and failed evidence');
  t.ok(JSON.stringify(filtered).includes('write-1'), 'filter preserves successful write confirmations');
  t.eq(messages.length, 8, 'filter does not mutate visible source history');

  const formatted = pruning.formatContextPruneOutcome({ mode: 'selected', toolCallIds: ['read-1'], reason: 'stale' }, selected);
  const recordedMessages = [{ role: 'tool', toolCallId: 'prune-1', toolName: 'context_prune', content: formatted }];
  t.eq([...pruning.collectRecordedPrunedToolCallIds(recordedMessages)], ['read-1'], 'prune state restores from a prior tool event');

  const loop = await loadModule(path.resolve(__dirname, '../src/agent/loop.ts'));
  const requests = [];
  let call = 0;
  const provider = {
    id: 'test', displayName: 'Test', isAvailable: async () => true, defaultModel: () => 'test',
    async *stream(req) {
      requests.push(req);
      call += 1;
      if (call === 1) {
        yield { type: 'tool_call', id: 'prune-1', name: 'context_prune', args: { mode: 'selected', tool_call_ids: ['read-1'], reason: 'finished reading' } };
        yield { type: 'final', text: '' };
      } else {
        yield { type: 'text', text: 'done' };
        yield { type: 'final', text: 'done' };
      }
    },
  };
  await loop.runAgentLoop(loopOptions(provider, messages.slice(0, 2)));
  t.eq(requests.length, 2, 'context prune continues the same run after applying the request');
  const hasProtocolCall = (request, id) => request.messages.some(message =>
    message.toolCallId === id || (message.toolCalls ?? []).some(toolCall => toolCall.id === id));
  t.ok(hasProtocolCall(requests[0], 'read-1'), 'first provider request includes the historical read');
  t.ok(!hasProtocolCall(requests[1], 'read-1'), 'next provider request excludes the accepted historical read');
  t.ok(JSON.stringify(requests[1].messages).includes('prune-1'), 'prune control call and result remain protocol-complete');
};
