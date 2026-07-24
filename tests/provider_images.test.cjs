const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/providers/custom_api.ts'));
  const messages = mod.buildOpenAICompatibleMessages({
    systemPrompt: 'system',
    messages: [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call-1', name: 'view_image', args: { path: 'a.png' } },
          { id: 'call-2', name: 'read_note', args: { path: 'a.md' } },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'call-1',
        content: 'image result',
        toolContentBlocks: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'document', name: 'pages-2-3.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' } },
        ],
      },
      { role: 'tool', toolCallId: 'call-2', content: 'note result' },
      { role: 'assistant', content: 'I inspected both.' },
      { role: 'user', content: 'continue' },
    ],
    attachedImages: [{ dataUri: 'data:image/jpeg;base64,BBBB', name: 'new.jpg' }],
  });

  t.eq(messages.map(message => message.role), ['system', 'assistant', 'tool', 'tool', 'user', 'assistant', 'user'], 'tool images are hoisted only after the complete tool-result group');
  t.eq(messages[4].content[1].image_url.url, 'data:image/png;base64,AAAA', 'rich tool image becomes an OpenAI image_url part');
  t.eq(messages[4].content[2].file.file_data, 'data:application/pdf;base64,JVBERg==', 'native PDF tool result becomes an OpenAI file part');
  t.eq(messages[6].content[1].image_url.url, 'data:image/jpeg;base64,BBBB', 'latest user attachment remains on the latest user message');
  t.eq(messages[1].tool_calls.length, 2, 'assistant tool-call structure is preserved');

  const started = mod.mergeAnthropicStreamUsage(undefined, {
    type: 'message_start',
    message: { usage: { input_tokens: 321, cache_read_input_tokens: 120 } },
  });
  const completed = mod.mergeAnthropicStreamUsage(started, {
    type: 'message_delta',
    usage: { output_tokens: 45 },
  });
  t.eq(completed, { input_tokens: 321, cache_read_input_tokens: 120, output_tokens: 45 },
    'Anthropic stream usage keeps message_start input tokens when message_delta adds output tokens');
};
