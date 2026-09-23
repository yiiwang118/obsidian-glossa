const path = require('path');

exports.run = async function(t, loadModule) {
  const config = await loadModule(path.join(__dirname, '../src/providers/custom_api_config.ts'));
  for (const baseUrl of [
    'https://api.minimax.io/anthropic',
    'https://api.minimax.io/anthropic/',
    'https://api.minimax.io/anthropic/v1',
    'https://api.minimax.io/anthropic/v1///',
    'https://api.minimax.io/anthropic/v1/messages',
  ]) {
    const endpoint = { baseUrl, apiStyle: 'anthropic' };
    t.eq(config.customApiUrl(endpoint), 'https://api.minimax.io/anthropic/v1/messages', `Messages URL: ${baseUrl}`);
    t.eq(config.customApiUrl(endpoint, 'models'), 'https://api.minimax.io/anthropic/v1/models', `models URL: ${baseUrl}`);
  }
  t.eq(config.customApiUrl({ baseUrl: 'https://api.anthropic.com', apiStyle: 'anthropic' }), 'https://api.anthropic.com/v1/messages', 'bare Anthropic host uses v1');
  t.eq(config.customApiUrl({ baseUrl: 'https://gateway.example/custom/messages', apiStyle: 'anthropic' }), 'https://gateway.example/custom/messages', 'explicit legacy non-versioned route remains possible');
  t.eq(config.customApiUrl({ baseUrl: 'https://gateway.example/v2?region=test#fragment', apiStyle: 'anthropic' }), 'https://gateway.example/v2/messages?region=test', 'versioned gateway preserves query and drops fragment');
  t.eq(config.customApiUrl({ baseUrl: 'https://api.example/v1/' }), 'https://api.example/v1/chat/completions', 'OpenAI URL behavior stays versioned');
  t.eq(config.customApiUrl({ baseUrl: 'https://api.example/v1/' }, 'models'), 'https://api.example/v1/models', 'OpenAI discovery unchanged');
  t.throws(() => config.customApiUrl({ baseUrl: 'file:///tmp/foo' }), 'non-HTTP URL is rejected');
  t.eq(config.parseExtraBody(' '), {}, 'empty field removes parameters');
  const parameters = { thinking: { type: 'disabled' }, reasoning_split: true, temperature: 0.2, max_tokens: 16000 };
  t.eq(config.parseExtraBody(JSON.stringify(parameters)), parameters, 'nested provider parameters round-trip');
  for (const invalid of ['null', '[]', 'true', '42', '"text"', '{']) {
    t.throws(() => config.parseExtraBody(invalid), `reject invalid object: ${invalid}`);
  }
  for (const key of ['model', 'messages', 'system', 'stream', 'stream_options', 'tools', 'tool_choice', '__proto__', 'constructor', 'prototype']) {
    t.throws(() => config.parseExtraBody(`{"${key}":{}}`), `reject reserved ${key}`);
  }
  const generated = { model: 'test-model', messages: [{ role: 'user', content: 'translate' }], stream: false, thinking: { type: 'enabled', budget_tokens: 4000 } };
  const merged = config.customApiBody({ extraBody: parameters }, generated);
  t.eq(merged.thinking, { type: 'disabled' }, 'thinking override replaces entire object, not a deep merge');
  t.eq(generated.thinking, { type: 'enabled', budget_tokens: 4000 }, 'merging does not mutate generated body');
  t.eq(config.customApiBody({}, generated), generated, 'legacy endpoint has unchanged body');
  t.throws(() => config.customApiBody({ extraBody: { stream: true } }, generated), 'runtime rejects reserved fields from hand-edited settings');

  const requests = [];
  const api = await loadModule(path.join(__dirname, '../src/providers/custom_api.ts'), {
    requestUrl: async request => {
      requests.push(request);
      const json = request.method === 'GET' ? { data: [{ id: 'MiniMax-M3' }] } : {
        content: [{ type: 'text', text: 'translated' }],
        choices: [{ message: { content: 'translated' } }],
      };
      return { status: 200, text: JSON.stringify(json), json };
    },
  });
  const originalFetch = window.fetch;
  const explicitThinkingProvider = new api.CustomApiProvider({ reasoningEffort: 'ultra', extraBody: { thinking: { type: 'disabled' } } });
  const explicitThinkingBody = { max_tokens: 512 };
  explicitThinkingProvider.applyAnthropicThinking(explicitThinkingBody);
  t.eq(explicitThinkingBody.max_tokens, 512, 'disabled thinking does not inherit a large automatic reasoning budget');
  window.fetch = async (url, init) => {
    requests.push({ url, ...init });
    const anthropic = url.includes('/messages');
    const data = anthropic
      ? 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"translated"}}\n\ndata: {"type":"message_stop"}\n\n'
      : 'data: {"choices":[{"delta":{"content":"translated"}}]}\n\ndata: [DONE]\n\n';
    return new Response(data, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    for (const apiStyle of ['openai', 'anthropic']) {
      for (const useObsidianFetch of [false, true]) {
        const endpoint = { id: 'mini', label: 'MiniMax', kind: 'custom-api', apiStyle, useObsidianFetch,
          baseUrl: apiStyle === 'anthropic' ? 'https://api.minimax.io/anthropic' : 'https://api.minimax.io/v1',
          apiKey: 'test-key', model: 'MiniMax-M3', reasoningEffort: 'low', extraBody: parameters };
        const provider = new api.CustomApiProvider(endpoint);
        const chunks = [];
        for await (const chunk of provider.stream({ messages: [{ role: 'user', content: 'translate this' }], maxTokens: 512 })) chunks.push(chunk);
        const request = requests.at(-1);
        const body = JSON.parse(request.body);
        const label = `${apiStyle}/${useObsidianFetch ? 'requestUrl' : 'stream'}`;
        t.eq(request.url, config.customApiUrl(endpoint), `${label} uses shared URL`);
        t.eq(body.thinking, { type: 'disabled' }, `${label} explicit thinking wins`);
        t.eq(body.reasoning_split, true, `${label} sends reasoning_split`);
        t.eq(body.max_tokens, 16000, `${label} explicit token cap wins`);
        t.eq(body.temperature, 0.2, `${label} explicit sampling wins`);
        t.eq(body.stream, !useObsidianFetch, `${label} retains transport mode`);
        t.eq(body.messages[0].content, 'translate this', `${label} retains conversation`);
        t.ok(chunks.some(chunk => chunk.type === 'final' && chunk.text === 'translated'), `${label} still parses response`);
        const models = await provider.listModels();
        t.eq(models, ['MiniMax-M3'], `${label} model discovery works`);
        t.eq(requests.at(-1).url, config.customApiUrl(endpoint, 'models'), `${label} discovery URL matches`);
        t.eq(requests.at(-1).body, undefined, `${label} GET discovery has no extra body`);
        const result = await provider.testConnect();
        t.eq(result.ok, true, `${label} connectivity works`);
        if (apiStyle === 'anthropic') {
          t.eq(requests.at(-1).url, config.customApiUrl(endpoint), 'Anthropic probe URL matches chat');
          t.eq(JSON.parse(requests.at(-1).body).thinking, { type: 'disabled' }, 'Anthropic probe sends provider parameters');
        }
      }
    }
  } finally {
    if (originalFetch === undefined) delete window.fetch;
    else window.fetch = originalFetch;
  }
};
