const path = require('path');

exports.run = async function run(t, loadModule) {
  const types = await loadModule(path.join(__dirname, '../src/types.ts'));
  const customApi = await loadModule(path.join(__dirname, '../src/providers/custom_api.ts'));

  const endpoint = {
    id: 'gpt56',
    label: 'GPT-5.6',
    kind: 'custom-api',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-5.6',
    apiStyle: 'openai',
  };
  const expected = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  t.eq(types.reasoningOptionsForEndpoint(endpoint), expected, 'all reasoning efforts are shown');
  t.eq(types.reasoningOptionsForEndpoint({ ...endpoint, label: 'DeepSeek', model: 'deepseek-v4' }), expected, 'provider heuristics do not hide effort values');

  for (const effort of expected.slice(1)) {
    t.eq(types.mapOpenAIReasoningEffort(endpoint, effort), effort, `${effort} passes through unchanged`);
  }
  t.eq(types.mapOpenAIReasoningEffort(endpoint, 'off'), null, 'off omits reasoning_effort');

  for (const effort of ['minimal', 'xhigh', 'max', 'ultra']) {
    const provider = new customApi.CustomApiProvider({ ...endpoint, reasoningEffort: effort });
    const body = {};
    provider.applyOpenAIReasoning(body);
    t.eq(body.reasoning_effort, effort, `${effort} reaches the OpenAI-compatible request body`);
  }

  const offProvider = new customApi.CustomApiProvider({ ...endpoint, reasoningEffort: 'off' });
  const offBody = {};
  offProvider.applyOpenAIReasoning(offBody);
  t.ok(!Object.prototype.hasOwnProperty.call(offBody, 'reasoning_effort'), 'off request body has no reasoning_effort');
};
