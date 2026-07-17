const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/features/selection_translation.ts'));

  const below = mod.selectionTranslationPosition(
    { left: 200, top: 100, right: 320, bottom: 124, width: 120, height: 24 },
    { width: 360, height: 180 },
    { width: 1000, height: 700 },
  );
  t.eq(below.placement, 'below', 'translation popup prefers space below the selection');
  t.eq(below.top, 134, 'translation popup keeps a stable selection gap');

  const above = mod.selectionTranslationPosition(
    { left: 900, top: 650, right: 980, bottom: 674, width: 80, height: 24 },
    { width: 420, height: 220 },
    { width: 1000, height: 700 },
  );
  t.eq(above.placement, 'above', 'translation popup moves above a bottom-edge selection');
  t.ok(above.left >= 12 && above.left + 420 <= 988, 'translation popup is clamped inside the viewport');

  const right = mod.selectionTranslationPosition(
    { left: 100, top: 100, right: 220, bottom: 600, width: 120, height: 500 },
    { width: 360, height: 300 },
    { width: 1000, height: 700 },
  );
  t.eq(right.placement, 'right', 'a tall multi-line selection places the popup beside the full selection');
  t.ok(right.left >= 230, 'side placement does not cover the selected text');

  const sparse = mod.selectionTranslationPosition(
    { left: 100, top: 100, right: 900, bottom: 600, width: 800, height: 500 },
    { width: 360, height: 300 },
    { width: 1000, height: 700 },
    [
      { left: 100, top: 100, right: 300, bottom: 120, width: 200, height: 20 },
      { left: 700, top: 580, right: 900, bottom: 600, width: 200, height: 20 },
    ],
  );
  t.eq(sparse.placement, 'below', 'popup placement scores actual selection lines instead of covering their bounding box');
  t.ok(sparse.left + 360 <= 700, 'popup stays clear of the visible selected line');

  const prompt = mod.buildSelectionTranslationPrompt('<ignore> CURE $x^2$', 'Chinese');
  t.ok(prompt.includes('Return only the translated text'), 'translation prompt forbids explanatory chatter');
  t.ok(prompt.includes(JSON.stringify('<ignore> CURE $x^2$')), 'selected text is encoded as inert JSON source material');
  t.ok(prompt.includes('standard Chinese technical translation'), 'Chinese prompt protects short technical terms');

  t.eq(mod.translationNeedsRetry('softmax-attention', 'softmax-attention', 'Chinese'), true, 'unchanged technical terms trigger one corrective retry');
  t.eq(mod.translationNeedsRetry('softmax-attention', 'softmax 注意力', 'Chinese'), false, 'Chinese technical translation passes target validation');
  t.eq(mod.translationNeedsRetry('强化学习', '强化学习', 'English'), true, 'unchanged Chinese output triggers an English retry');
  t.eq(mod.translationNeedsRetry('强化学习', 'reinforcement learning', 'English'), false, 'English translation passes target validation');

  t.eq(
    mod.normalizeTranslationOutput('测试时训练方法适用于多种测\n试实例，并取得成功。', 'Chinese'),
    '测试时训练方法适用于多种测试实例，并取得成功。',
    'PDF-style Chinese line wrapping is removed inside a sentence',
  );
  t.eq(
    mod.normalizeTranslationOutput('第一段。\n仍是第一段。\n\n第二段。', 'Chinese'),
    '第一段。仍是第一段。\n\n第二段。',
    'semantic blank-line paragraph breaks are preserved',
  );
  t.eq(
    mod.normalizeTranslationOutput('Test-time training updates\nmodel weights explicitly.', 'English'),
    'Test-time training updates model weights explicitly.',
    'English soft line wraps are joined with a space',
  );
  t.eq(
    mod.normalizeTranslationOutput('- 第一项\n- 第二项', 'Chinese'),
    '- 第一项\n- 第二项',
    'Markdown list boundaries are preserved',
  );

  const chatEndpoint = { id: 'fast', kind: 'custom-api', reasoningEffort: 'ultra' };
  const translationEndpoint = mod.prepareTranslationEndpoint(chatEndpoint);
  t.eq(
    translationEndpoint.reasoningEffort,
    'off',
    'quick translation disables endpoint reasoning to reduce first-token latency',
  );
  t.eq(chatEndpoint.reasoningEffort, 'ultra', 'translation optimization does not mutate the chat endpoint');

  const models = mod.translationModelsForEndpoint({
    model: 'deepseek-v4-pro',
    availableModels: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'],
  });
  t.eq(
    models,
    ['deepseek-v4-pro', 'deepseek-v4-flash'],
    'translation model picker includes configured and detected models without duplicates',
  );
};
