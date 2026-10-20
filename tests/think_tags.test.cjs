const path = require('path');

function sse(events) {
  const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

exports.run = async (t, load) => {
  const { ThinkTagSplitter, splitThinkTags } = await load(path.resolve(__dirname, '../src/utils/think_tags.ts'));
  const split = chunks => {
    const splitter = new ThinkTagSplitter();
    const out = { text: '', reasoning: '' };
    for (const chunk of [...chunks.map(c => splitter.push(c)), splitter.flush()]) {
      out.text += chunk.text;
      out.reasoning += chunk.reasoning;
    }
    return out;
  };

  t.eq(split(['<think>plan</think>Answer']), { text: 'Answer', reasoning: 'plan' }, 'a leading think block is reasoning');
  t.eq(split(['<thi', 'nk>pl', 'an</th', 'ink>', '\n\nAnswer']), { text: 'Answer', reasoning: 'plan' }, 'tags split across chunks are recognised');
  t.eq(split(['<thinking>a</thinking>', '<reasoning>b</reasoning>Final']), { text: 'Final', reasoning: 'ab' }, 'thinking and reasoning tags, one after another');
  t.eq(split(['  \n<think>x</think>y']), { text: 'y', reasoning: 'x' }, 'whitespace before the tag is allowed');
  t.eq(split(['<think>a</b', 'c</think>Y']), { text: 'Y', reasoning: 'a</bc' }, 'a partial closing tag that is not one stays reasoning');
  t.eq(split(['<think>stopped while thinking']), { text: '', reasoning: 'stopped while thinking' }, 'an unclosed block stays reasoning');
  t.eq(split(['<think>r</think>', '\n\n']), { text: '', reasoning: 'r' }, 'whitespace after reasoning alone is no answer');
  t.eq(split(['The tag <think> is mentioned later.']), { text: 'The tag <think> is mentioned later.', reasoning: '' }, 'tags after the start of the answer stay text');
  t.eq(split(['<thi']), { text: '<thi', reasoning: '' }, 'a lone partial tag at the end is text');
  t.eq(split(['\n\nPlain']), { text: '\n\nPlain', reasoning: '' }, 'an answer without reasoning is left as it is');
  t.eq(splitThinkTags('<think>r</think>\n\nA'), { text: 'A', reasoning: 'r' }, 'whole answers are split too');

  const customApi = await load(path.resolve(__dirname, '../src/providers/custom_api.ts'));
  const local = { id: 'ep', label: 'Local', kind: 'custom-api', baseUrl: 'http://localhost:1234/v1', apiKey: 'k', model: 'qwen3', apiStyle: 'openai' };
  const originalFetch = window.fetch;
  try {
    window.fetch = async () => sse([
      { choices: [{ delta: { content: '<thi' } }] },
      { choices: [{ delta: { content: 'nk>Check sources.</th' } }] },
      { choices: [{ delta: { content: 'ink>\n\nThe answer.' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 4 } },
    ]);
    const chunks = await collect(new customApi.CustomApiProvider(local).stream({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'q' }] }));
    const final = chunks.find(c => c.type === 'final');
    t.eq(chunks.filter(c => c.type === 'text').map(c => c.text).join(''), 'The answer.', 'streamed text leaves out the think block');
    t.eq(chunks.filter(c => c.type === 'reasoning').map(c => c.text).join(''), 'Check sources.', 'the streamed think block goes to reasoning');
    t.eq([final.text, final.reasoningContent], ['The answer.', 'Check sources.'], 'the saved answer and reasoning are separate');

    window.fetch = async () => sse([
      { choices: [{ delta: { reasoning: 'Routed thought.' } }] },
      { choices: [{ delta: { content: 'Done.' } }] },
    ]);
    const routed = await collect(new customApi.CustomApiProvider(local).stream({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'q' }] }));
    t.eq(routed.find(c => c.type === 'final').reasoningContent, 'Routed thought.', 'the `reasoning` field (OpenRouter, Ollama) is reasoning');
  } finally {
    window.fetch = originalFetch;
  }

  const whole = await load(path.resolve(__dirname, '../src/providers/custom_api.ts'), {
    requestUrl: async () => ({ status: 200, text: '', json: { choices: [{ message: { content: '<think>Weigh it.</think>\n\nResult.' } }] } }),
  });
  const once = await collect(new whole.CustomApiProvider({ ...local, useObsidianFetch: true }).stream({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'q' }] }));
  const onceFinal = once.find(c => c.type === 'final');
  t.eq([onceFinal.text, onceFinal.reasoningContent], ['Result.', 'Weigh it.'], 'non-streaming answers are split the same way');
};
