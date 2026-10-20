const path = require('path');

function sse(events) {
  const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

exports.run = async function run(t, loadModule) {
  const catalog = await loadModule(path.join(__dirname, '../src/providers/reasoning_catalog.ts'));
  const customApi = await loadModule(path.join(__dirname, '../src/providers/custom_api.ts'));
  const api = (baseUrl, model, extra = {}) => ({ id: 'ep', label: 'Endpoint', kind: 'custom-api', baseUrl, apiKey: 'k', model, apiStyle: 'openai', ...extra });
  const values = profile => profile.entries.map(entry => entry.value);
  const defaults = profile => profile.entries.filter(entry => entry.isDefault).map(entry => entry.value);
  const body = (ep, start = { temperature: 0.7 }) => { const b = { ...start }; new customApi.CustomApiProvider(ep).applyOpenAIReasoning(b); return b; };

  // ---- Official hosts are recognised; gateways stay third party ----
  t.eq(catalog.officialProvider(api('https://api.openai.com/v1', 'gpt-5.5')), 'openai', 'OpenAI host');
  t.eq(catalog.officialProvider(api('https://api.deepseek.com/v1', 'deepseek-flash')), 'deepseek', 'DeepSeek host');
  t.eq(catalog.officialProvider(api('https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.6-plus')), 'qwen', 'DashScope host');
  t.eq(catalog.officialProvider(api('https://api.z.ai/api/paas/v4', 'glm-5.3')), 'glm', 'Z.ai host');
  t.eq(catalog.officialProvider(api('https://api.moonshot.ai/v1', 'kimi-k3')), 'kimi', 'Moonshot global host');
  t.eq(catalog.officialProvider(api('https://api.minimax.io/v1', 'MiniMax-M3')), 'minimax', 'MiniMax host');
  t.eq(catalog.officialProvider(api('https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-1-pro-260915')), 'doubao', 'Volcengine Ark host');
  t.eq(catalog.officialProvider(api('https://api.xiaomimimo.com/v1', 'mimo-v2.6-pro')), 'mimo', 'MiMo host');
  t.eq(catalog.officialProvider(api('https://api.anthropic.com/v1', 'claude-opus-5-5', { apiStyle: 'anthropic' })), 'anthropic', 'Anthropic Messages host');
  t.eq(catalog.officialProvider(api('https://api.anthropic.com/v1', 'claude-opus-5-5')), null, 'Anthropic OpenAI-compatibility layer stays pass-through');
  t.eq(catalog.officialProvider(api('https://open.bigmodel.cn/api/anthropic', 'glm-5.3', { apiStyle: 'anthropic' })), null, 'vendor Anthropic-format endpoints stay pass-through');
  t.eq(catalog.officialProvider(api('https://openrouter.ai/api/v1', 'openai/gpt-5.5')), null, 'gateways are third party');
  t.eq(catalog.officialProvider({ ...api('https://api.openai.com/v1', 'x'), kind: 'codex-cli' }), null, 'CLIs are not API providers');

  // ---- Third-party APIs keep every value, unchanged ----
  const gateway = catalog.reasoningProfile(api('https://relay.example.com/v1', 'gpt-5.5'));
  t.eq(values(gateway), ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'third-party list is complete');
  t.ok(gateway.allowCustom && gateway.provider === null, 'third party allows custom values');
  t.eq(body(api('https://relay.example.com/v1', 'gpt-5.5', { reasoningEffort: 'ultra' })).reasoning_effort, 'ultra', 'third party sends the value unchanged');
  t.eq(body(api('https://relay.example.com/v1', 'deepseek-v4', { label: 'DeepSeek relay', reasoningEffort: 'off' })).thinking, { type: 'disabled' }, 'third-party DeepSeek keeps the earlier thinking switch');

  // ---- OpenAI: per-model documented values ----
  const gpt55 = catalog.reasoningProfile(api('https://api.openai.com/v1', 'gpt-5.5'));
  t.eq(values(gpt55), ['none', 'low', 'medium', 'high', 'xhigh'], 'gpt-5.5 values');
  t.eq(defaults(gpt55), ['medium'], 'gpt-5.5 default is medium');
  t.eq(values(catalog.reasoningProfile(api('https://api.openai.com/v1', 'gpt-5'))), ['minimal', 'low', 'medium', 'high'], 'gpt-5 keeps minimal and has no none');
  t.eq(values(catalog.reasoningProfile(api('https://api.openai.com/v1', 'gpt-5.1'))), ['none', 'low', 'medium', 'high'], 'gpt-5.1 has no xhigh');
  t.eq(defaults(catalog.reasoningProfile(api('https://api.openai.com/v1', 'gpt-5.4'))), ['none'], 'gpt-5.4 defaults to none');
  t.eq(values(catalog.reasoningProfile(api('https://api.openai.com/v1', 'gpt-6-sol'))), ['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'GPT-6 Sol accepts none through max');
  t.eq(values(catalog.reasoningProfile(api('https://api.openai.com/v1', 'gpt-6.1-sol'))), ['low', 'medium', 'high', 'xhigh', 'max'], 'GPT-6.1 Sol always reasons');
  t.eq(values(catalog.reasoningProfile(api('https://api.openai.com/v1', 'o3'))), ['low', 'medium', 'high'], 'o3 values');
  const gpt41 = catalog.reasoningProfile(api('https://api.openai.com/v1', 'gpt-4.1'));
  t.ok(gpt41.entries.length === 0 && !!gpt41.note, 'non-reasoning models show no choices');
  const future = catalog.reasoningProfile(api('https://api.openai.com/v1', 'gpt-7-nova'));
  t.ok(!future.known && future.allowCustom && values(future).includes('minimal'), 'unknown OpenAI models offer documented values and custom input');
  t.eq(catalog.selectedReasoningEntry(gpt55, 'max').value, 'xhigh', 'undocumented max maps to the strongest documented level');
  t.eq(catalog.selectedReasoningEntry(gpt55, 'minimal').value, 'low', 'minimal never silently turns reasoning off');
  t.eq(catalog.selectedReasoningEntry(gpt55, 'off').value, 'medium', 'omitted effort is shown as the documented default');
  const sent = body(api('https://api.openai.com/v1', 'gpt-5.5', { reasoningEffort: 'high' }), { temperature: 0, max_tokens: 900 });
  t.eq([sent.reasoning_effort, sent.temperature, sent.max_tokens, sent.max_completion_tokens], ['high', undefined, undefined, 900], 'reasoning models drop temperature and use max_completion_tokens');
  const noReasoning = body(api('https://api.openai.com/v1', 'gpt-5.4', { reasoningEffort: 'off' }));
  t.eq([noReasoning.reasoning_effort, noReasoning.temperature], [undefined, 0.7], 'gpt-5.4 at its none default keeps temperature');
  t.eq(body(api('https://api.openai.com/v1', 'gpt-4.1', { reasoningEffort: 'high' })), { temperature: 0.7 }, 'non-reasoning OpenAI models get no reasoning parameter');

  // ---- DeepSeek ----
  const deepseek = api('https://api.deepseek.com', 'deepseek-flash');
  const ds = catalog.reasoningProfile(deepseek);
  t.eq(values(ds), ['off', 'low', 'high', 'max'], 'DeepSeek offers off, low, high, max');
  t.eq(defaults(ds), ['high'], 'DeepSeek default is high');
  t.eq(body({ ...deepseek, reasoningEffort: 'off' }).thinking, { type: 'disabled' }, 'DeepSeek off still switches thinking off');
  t.eq(body({ ...deepseek, reasoningEffort: undefined }), { temperature: 0.7 }, 'unset DeepSeek effort leaves its high default to the server');
  const dsHigh = body({ ...deepseek, reasoningEffort: 'high' });
  t.eq([dsHigh.thinking, dsHigh.reasoning_effort], [{ type: 'enabled' }, 'high'], 'explicit DeepSeek effort switches thinking on');
  t.eq(body({ ...deepseek, reasoningEffort: 'medium' }).reasoning_effort, 'high', 'DeepSeek alias: medium is high');
  t.eq(body({ ...deepseek, reasoningEffort: 'xhigh' }).reasoning_effort, 'high', 'DeepSeek alias: xhigh is high');
  t.eq(body({ ...deepseek, reasoningEffort: 'ultra' }).reasoning_effort, 'max', 'DeepSeek alias: ultra is max');
  t.ok(catalog.requiresReasoningReplay(deepseek), 'DeepSeek tool conversations send reasoning back');
  t.ok(catalog.requiresReasoningReplay(api('https://relay.example.com/v1', 'deepseek-ai/DeepSeek-V4-Pro')), 'DeepSeek V4 on other hosts sends reasoning back');
  t.ok(!catalog.requiresReasoningReplay(api('https://api.openai.com/v1', 'gpt-5.5')), 'OpenAI does not receive reasoning_content');

  // ---- Qwen, GLM, Kimi, MiniMax, Doubao, MiMo, Gemini, xAI ----
  const qwen = api('https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.6-plus');
  t.eq(catalog.reasoningProfile(qwen).entries.map(e => [e.kind, !!e.isDefault]), [['disable', false], ['enable', true]], 'Qwen 3.6 is a switch, on by default');
  t.eq(body({ ...qwen, reasoningEffort: 'none' }).enable_thinking, false, 'Qwen off sends enable_thinking=false');
  t.eq(body({ ...qwen, reasoningEffort: 'high' }).enable_thinking, true, 'Qwen on sends enable_thinking=true');
  t.eq(body({ ...qwen, reasoningEffort: 'off' }), { temperature: 0.7 }, 'Qwen default sends nothing');
  t.eq(defaults(catalog.reasoningProfile({ ...qwen, model: 'qwen-plus' })), ['none'], 'qwen-plus thinks only when asked');
  t.ok(catalog.reasoningProfile({ ...qwen, model: 'qwq-plus' }).alwaysThinks, 'QwQ always thinks');
  const glm53 = api('https://open.bigmodel.cn/api/paas/v4', 'glm-5.3');
  t.eq(values(catalog.reasoningProfile(glm53)), ['low', 'high', 'max'], 'GLM-5.3 values');
  t.eq(body({ ...glm53, reasoningEffort: 'none' }).reasoning_effort, 'low', 'GLM-5.3 cannot switch thinking off; the lightest level is used');
  t.eq(body({ ...glm53, model: 'glm-5.2', reasoningEffort: 'none' }).thinking, { type: 'disabled' }, 'GLM-5.2 can switch thinking off');
  t.eq(body({ ...glm53, model: 'glm-5.1', reasoningEffort: 'high' }).thinking, { type: 'enabled' }, 'GLM-5.1 is an on/off switch');
  const kimi = api('https://api.moonshot.cn/v1', 'kimi-k3', { reasoningEffort: 'low' });
  const kimiBody = body(kimi);
  t.eq([kimiBody.reasoning_effort, kimiBody.temperature, kimiBody.thinking], ['low', undefined, undefined], 'Kimi K3 uses reasoning_effort and its fixed temperature');
  t.eq(body({ ...kimi, model: 'kimi-k2.6', reasoningEffort: 'none' }).thinking, { type: 'disabled' }, 'Kimi K2.6 switches thinking off');
  const minimax = body(api('https://api.minimax.io/v1', 'MiniMax-M3.1-Flash', { reasoningEffort: 'xhigh' }));
  t.eq([minimax.reasoning_effort, minimax.reasoning_split], ['xhigh', true], 'MiniMax M3.1 Flash effort with reasoning kept out of the answer text');
  t.eq(body(api('https://api.minimax.io/v1', 'MiniMax-M3', { reasoningEffort: 'high' })).thinking, { type: 'adaptive' }, 'MiniMax M3 switch on is adaptive');
  t.eq(body(api('https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-1-pro-260915', { reasoningEffort: 'minimal' })).reasoning_effort, 'minimal', 'Doubao minimal means no thinking');
  t.eq(defaults(catalog.reasoningProfile(api('https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-0-pro-260215'))), ['medium'], 'Doubao Seed 2.0 default is medium');
  t.eq(body(api('https://api.xiaomimimo.com/v1', 'mimo-v2.6-flash', { reasoningEffort: 'none' })).thinking, { type: 'disabled' }, 'MiMo switches thinking off');
  t.eq(values(catalog.reasoningProfile(api('https://generativelanguage.googleapis.com/v1beta/openai/', 'gemini-3-flash'))), ['minimal', 'low', 'medium', 'high'], 'Gemini 3 Flash levels');
  t.eq(values(catalog.reasoningProfile(api('https://api.x.ai/v1', 'grok-4.7'))), ['low', 'medium', 'high', 'xhigh'], 'Grok 4.7 levels');
  t.ok(catalog.reasoningProfile(api('https://api.x.ai/v1', 'grok-4')).entries.length === 0, 'grok-4 accepts no reasoning effort');

  // ---- Anthropic Messages API ----
  const claude = model => api('https://api.anthropic.com', model, { apiStyle: 'anthropic' });
  const thinking = (ep, streaming = true) => { const b = { max_tokens: 4096 }; new customApi.CustomApiProvider(ep).applyAnthropicThinking(b, streaming); return b; };
  t.eq(values(catalog.reasoningProfile(claude('claude-opus-5-5'))), ['low', 'medium', 'high', 'xhigh', 'max'], 'Opus 5.5 cannot switch thinking off');
  const opus55 = thinking(claude('claude-opus-5-5'));
  t.eq([opus55.thinking, opus55.output_config, opus55.max_tokens], [{ type: 'adaptive', display: 'summarized' }, undefined, 64000], 'Opus 5.5 default thinks with readable summaries and room to answer');
  const opus48 = thinking({ ...claude('claude-opus-4-8'), reasoningEffort: 'xhigh' });
  t.eq([opus48.thinking.type, opus48.output_config.effort, opus48.budget_tokens], ['adaptive', 'xhigh', undefined], 'Opus 4.8 effort uses adaptive thinking, never budget_tokens');
  t.eq(thinking({ ...claude('claude-opus-4-8'), reasoningEffort: 'off' }), { max_tokens: 4096 }, 'Opus 4.8 default sends no thinking');
  t.eq(thinking({ ...claude('claude-sonnet-5-5'), reasoningEffort: 'none' }).thinking, { type: 'between_tools' }, 'Sonnet 5.5 off is between_tools');
  t.eq(thinking({ ...claude('claude-opus-5'), reasoningEffort: 'none' }).thinking, { type: 'disabled' }, 'Opus 5 off is disabled');
  t.eq(thinking({ ...claude('claude-opus-4-6'), reasoningEffort: 'xhigh' }).output_config.effort, 'high', 'xhigh means high on Opus 4.6');
  const sonnet45 = thinking({ ...claude('claude-sonnet-4-5'), reasoningEffort: 'high' });
  t.eq([sonnet45.thinking, sonnet45.max_tokens], [{ type: 'enabled', budget_tokens: 16000 }, 24000], 'Sonnet 4.5 keeps a thinking budget below its output limit');
  t.eq(thinking({ ...claude('claude-opus-5-5'), reasoningEffort: 'high' }, false).max_tokens, 32000, 'non-streaming requests leave less output room');
  const customClaude = thinking({ ...claude('claude-opus-4-8'), customReasoningEffort: 'max' });
  t.eq([customClaude.thinking.type, customClaude.output_config.effort], ['adaptive', 'max'], 'custom effort on official Claude still enables adaptive thinking');

  // ---- Anthropic streaming: reasoning text, thinking blocks and replay ----
  const originalFetch = window.fetch;
  const requests = [];
  try {
    window.fetch = async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return sse([
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Check the note first.' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-1' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'read_note' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"A.md"}' } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
      ]);
    };
    const provider = new customApi.CustomApiProvider({ ...claude('claude-opus-5-5'), reasoningEffort: 'high' });
    const chunks = await collect(provider.stream({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'read A' }], tools: [{ name: 'read_note', description: 'read', parameters: { type: 'object' } }] }));
    t.eq(chunks.filter(c => c.type === 'reasoning').map(c => c.text).join(''), 'Check the note first.', 'summarized thinking streams as reasoning');
    const final = chunks.find(c => c.type === 'final');
    t.eq(final.thinkingBlocks, [{ type: 'thinking', thinking: 'Check the note first.', signature: 'sig-1' }], 'thinking block is kept with its signature');
    t.eq([requests[0].thinking.type, requests[0].output_config.effort], ['adaptive', 'high'], 'request carries adaptive thinking and effort');
    await collect(provider.stream({ systemPrompt: 'sys', tools: [], messages: [
      { role: 'user', content: 'read A' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tool-1', name: 'read_note', args: { path: 'A.md' } }], thinkingBlocks: final.thinkingBlocks },
      { role: 'tool', toolCallId: 'tool-1', content: 'A' },
    ] }));
    t.eq(requests[1].messages[1].content.map(block => block.type), ['thinking', 'tool_use'], 'thinking blocks precede the tool_use they belong to');
    t.eq(requests[1].messages[1].content[0].signature, 'sig-1', 'replayed block is unchanged');
  } finally {
    window.fetch = originalFetch;
  }

  // ---- CLI: the CLI's own catalog decides ----
  const cli = { id: 'cli', label: 'Codex', kind: 'codex-cli', model: '', cliModels: [
    { id: 'gpt-5.5-codex', label: 'Codex', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium', isDefault: true },
    { id: 'gpt-5.5-mini', label: 'Mini', efforts: ['low', 'high'] },
  ] };
  const unset = catalog.reasoningProfile(cli);
  t.eq(values(unset), ['off'], 'no model chosen: the CLI configuration decides, efforts are not guessed');
  t.ok(unset.needsModel && !unset.allowCustom, 'the menu points to choosing a model instead');
  const codex = catalog.reasoningProfile({ ...cli, model: 'gpt-5.5-codex' });
  t.eq(values(codex), ['off', 'low', 'medium', 'high', 'xhigh'], 'chosen CLI model lists its efforts');
  t.eq(defaults(codex), ['medium'], 'CLI default effort is marked');
  t.ok(!codex.allowCustom, 'CLI catalog replaces free-form effort');
  t.eq(values(catalog.reasoningProfile({ ...cli, model: 'gpt-5.5-mini' })), ['off', 'low', 'high'], 'selected CLI model decides');
  t.ok(catalog.reasoningProfile({ ...cli, cliModels: [] }).allowCustom, 'without a catalog the CLI keeps custom input');

  // ---- Translation and completion use the lightest effort each API accepts ----
  const gemini = api('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3-pro');
  const relay = api('https://openrouter.ai/api/v1', 'openai/gpt-5.5', { reasoningEffort: 'high' });
  t.eq(catalog.lightestReasoningEffort(api('https://api.deepseek.com', 'deepseek-flash', { reasoningEffort: 'high' })), 'off', 'DeepSeek switches thinking off');
  t.eq(catalog.lightestReasoningEffort(api('https://api.openai.com/v1', 'gpt-5.5', { reasoningEffort: 'high' })), 'none', 'OpenAI uses effort none');
  t.eq(catalog.lightestReasoningEffort(gemini), 'low', 'a model that cannot stop thinking gets its lowest level');
  t.eq(catalog.lightestReasoningEffort(relay), 'off', 'third-party endpoints get nothing extra');
  t.eq(catalog.lightestReasoningEffort({ ...cli, model: 'gpt-5.5-mini' }), 'low', 'CLIs use their lowest listed effort');
  t.ok(catalog.reasoningRemainsOn(api('https://api.openai.com/v1', 'gpt-5.5', { reasoningEffort: 'high' })), 'an official model at high effort still thinks');
  t.ok(!catalog.reasoningRemainsOn(api('https://api.openai.com/v1', 'gpt-5.5', { reasoningEffort: 'none' })), 'effort none does not');
  t.ok(catalog.reasoningRemainsOn({ ...gemini, reasoningEffort: 'low' }), 'the lowest Gemini level still thinks, so answers get room for it');
  t.ok(!catalog.reasoningRemainsOn(relay), 'unknown endpoints are not assumed to think');

  // ---- Temperature: auto, a fixed value, or left out ----
  t.eq(catalog.requestTemperature({ model: 'gpt-4.1' }, undefined), 0.7, 'auto keeps the 0.7 default');
  t.eq(catalog.requestTemperature({ model: 'deepseek-flash' }, 0.2), 0.2, 'a requested value is kept');
  t.eq(catalog.requestTemperature({ model: 'gpt-5.5' }, 0.2), undefined, 'reasoning models that reject temperature get none');
  t.eq(catalog.requestTemperature({ model: 'openai/o4-mini' }, 0.2), undefined, 'a gateway prefix does not hide the model');
  t.eq(catalog.requestTemperature({ model: 'gpt-5-chat-latest' }, 0.2), 0.2, 'chat variants accept temperature');
  t.eq(catalog.requestTemperature({ model: 'kimi-k3' }, 0.2), undefined, 'Kimi K2.5 and later set their own temperature');
  t.eq(catalog.requestTemperature({ model: 'kimi-k2-0905' }, 0.2), 0.2, 'older Kimi models accept it');
  t.eq(catalog.requestTemperature({ model: 'gpt-5.5', temperature: 1 }, 0.2), 1, 'a temperature set on the endpoint is always sent');
  t.eq(catalog.requestTemperature({ model: 'gpt-4.1', temperature: 'omit' }, 0.2), undefined, '"off" leaves temperature out');
};
