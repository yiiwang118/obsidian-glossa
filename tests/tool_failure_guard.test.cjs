const path = require('path');

exports.run = async function(t, loadModule) {
  const guardMod = await loadModule(path.resolve(__dirname, '../src/agent/tool_failure_guard.ts'));
  t.ok(guardMod.toolResultLooksLikeError('Error: file not found'), 'Error-prefixed tool text is classified as failure');
  t.ok(guardMod.toolResultLooksLikeError('  Failed: network unavailable'), 'leading whitespace and Failed prefix are classified');
  t.ok(!guardMod.toolResultLooksLikeError('The note discusses error handling.'), 'ordinary content mentioning errors remains successful');

  const guard = new guardMod.ToolFailureGuard();
  t.eq(guard.record('web_fetch', true), null, 'first failure is recorded without extra noise');
  t.ok(guard.record('web_fetch', true).includes('failed twice'), 'second failure tells the model to change strategy');
  t.ok(guard.record('web_fetch', true).includes('failed three times'), 'third failure explicitly closes the retry path');
  t.ok(guard.blockReason('web_fetch').includes('already failed 3 times'), 'fourth attempt is refused before execution');
  guard.record('web_fetch', false);
  t.eq(guard.failureCount('web_fetch'), 0, 'a successful corrected call resets the failure streak');
  t.eq(guard.blockReason('web_fetch'), null, 'reset tool can be used normally again');

  const loop = await loadModule(path.resolve(__dirname, '../src/agent/loop.ts'));
  const events = [];
  const requests = [];
  let providerCall = 0;
  const provider = {
    id: 'test', displayName: 'Test', isAvailable: async () => true, defaultModel: () => 'test',
    async *stream(req) {
      requests.push(req);
      providerCall += 1;
      if (providerCall === 1) {
        yield { type: 'tool_call', id: 'read-missing', name: 'read_note', args: { path: 'Missing.md' } };
        yield { type: 'final', text: '' };
      } else {
        yield { type: 'text', text: 'done' };
        yield { type: 'final', text: 'done' };
      }
    },
  };
  await loop.runAgentLoop({
    app: {
      vault: {
        adapter: { exists: async () => false, read: async () => '', write: async () => {}, mkdir: async () => {} },
        getAbstractFileByPath: () => null, getName: () => 'Test',
      },
      workspace: {}, metadataCache: {}, fileManager: {},
    },
    provider, systemPrompt: 'test', userContent: 'read missing file', history: [], enableTools: true,
    permissionLevel: 'workspace-write', runMode: 'act', maxSteps: 3, autoApproveTools: [], neverApproveTools: [],
    onText: () => {}, onToolStart: () => {}, onToolEnd: event => events.push({ ...event }), onStepBoundary: () => {},
    onFinal: () => {}, onError: error => { throw new Error(error); },
  });
  t.ok(events.some(event => event.id === 'read-missing' && event.status === 'error'), 'agent loop exposes Error-prefixed tool returns as error events');
  const missingResult = requests[1].messages.find(message => message.toolCallId === 'read-missing');
  t.ok(missingResult.toolIsError === true, 'provider receives error semantics for returned tool errors');
};
