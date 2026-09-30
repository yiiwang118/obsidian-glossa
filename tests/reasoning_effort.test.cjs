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

  const manual = new customApi.CustomApiProvider({ ...endpoint, reasoningEffort: 'off', customReasoningEffort: 'deep' });
  const manualBody = {}; manual.applyOpenAIReasoning(manualBody);
  t.eq(manualBody.reasoning_effort, 'deep', 'manual effort reaches OpenAI-compatible request unchanged');
  const anthropicBody = {}; manual.applyAnthropicThinking(anthropicBody);
  t.eq(anthropicBody.output_config.effort, 'deep', 'manual Anthropic effort is an explicit output parameter');
  t.eq(types.customEffortValue(' high '), 'high', 'manual effort trims surrounding whitespace');
  t.eq(types.customEffortValue(''), undefined, 'empty manual effort restores default');
  t.throws(()=>types.customEffortValue('high\\n--evil'), 'manual effort rejects control characters and flags');
  const offProvider = new customApi.CustomApiProvider({ ...endpoint, reasoningEffort: 'off' });
  const offBody = {};
  offProvider.applyOpenAIReasoning(offBody);
  t.ok(!Object.prototype.hasOwnProperty.call(offBody, 'reasoning_effort'), 'off request body has no reasoning_effort');
};
