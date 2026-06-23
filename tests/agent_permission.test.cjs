const path = require('path');

exports.run = async (t, loadModule) => {
  const execMod = await loadModule(path.resolve(__dirname, '../src/agent/tools/execute_command.ts'));
  const tool = execMod.executeCommand;

  let executed = false;
  const app = {
    commands: {
      commands: { 'app:reload-app': { name: 'Reload app' } },
      executeCommandById: async () => { executed = true; return true; },
    },
  };

  const perm = await tool.checkPermissions(app, { command_id: 'app:reload-app' });
  t.eq(perm.behavior, 'deny', 'execute_command checkPermissions hard-denies reload');

  const direct = await tool.run(app, { command_id: 'app:reload-app' });
  t.ok(/^Error: Command "app:reload-app" is hard-denied/.test(direct), 'execute_command run has defensive hard deny');
  t.ok(!executed, 'execute_command hard deny prevents direct dispatch');

  const loopMod = await loadModule(path.resolve(__dirname, '../src/agent/loop.ts'));
  executed = false;
  let streamCalls = 0;
  const provider = {
    id: 'fake',
    displayName: 'Fake',
    isAvailable: async () => true,
    defaultModel: () => 'fake',
    stream: async function* () {
      streamCalls++;
      if (streamCalls === 1) {
        yield { type: 'tool_call', id: 'tc1', name: 'execute_command', args: { command_id: 'app:reload-app' } };
        yield { type: 'final', text: '' };
      } else {
        yield { type: 'final', text: 'done' };
      }
    },
  };
  const ended = [];
  let final = false;
  let error = '';
  await loopMod.runAgentLoop({
    app,
    provider,
    systemPrompt: '',
    userContent: 'run it',
    history: [],
    enableTools: false,
    permissionLevel: 'workspace-write',
    runMode: 'act',
    maxSteps: 2,
    autoApproveTools: ['execute_command'],
    neverApproveTools: [],
    onText: () => {},
    onToolStart: () => {},
    onToolEnd: ev => ended.push(ev),
    onStepBoundary: () => {},
    onFinal: () => { final = true; },
    onError: e => { error = e; },
  });

  t.ok(final, 'agent loop completes after denied tool result');
  t.eq(error, '', 'agent loop reports no top-level error for denied tool');
  t.ok(!executed, 'agent loop checkPermissions deny beats auto-approve');
  const denied = ended.find(ev => ev.name === 'execute_command' && ev.status === 'denied');
  t.ok(!!denied, 'agent loop emits denied tool event');
  t.ok(/hard-denied/.test(denied.result), 'agent loop denied result includes hard-deny reason');
};
