const path = require('path');

function resultText(result) {
  return typeof result === 'string' ? result : result.text;
}

function loadedNames(result) {
  return typeof result === 'string' ? [] : (result.loadedToolNames ?? []);
}

function mockApp() {
  const adapter = {
    exists: async () => false,
    read: async () => '',
    write: async () => {},
    mkdir: async () => {},
    rename: async () => {},
    remove: async () => {},
  };
  return {
    vault: {
      adapter,
      getName: () => 'Test',
      getAbstractFileByPath: () => null,
    },
    workspace: {},
    metadataCache: {},
    fileManager: {},
  };
}

async function runDynamicLoadCase(loop, permissionLevel, requestedName) {
  const requests = [];
  const toolResults = [];
  let call = 0;
  const provider = {
    id: 'test',
    displayName: 'Test',
    isAvailable: async () => true,
    defaultModel: () => 'test',
    async *stream(req) {
      requests.push(req);
      call += 1;
      if (call === 1) {
        yield { type: 'tool_call', id: 'search-1', name: 'tool_search', args: { exact_names: [requestedName] } };
        yield { type: 'final', text: '' };
        return;
      }
      const lastTool = [...req.messages].reverse().find(message => message.role === 'tool');
      if (lastTool) toolResults.push(lastTool.content);
      yield { type: 'text', text: 'done' };
      yield { type: 'final', text: 'done' };
    },
  };
  await loop.runAgentLoop({
    app: mockApp(),
    provider,
    systemPrompt: 'test',
    userContent: 'test dynamic tool loading',
    history: [],
    enableTools: true,
    permissionLevel,
    runMode: 'act',
    maxSteps: 3,
    autoApproveTools: [],
    neverApproveTools: [],
    onText: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onStepBoundary: () => {},
    onFinal: () => {},
    onError: error => { throw new Error(error); },
  });
  return { requests, toolResults };
}

exports.run = async function(t, loadModule) {
  const tools = await loadModule(path.resolve(__dirname, '../src/agent/tools.ts'));
  const shared = await loadModule(path.resolve(__dirname, '../src/agent/tools/_shared.ts'));

  t.eq(tools.toolRegistryIssues(), [], 'every registered tool has a coherent documented schema');

  const initial = tools.listToolSpecs();
  const initialNames = new Set(initial.map(spec => spec.name));
  t.eq(initial.length, 16, 'initial model surface contains only core tools plus context control');
  t.ok(JSON.stringify(initial).length < 16000, 'initial tool schemas stay below the context budget target');
  t.ok(initialNames.has('read_note') && initialNames.has('apply_patch') && initialNames.has('context_prune'), 'core read, edit, and context tools remain immediately available');
  t.ok(!initialNames.has('get_backlinks') && !initialNames.has('patch_canvas'), 'specialized tools are deferred');

  const allVisible = new Set(tools.listToolSpecs({ includeDeferred: true }).map(spec => spec.name));
  t.ok(allVisible.has('get_backlinks') && allVisible.has('patch_canvas') && allVisible.has('read_files') && allVisible.has('validate_skill'), 'deferred tools remain loadable');
  t.ok(!allVisible.has('edit_section') && !allVisible.has('run_skill'), 'deprecated tools stay hidden from the model');

  const search = tools.getTool('tool_search');
  const chinese = await search.run({}, { query: '查看这篇笔记的反链' });
  t.ok(loadedNames(chinese).includes('get_backlinks'), 'Chinese capability query finds backlinks');
  t.ok(resultText(chinese).includes('do not repeat tool_search'), 'search result gives a convergent next action');

  const canvas = await search.run({}, { query: '编辑画布节点和连接', max_results: 3 });
  t.ok(loadedNames(canvas).includes('patch_canvas'), 'Chinese Canvas request finds the mutation tool');

  const batchRead = await search.run({}, { query: '批量读取多个文件', max_results: 3 });
  t.ok(loadedNames(batchRead).includes('read_files'), 'Chinese batch-read request finds the ranged multi-file tool');

  const skillValidation = await search.run({}, { query: '校验技能质量', max_results: 3 });
  t.ok(loadedNames(skillValidation).includes('validate_skill'), 'Chinese Skill quality request finds the validator');

  const exact = await search.run({}, { exact_names: ['write_note', 'missing_tool'] });
  t.eq(loadedNames(exact), ['write_note'], 'exact-name mode loads known tools and skips unknown names');
  t.ok(resultText(exact).includes('missing_tool'), 'exact-name mode reports rejected names');

  const legacySelect = await search.run({}, { query: 'select:get_outgoing_links' });
  t.eq(loadedNames(legacySelect), ['get_outgoing_links'], 'legacy select syntax remains compatible');

  const readPdf = tools.getTool('read_pdf');
  const invalid = shared.validateToolInput(readPdf.spec.parameters, {
    path: 'Paper.pdf', mode: 'guess', max_pages: 0, extra: true,
  });
  t.ok(invalid.some(error => error.includes('mode must be one of')), 'input validator rejects unknown enum values');
  t.ok(invalid.some(error => error.includes('max_pages must be at least 1')), 'input validator enforces numeric bounds');
  t.ok(invalid.some(error => error.includes('extra is not allowed')), 'input validator rejects undocumented properties');

  const invalidRead = shared.validateToolInput(tools.getTool('read_note').spec.parameters, {
    path: 'Notes/Foo.md', start_line: 0, max_lines: 6000,
  });
  t.ok(invalidRead.some(error => error.includes('start_line must be at least 1')), 'read_note range enforces 1-based lines');
  t.ok(invalidRead.some(error => error.includes('max_lines must be at most 5000')), 'read_note range enforces its line cap');

  const invalidBatch = shared.validateToolInput(tools.getTool('read_files').spec.parameters, {
    requests: [{ path: 'A.md', start_line: 1, unexpected: true }],
  });
  t.ok(invalidBatch.some(error => error.includes('requests[0].unexpected is not allowed')), 'batch reader rejects undocumented nested request fields');

  const loop = await loadModule(path.resolve(__dirname, '../src/agent/loop.ts'));
  const writable = await runDynamicLoadCase(loop, 'workspace-write', 'get_backlinks');
  const firstNames = new Set(writable.requests[0].tools.map(spec => spec.name));
  const secondNames = new Set(writable.requests[1].tools.map(spec => spec.name));
  t.ok(!firstNames.has('get_backlinks'), 'deferred tool is absent before tool_search');
  t.ok(secondNames.has('get_backlinks'), 'tool_search adds the schema to the next provider request');

  const readOnly = await runDynamicLoadCase(loop, 'read-only', 'delete_note');
  t.ok(!readOnly.requests[1].tools.some(spec => spec.name === 'delete_note'), 'read-only mode refuses dynamically loaded write tools');
  t.ok(readOnly.toolResults.some(text => text.includes('current permission/provider mode')), 'model receives the mode rejection reason');
};
