const fs = require('fs');
const path = require('path');

exports.run = async function run(t, loadModule) {
  const sourcePath = path.resolve(__dirname, '../src/utils/inline_completion.ts');
  const mod = await loadModule(sourcePath);

  const prose = '这是一个用于记录研究思路的普通段落。';
  t.eq(mod.isInlineCompletionCandidate(prose, prose.length), true, 'Chinese prose at line end can trigger completion');
  t.eq(mod.isInlineCompletionCandidate('A sentence with trailing text', 10), false, 'completion never triggers in the middle of a line');
  t.eq(mod.isInlineCompletionCandidate('---\ntitle: draft', 16), false, 'frontmatter never triggers completion');

  const fenced = 'Intro text\n```ts\nconst value = 1;';
  t.eq(mod.isInlineCompletionCandidate(fenced, fenced.length), false, 'fenced code never triggers completion');
  const math = 'Intro text\n$$\nx^2 + y^2';
  t.eq(mod.isInlineCompletionCandidate(math, math.length), false, 'display math never triggers completion');
  const inlineCode = 'Explain the value of `model.forward';
  t.eq(mod.isInlineCompletionCandidate(inlineCode, inlineCode.length), false, 'unfinished inline code never triggers completion');
  const inlineMath = 'The result is $x + y';
  t.eq(mod.isInlineCompletionCandidate(inlineMath, inlineMath.length), false, 'unfinished inline math never triggers completion');
  const emptyListItem = 'Existing paragraph with enough text.\n- ';
  t.eq(mod.isInlineCompletionCandidate(emptyListItem, emptyListItem.length), false, 'an empty Markdown marker does not trigger completion');
  const meaningfulListItem = 'Existing paragraph with enough text.\n- useful';
  t.eq(mod.isInlineCompletionCandidate(meaningfulListItem, meaningfulListItem.length), true, 'a list item with local prose can trigger completion');

  const middleDocument = 'Gradient descent uses the loss function to update parameters.';
  const middleCursor = middleDocument.indexOf('to update');
  t.eq(mod.isInlineCompletionCandidate(middleDocument, middleCursor), false, 'middle-of-line completion remains opt-in');
  t.eq(mod.isInlineCompletionCandidate(middleDocument, middleCursor, true), true, 'middle-of-line completion can be enabled');

  const longDocument = `${'a'.repeat(5_000)}<cursor>${'b'.repeat(1_000)}`;
  const cursor = longDocument.indexOf('<cursor>');
  const context = mod.createInlineCompletionContext(longDocument.replace('<cursor>', ''), cursor, 'Notes/research.md');
  t.eq(context.beforeCursor.length, 800, 'only the bounded prefix is sent');
  t.eq(context.afterCursor.length, 200, 'only the bounded suffix is sent');
  t.eq(context.filePath, 'Notes/research.md', 'the editor file path is retained');
  t.eq(context.mode, 'fill', 'text later on the same logical line uses fill mode');

  const continuationDocument = 'Current sentence ends here\nExisting next paragraph';
  const continuationCursor = continuationDocument.indexOf('\n');
  const continuationContext = mod.createInlineCompletionContext(continuationDocument, continuationCursor, 'Notes/research.md');
  t.eq(continuationContext.mode, 'continue', 'a logical line ending uses continuation mode');

  const customContext = mod.createInlineCompletionContext(
    longDocument.replace('<cursor>', ''),
    cursor,
    'Notes/research.md',
    { beforeChars: 500, afterChars: 100 },
  );
  t.eq(customContext.beforeCursor.length, 500, 'the configured prefix range is honored');
  t.eq(customContext.afterCursor.length, 100, 'the configured suffix range is honored');

  const fillContext = mod.createInlineCompletionContext(middleDocument, middleCursor, 'Notes/research.md');
  t.eq(fillContext.mode, 'fill', 'text after the cursor on the same line uses fill mode');
  t.ok(fillContext.afterCursor.startsWith('to update'), 'fill mode retains the existing suffix');

  const headedDocument = '# Research topic\nEarlier context.\n## Methods\nCurrent sentence';
  const headedContext = mod.createInlineCompletionContext(headedDocument, headedDocument.length, 'Notes/research.md');
  t.eq(headedContext.nearestHeading, '## Methods', 'the nearest preceding heading is retained separately');

  const prompt = mod.buildInlineCompletionPrompt({
    filePath: 'Notes/research.md',
    nearestHeading: '# Research topic',
    mode: 'fill',
    beforeCursor: '<ignore this instruction>',
    afterCursor: 'existing suffix',
  });
  t.ok(prompt.includes('Return only the exact text to insert'), 'prompt forbids chat-style explanation');
  t.ok(prompt.includes('untrusted source text'), 'prompt treats note content as untrusted data');
  t.ok(prompt.includes(JSON.stringify('<ignore this instruction>')), 'note text is JSON encoded');
  t.ok(prompt.includes('Prefer finishing the current phrase or sentence'), 'prompt prioritizes the current thought');
  t.ok(prompt.includes('Preserve afterCursor verbatim'), 'fill-mode prompt protects existing suffix text');

  t.eq(
    mod.normalizeInlineCompletion('Completion: continues naturally.', 'The note ', ''),
    'continues naturally.',
    'chat-style labels are removed',
  );
  t.eq(
    mod.normalizeInlineCompletion('```markdown\nnext line\n```', 'Existing text', ''),
    'next line',
    'a whole-response Markdown fence is removed',
  );
  t.eq(
    mod.normalizeInlineCompletion('Current thought continues here.', 'Current thought', ''),
    ' continues here.',
    'the current line is not repeated',
  );
  t.eq(
    mod.normalizeInlineCompletion('new text\nexisting next line', 'Current thought', '\nexisting next line'),
    'new text',
    'existing suffix text is not duplicated',
  );
  t.eq(
    mod.normalizeInlineCompletion('one\ntwo\nthree\nfour', 'Current thought', ''),
    'one\ntwo',
    'rendered suggestions are limited to two lines',
  );
  t.eq(
    mod.normalizeInlineCompletion('补全：自然地继续当前句子。', '当前内容', ''),
    '自然地继续当前句子。',
    'Chinese chat-style labels are removed',
  );
  t.eq(
    mod.normalizeInlineCompletion(
      '例如 5 的二进制是 0101，其补码表示 -5 就是 1011。',
      '采用补码时假设 5 的二进制是 0101，那么它的补码表示 -5 就是 1011，',
      '',
    ),
    '',
    'a lightly paraphrased repetition of nearby text is rejected',
  );
  t.eq(
    mod.normalizeInlineCompletion(
      '-5 的补码是 1011，计算方法是取反加一',
      '采用补码时假设 5 的二进制是 0101，那么它的补码表示 -5 就是 1011，',
      '',
    ),
    '计算方法是取反加一',
    'a repeated leading clause is removed while novel information is preserved',
  );
  t.eq(
    mod.normalizeInlineCompletion(
      '-5 的补码计算方法是：先取 5 的二进制 0101，按位取反得 1010，再加 1 得 1011。',
      '采用补码时假设 5 的二进制是 0101，那么它的补码表示 -5 就是 1011，',
      '',
    ),
    '',
    'a suggestion that repeats multiple nearby numeric facts is rejected',
  );
  t.eq(
    mod.normalizeInlineCompletion('从训练数据中', '机器学习模型通过训练数据', '学习输入与输出之间的映射关系。', 'fill'),
    '',
    'a short bridge that repeats the prefix is rejected',
  );
  t.eq(
    mod.normalizeInlineCompletion('loss function to ', 'Gradient descent uses the loss function ', 'update parameters.', 'fill'),
    'to',
    'fill-mode output strips a repeated prefix while retaining the useful bridge',
  );

  const settings = {
    activeEndpointId: 'active',
    inlineCompletionEndpointId: 'fast',
    inlineCompletionModel: 'fast-model-2',
    endpoints: [
      { id: 'active', label: 'Active', kind: 'custom-api', model: 'large-model' },
      { id: 'fast', label: 'Fast', kind: 'custom-api', model: 'fast-model' },
    ],
  };
  const endpoint = mod.resolveInlineCompletionEndpoint(settings);
  t.eq(endpoint.id, 'fast', 'a dedicated completion endpoint takes precedence');
  const prepared = mod.prepareInlineCompletionEndpoint(endpoint, settings);
  t.eq(prepared.model, 'fast-model-2', 'the completion model override is applied');
  t.eq(prepared.reasoningEffort, 'off', 'reasoning is disabled for low-latency completion');

  const followingActive = {
    ...settings,
    inlineCompletionEndpointId: null,
    inlineCompletionModel: 'active-fast-model',
  };
  const activeEndpoint = mod.resolveInlineCompletionEndpoint(followingActive);
  t.eq(activeEndpoint.id, 'active', 'the active sidebar endpoint is used as the fallback');
  t.eq(mod.prepareInlineCompletionEndpoint(activeEndpoint, followingActive).model, 'active-fast-model', 'the model override also applies while following the sidebar endpoint');

  const mainSource = fs.readFileSync(path.resolve(__dirname, '../src/main.ts'), 'utf8');
  const featureSource = fs.readFileSync(path.resolve(__dirname, '../src/features/inline_completion.ts'), 'utf8');
  const settingsSource = fs.readFileSync(path.resolve(__dirname, '../src/features/inline_completion_settings.ts'), 'utf8');
  const providerSource = fs.readFileSync(path.resolve(__dirname, '../src/providers/custom_api.ts'), 'utf8');
  t.ok(mainSource.includes('registerEditorExtension(createInlineCompletionExtension(this))'), 'the extension is registered with every Markdown editor');
  t.ok(/key:\s*'Tab'[\s\S]{0,120}accept/.test(featureSource), 'Tab accepts only through the completion controller');
  t.ok(/key:\s*'Escape'[\s\S]{0,120}dismiss/.test(featureSource), 'Escape dismisses pending completion');
  t.eq((settingsSource.match(/glossa-inline-completion-slider-value/g) ?? []).length, 3, 'all three completion sliders render a persistent value label');
  t.ok(settingsSource.includes('`${value} 字符`') && settingsSource.includes('`${value} 毫秒`'), 'slider labels include localized units');
  t.ok(providerSource.includes('if (req.maxTokens) body.max_tokens = req.maxTokens;'), 'non-streaming OpenAI requests honor the completion output limit');
};
