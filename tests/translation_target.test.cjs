const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/translation_target.ts'));

  const mixedChineseMarkdown = [
    '- [Switch Transformers (Google)](https://huggingface.co/collections/google/switch-transformers-release-6548c35c6507968374b56d1f): 基于 T5 v的 MoE 集合，专家数量从 8 名到 2048 名。最大的模型有 1.6 万亿个参数。',
    '- [NLLB MoE (Meta)](https://huggingface.co/facebook/nllb-moe-54b): NLLB 翻译模型的一个 MoE 变体。',
    '- [OpenMoE](https://huggingface.co/fuzhao): 社区对基于 Llama 的模型的 MoE 尝试。',
    '- [Mixtral 8x7B (Mistral)](https://huggingface.co/mistralai): 一个性能超越了 Llama 2 70B 的高质量混合专家模型，并且具有更快的推理速度。此外，还发布了一个经过指令微调的模型。',
  ].join('\n');

  t.eq(
    mod.inferSelectionLanguage(mixedChineseMarkdown),
    'zh',
    'markdown links and model names do not overpower Chinese prose',
  );
  t.eq(
    mod.inferSelectionTranslationTarget(mixedChineseMarkdown, 'zh'),
    'English',
    'Chinese-dominant mixed markdown translates to English',
  );

  const englishPaperText = 'Switch Transformers scale T5 with sparse expert routing. The model activates only a small subset of experts for each token, which improves training efficiency without increasing inference cost proportionally.';
  t.eq(
    mod.inferSelectionTranslationTarget(englishPaperText, 'zh'),
    'Chinese',
    'English prose in Chinese UI translates to Chinese',
  );

  const chineseText = '这是一段中文说明，其中夹杂 Mixtral、MoE 和 HuggingFace 这样的技术名词。';
  t.eq(
    mod.inferSelectionTranslationTarget(chineseText, 'zh'),
    'English',
    'Chinese prose with English technical terms translates to English',
  );

  const urlOnly = '[Mixtral 8x7B](https://huggingface.co/mistralai)';
  t.eq(
    mod.inferSelectionTranslationTarget(urlOnly, 'zh'),
    'Chinese',
    'ambiguous link-only selection falls back to UI language',
  );
};
