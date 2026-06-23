const path = require('path');

exports.run = async (t, loadModule) => {
  const mod = await loadModule(path.resolve(__dirname, '../src/types.ts'));

  t.eq(mod.modelContextWindow('gpt-4.1'), 1000000, 'context: gpt-4.1 is 1M');
  t.eq(mod.modelContextWindow('gpt-4o'), 128000, 'context: gpt-4o is 128k');
  t.eq(mod.modelContextWindow('gpt-5.4'), 1000000, 'context: gpt-5.4 full is 1M');
  t.eq(mod.modelContextWindow('gpt-5.4-mini'), 400000, 'context: gpt-5.4 mini is 400k class');
  t.eq(mod.modelContextWindow('claude-sonnet-4-7'), 1000000, 'context: current Claude Sonnet tier is 1M');
  t.eq(mod.modelContextWindow('claude-sonnet-4-5'), 200000, 'context: Claude 4.5 fallback is 200k');
  t.eq(mod.modelContextWindow('gemini-2.5-pro'), 1048576, 'context: Gemini 2.5 input window');
  t.eq(mod.modelContextWindow('deepseek-v4.1-flash'), 1000000, 'context: DeepSeek V4 tier is 1M');
  t.eq(mod.modelContextWindow('deepseek-chat'), null, 'context: ambiguous DeepSeek aliases fall back');
  t.eq(mod.modelContextWindow('qwen3-max'), 262144, 'context: Qwen3-Max is 262144');
  t.eq(mod.modelContextWindow('qwen-plus-latest'), 1000000, 'context: Qwen Plus long-context tier');
};
