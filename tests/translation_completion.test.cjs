const path = require('path');

exports.run = async function(t, loadModule) {
  const endpoint = {
    id: 'minimax', label: 'MiniMax', kind: 'custom-api', apiStyle: 'anthropic',
    baseUrl: 'https://api.example.com/v1', apiKey: 'test-key', model: 'MiniMax-M3',
  };
  let response;
  const requests = [];
  const requestUrl = async request => {
    requests.push(JSON.parse(request.body));
    return { status: 200, json: response };
  };
  const { CustomApiProvider } = await loadModule(path.resolve(__dirname, '../src/providers/custom_api.ts'), { requestUrl });
  const originalFetch = window.fetch;
  const collect = async provider => {
    const chunks = [];
    for await (const chunk of provider.stream({ messages: [{ role: 'user', content: 'Hello' }], maxTokens: 16384, model: 'MiniMax-M2.7-highspeed' })) chunks.push(chunk);
    return chunks;
  };
  try {
    for (const useObsidianFetch of [false, true]) {
      for (const blockType of ['thinking', 'redacted_thinking', 'none']) {
        for (const stopReason of ['max_tokens', 'end_turn']) {
          for (const text of ['', '你好']) {
            response = {
              content: [
                ...(blockType === 'none' ? [] : [{ type: blockType, thinking: 'private reasoning', data: 'redacted' }]),
                ...(text ? [{ type: 'text', text }] : []),
              ],
              stop_reason: stopReason, usage: { input_tokens: 12, output_tokens: 512 },
            };
            window.fetch = async (_url, init) => {
              requests.push(JSON.parse(init.body));
              const events = [
                { type: 'message_start', message: { usage: { input_tokens: 12 } } },
                ...(blockType === 'none' ? [] : [{ type: 'content_block_start', index: 0, content_block: { type: blockType } }]),
                ...(blockType === 'thinking' ? [{ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'private reasoning' } }] : []),
                ...(text ? [{ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } }] : []),
                { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 512 } },
                { type: 'message_stop' },
              ];
              const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
              return new Response(new ReadableStream({ start(controller) {
                // Exercise event lines and Unicode split across transport chunks.
                for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
                controller.close();
              } }));
            };
            const chunks = await collect(new CustomApiProvider({ ...endpoint, useObsidianFetch }));
            const final = chunks.find(chunk => chunk.type === 'final');
            const label = `${useObsidianFetch ? 'non-stream' : 'stream'} ${blockType} ${stopReason} ${text ? 'text' : 'empty'}`;
            t.eq(final?.stopReason, stopReason, `${label}: preserves stop reason`);
            t.eq(final?.hasReasoning, blockType !== 'none', `${label}: preserves reasoning presence`);
            t.eq(final?.text, text, `${label}: returns only final answer text`);
            t.eq(final?.usage, { input: 12, output: 512 }, `${label}: retains usage`);
            t.ok(!JSON.stringify(chunks).includes('private reasoning'), `${label}: diagnostic metadata does not expose thinking`);
            t.eq(requests.at(-1).model, 'MiniMax-M2.7-highspeed', `${label}: request model overrides the endpoint default`);
          }
        }
      }
    }

    // Some compatible servers send thinking deltas without a block-start event.
    window.fetch = async () => new Response('data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"private"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n');
    t.eq((await collect(new CustomApiProvider(endpoint))).at(-1).hasReasoning, true, 'a thinking delta alone records reasoning presence');

    const selectionModule = await loadModule(path.resolve(__dirname, '../src/features/selection_translation.ts'), { requestUrl });
    for (const [model, text, stopReason, expectedError, maxTokens] of [
      ['MiniMax-M2.7-highspeed', '', 'max_tokens', 'while thinking', 16384],
      ['MiniMax-M2.7-highspeed', '', 'end_turn', 'only thinking', 16384],
      ['MiniMax-M2.7-highspeed', '部分译文', 'max_tokens', 'incomplete', 16384],
      ['MiniMax-M2.7-highspeed', '你好', 'end_turn', '', 16384],
      ['MiniMax-M3', '你好', 'end_turn', '', 512],
      ['claude-sonnet-4-6', '你好', 'end_turn', '', 512],
    ]) {
      const activeEndpoint = { ...endpoint, useObsidianFetch: true };
      const controller = new selectionModule.SelectionTranslationController({
        settings: { endpoints: [activeEndpoint], globalProxy: '' },
        getDecryptedEndpoint: async () => activeEndpoint,
      });
      controller.popup = {
        endpointId: endpoint.id, modelId: model, model: {}, status: {},
        root: { classList: { add() {}, remove() {} } },
      };
      let error = '';
      let painted = '';
      controller.renderModelButton = () => {};
      controller.showLoading = () => {};
      controller.scheduleTextPaint = () => {};
      controller.renderFinalMath = async () => {};
      controller.paintText = text => { painted = text; };
      controller.showError = message => { error = message; };
      response = {
        content: [{ type: 'thinking', thinking: 'private reasoning' }, ...(text ? [{ type: 'text', text }] : [])],
        stop_reason: stopReason,
      };
      const before = requests.length;
      await controller.runTranslation({ text: 'Hello' }, 'Chinese');
      t.eq(requests.length - before, 1, `${model} ${stopReason}: no redundant target-language retry`);
      t.eq(requests.at(-1).max_tokens, maxTokens, `${model}: selected model determines actual request budget`);
      t.eq(requests.at(-1).model, model, `${model}: selected model overrides endpoint model`);
      t.ok(expectedError ? error.includes(expectedError) : !error, `${model} ${stopReason}: completion status is surfaced`);
      t.eq(painted, expectedError ? '' : text, `${model} ${stopReason}: only complete translations finish rendering`);
    }
  } finally {
    window.fetch = originalFetch;
  }
};
