const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/prompt_snapshot.ts'));
  const message = { role: 'user', content: '原始问题' };
  mod.captureUserPromptSnapshot(
    message,
    '解释这篇 PDF',
    '<response-language target="zh">中文</response-language>\n<context>PDF text</context>\n解释这篇 PDF',
  );
  t.eq(message.displayContent, '解释这篇 PDF', 'prompt snapshot preserves concise user-authored display text');
  t.ok(message.content.includes('<context>PDF text</context>'), 'prompt snapshot preserves exact model-facing attachment context');
  t.eq(mod.visibleUserContent(message), '解释这篇 PDF', 'UI/export helper never exposes internal prompt blocks');
  t.eq(mod.visibleUserContent({ role: 'user', content: 'legacy' }), 'legacy', 'legacy messages fall back to canonical content');
  t.throws(
    () => mod.captureUserPromptSnapshot({ role: 'assistant', content: 'x' }, 'x', 'x'),
    'assistant messages cannot receive user prompt snapshots',
  );
};
