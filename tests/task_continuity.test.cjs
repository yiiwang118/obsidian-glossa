const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/task_continuity.ts'));

  const messages = [
    {
      id: 'u1',
      role: 'user',
      content: '下载Rich Sutton 写的 the bitter lesson放到paper/下面',
    },
    {
      id: 'a1',
      role: 'assistant',
      content: '没能下载成功。',
      toolEvents: [
        {
          name: 'web_fetch',
          args: { url: 'https://incompleteideas.net/IncIdeas/BitterLesson.html' },
          result: 'Failed to fetch: https://incompleteideas.net/IncIdeas/BitterLesson.html',
          status: 'error',
        },
      ],
    },
    {
      id: 'u2',
      role: 'user',
      content: '你直接获得内容，然后写成md文件放在下面',
    },
    {
      id: 'a2',
      role: 'assistant',
      content: '',
      toolEvents: [],
    },
  ];
  const ambientItems = [
    {
      label: 'Titans - Learning to Memorize at Test Time.pdf',
      detail: 'paper/Efficient AI/Titans - Learning to Memorize at Test Time.pdf',
      isCurrent: true,
    },
  ];

  t.eq(mod.hasExplicitCurrentTaskTarget('总结当前PDF内容'), true, 'current PDF is treated as an explicit current target');
  t.eq(mod.hasExplicitCurrentTaskTarget('summarize this PDF'), true, 'this PDF is treated as an explicit current target');
  t.eq(mod.hasExplicitCurrentTaskTarget('下载 https://example.com/new-paper.pdf'), true, 'URL is treated as an explicit new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('下载 AlphaGo Zero 论文'), true, 'named paper is treated as an explicit new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('下载这篇论文，直接获得内容'), false, 'Chinese deictic article reference is not treated as a new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('处理这个内容，写成 md'), false, 'Chinese deictic content reference is not treated as a new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('把“这个内容”写成 md'), false, 'quoted Chinese deictic content is not treated as a new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('把“Attention Is All You Need”写成 md'), true, 'quoted paper title is treated as an explicit new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('write it as markdown'), false, 'English short pronoun is not treated as a new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('把这个写到 paper/BitterLesson.md'), false, 'output path is not treated as a new input target');
  t.eq(mod.hasExplicitCurrentTaskTarget('write this to paper/BitterLesson.md'), false, 'english output path is not treated as a new input target');
  t.eq(mod.hasExplicitCurrentTaskTarget('读取 paper/BitterLesson.md'), true, 'input file path is treated as an explicit new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('把这个改成中文'), false, 'format/language conversion is not treated as a new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('write this in Chinese instead'), false, 'english format conversion is not treated as a new target');
  t.eq(mod.hasExplicitCurrentTaskTarget('换成另一篇论文'), true, 'switching to another article is treated as a new target');
  t.eq(mod.looksLikeStrongTaskContinuation('继续刚才那个任务'), true, 'Chinese explicit continuation is strong continuation');
  t.eq(mod.looksLikeStrongTaskContinuation('write this as markdown'), false, 'bare this-reference is not strong continuation');
  t.eq(mod.looksLikeExplicitPreviousTaskReference('continue summarizing'), false, 'generic continue is not an explicit previous-task reference');
  t.eq(mod.looksLikeExplicitPreviousTaskReference('continue previous task'), true, 'previous task reference is explicit');
  t.eq(mod.looksLikeExplicitPreviousTaskReference('不要继续刚才那个任务'), false, 'negated previous-task reference is not explicit continuation');
  t.eq(mod.looksLikeExplicitPreviousTaskReference('do not continue previous task'), false, 'english negated previous-task reference is not explicit continuation');
  t.eq(mod.looksLikeTaskContinuation('不要继续刚才那个任务，处理这个', true), false, 'negated previous-task reference is not a continuation');
  t.eq(mod.hasExplicitReplacementTarget('继续刚才，但换成另一篇论文'), true, 'replacement target signal is explicit');
  t.eq(mod.hasExplicitAttachedContext(ambientItems), false, 'ambient current context is not an explicit attachment');
  t.eq(
    mod.hasExplicitAttachedContext([{ label: 'Attached PDF', detail: 'paper/attached.pdf', isCurrent: false }]),
    true,
    'non-current context is treated as an explicit attachment',
  );
  t.eq(mod.looksLikeResponseRevision('用中文'), true, 'short language correction revises the previous answer');
  t.eq(mod.looksLikeResponseRevision('更简洁一点'), true, 'short style correction revises the previous answer');
  t.eq(mod.looksLikeResponseRevision('翻译选中的内容成中文'), false, 'explicit selection translation remains a new selection task');

  const languageRevisionMessages = [
    { id: 'u_lang_1', role: 'user', content: '/explain BLIP2是什么方法' },
    { id: 'a_lang_1', role: 'assistant', content: 'BLIP2 is a framework that connects a frozen image encoder to a language model.' },
    { id: 'u_lang_2', role: 'user', content: '用中文' },
    { id: 'a_lang_2', role: 'assistant', content: '' },
  ];
  const languageRevisionHint = mod.buildTaskContinuityHint(
    '用中文',
    'u_lang_2',
    languageRevisionMessages,
    [{ label: 'Paper.pdf', detail: 'Paper/BLIP2.pdf', isCurrent: false }],
    { hasExplicitSelection: true },
  );
  t.ok(languageRevisionHint.includes('<task-continuity>'), 'language correction survives attached selection guard');
  t.ok(languageRevisionHint.includes('/explain BLIP2是什么方法'), 'language correction retains the prior explicit request');
  t.ok(languageRevisionHint.includes('BLIP2 is a framework'), 'language correction carries the previous answer to rewrite');
  t.ok(languageRevisionHint.includes('do not ask what the user wants'), 'language correction prevents generic selection clarification');

  const hint = mod.buildTaskContinuityHint(messages[2].content, 'u2', messages, ambientItems);
  t.ok(hint.includes('<task-continuity>'), 'continuation hint is inserted for short follow-up after failure');
  t.ok(hint.toLowerCase().includes('the bitter lesson'), 'previous explicit target is preserved');
  t.ok(hint.includes('web_fetch') && hint.includes('Failed to fetch'), 'failed fetch result is carried forward');
  t.ok(hint.includes('Ambient current/open') && hint.includes('Titans - Learning'), 'current/open file is marked ambient');
  t.ok(hint.includes('Task target lock') && hint.includes('Rich Sutton'), 'target lock carries the requested author cue');
  t.ok(hint.includes('Task target lock') && hint.toLowerCase().includes('the bitter lesson'), 'target lock carries the requested title cue');
  t.ok(hint.includes('Task target lock') && hint.includes('https://incompleteideas.net/IncIdeas/BitterLesson.html'), 'target lock carries the failed source URL cue');
  t.ok(hint.includes('requested output: paper/'), 'target lock carries the requested output folder');

  const textOnlyFailureHint = mod.buildTaskContinuityHint(
    '你直接获得内容，然后写成md文件放在下面',
    'u_text_2',
    [
      { id: 'u_text_1', role: 'user', content: '下载Rich Sutton 写的 the bitter lesson放到paper/下面' },
      {
        id: 'a_text_1',
        role: 'assistant',
        content: [
          '没能下载成功。已尝试 Rich Sutton 原站和 Web Archive，但当前网络工具都返回 Failed to fetch：',
          '- https://incompleteideas.net/IncIdeas/BitterLesson.html',
          '我没有在 paper/ 下写入文件。',
        ].join('\n'),
      },
      { id: 'u_text_2', role: 'user', content: '你直接获得内容，然后写成md文件放在下面' },
    ],
    ambientItems,
  );
  t.ok(textOnlyFailureHint.toLowerCase().includes('the bitter lesson'), 'text-only assistant failure preserves the previous explicit target');
  t.ok(textOnlyFailureHint.includes('Failed to fetch'), 'text-only assistant failure is carried forward');
  t.ok(textOnlyFailureHint.includes('Ambient current/open') && textOnlyFailureHint.includes('Titans - Learning'), 'ambient PDF remains non-target after text-only failure');
  t.ok(textOnlyFailureHint.includes('Task target lock') && textOnlyFailureHint.includes('https://incompleteideas.net/IncIdeas/BitterLesson.html'), 'text-only failure contributes URL cues to the target lock');

  const benignNoProblemHint = mod.buildTaskContinuityHint(
    '把这个写成 md 放下面',
    'u_text_4',
    [
      { id: 'u_text_3', role: 'user', content: '解释一下 The Bitter Lesson' },
      { id: 'a_text_3', role: 'assistant', content: '没有问题，我可以解释。' },
      { id: 'u_text_4', role: 'user', content: '把这个写成 md 放下面' },
    ],
    ambientItems,
  );
  t.eq(benignNoProblemHint, '', 'benign assistant text is not treated as a failed turn');

  const benignUnableExplanationHint = mod.buildTaskContinuityHint(
    '把这个写成 md 放下面',
    'u_text_6',
    [
      { id: 'u_text_5', role: 'user', content: '解释一下 The Bitter Lesson 和强化学习的关系' },
      { id: 'a_text_5', role: 'assistant', content: '这个结论无法直接说明 The Bitter Lesson 是错误的，只能说明它的适用边界。' },
      { id: 'u_text_6', role: 'user', content: '把这个写成 md 放下面' },
    ],
    ambientItems,
  );
  t.eq(benignUnableExplanationHint, '', 'ordinary explanation text containing unable/error words is not treated as a failed turn');

  const chineseUnableDownloadHint = mod.buildTaskContinuityHint(
    '你直接获得内容，然后写成md文件放在下面',
    'u_text_8',
    [
      { id: 'u_text_7', role: 'user', content: '下载Rich Sutton 写的 the bitter lesson放到paper/下面' },
      { id: 'a_text_7', role: 'assistant', content: '无法下载原文，当前请求返回网络错误。' },
      { id: 'u_text_8', role: 'user', content: '你直接获得内容，然后写成md文件放在下面' },
    ],
    ambientItems,
  );
  t.ok(chineseUnableDownloadHint.toLowerCase().includes('the bitter lesson'), 'Chinese action failure text preserves the previous explicit target');

  const longPrefix = '背景说明'.repeat(80);
  const longRequestHint = mod.buildTaskContinuityHint(
    '你直接获得内容，然后写成md文件放在下面',
    'u_long_2',
    [
      {
        id: 'u_long_1',
        role: 'user',
        content: `${longPrefix}。下载Rich Sutton 写的 the bitter lesson，来源 https://incompleteideas.net/IncIdeas/BitterLesson.html，放到paper/下面`,
      },
      { id: 'a_long_1', role: 'assistant', content: '没能下载成功。' },
      { id: 'u_long_2', role: 'user', content: '你直接获得内容，然后写成md文件放在下面' },
    ],
    ambientItems,
  );
  t.ok(longRequestHint.includes('Previous explicit request') && longRequestHint.includes('...'), 'long previous request is still compacted for display');
  t.ok(longRequestHint.includes('Task target lock') && longRequestHint.includes('Rich Sutton'), 'target lock reads author cue from the uncompact previous request');
  t.ok(longRequestHint.includes('Task target lock') && longRequestHint.toLowerCase().includes('the bitter lesson'), 'target lock reads title cue from the uncompact previous request');
  t.ok(longRequestHint.includes('Task target lock') && longRequestHint.includes('https://incompleteideas.net/IncIdeas/BitterLesson.html'), 'target lock reads URL cue from the uncompact previous request');
  t.ok(longRequestHint.includes('requested output: paper/'), 'target lock reads output folder from the uncompact previous request');

  const failedBeforeCurrent = [messages[0], messages[1]];

  const ordinary = mod.buildTaskContinuityHint(
    '总结当前文件内容',
    'u3',
    failedBeforeCurrent.concat([
      { id: 'u3', role: 'user', content: '总结当前文件内容' },
      { id: 'a3', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(ordinary, '', 'explicit current-file request is not forced into prior-task continuity after a failure');

  const currentPdf = mod.buildTaskContinuityHint(
    '总结当前PDF内容',
    'u10',
    failedBeforeCurrent.concat([
      { id: 'u10', role: 'user', content: '总结当前PDF内容' },
      { id: 'a10', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(currentPdf, '', 'explicit current-PDF request is not forced into prior-task continuity after a failure');

  const thisPdf = mod.buildTaskContinuityHint(
    'summarize this PDF',
    'u11',
    failedBeforeCurrent.concat([
      { id: 'u11', role: 'user', content: 'summarize this PDF' },
      { id: 'a11', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(thisPdf, '', 'english this-PDF request is not forced into prior-task continuity after a failure');

  const editCurrent = mod.buildTaskContinuityHint(
    'edit current file',
    'u5',
    failedBeforeCurrent.concat([
      { id: 'u5', role: 'user', content: 'edit current file' },
      { id: 'a5', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(editCurrent, '', 'english words containing it do not accidentally trigger continuation');

  const deicticArticle = mod.buildTaskContinuityHint(
    '下载这篇论文，直接获得内容然后写成 md',
    'u8',
    failedBeforeCurrent.concat([
      { id: 'u8', role: 'user', content: '下载这篇论文，直接获得内容然后写成 md' },
      { id: 'a8', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(deicticArticle.toLowerCase().includes('the bitter lesson'), 'Chinese deictic article reference keeps the previous failed target');

  const deicticContent = mod.buildTaskContinuityHint(
    '处理这个内容，写成 md 放下面',
    'u9',
    failedBeforeCurrent.concat([
      { id: 'u9', role: 'user', content: '处理这个内容，写成 md 放下面' },
      { id: 'a9', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(deicticContent.toLowerCase().includes('the bitter lesson'), 'Chinese deictic content reference keeps the previous failed target');

  const quotedDeictic = mod.buildTaskContinuityHint(
    '把“这个内容”写成 md 放下面',
    'u12',
    failedBeforeCurrent.concat([
      { id: 'u12', role: 'user', content: '把“这个内容”写成 md 放下面' },
      { id: 'a12', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(quotedDeictic.toLowerCase().includes('the bitter lesson'), 'quoted deictic content keeps the previous failed target');

  const bareChineseThis = mod.buildTaskContinuityHint(
    '把这个写成 md 放下面',
    'u14',
    failedBeforeCurrent.concat([
      { id: 'u14', role: 'user', content: '把这个写成 md 放下面' },
      { id: 'a14', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(bareChineseThis.toLowerCase().includes('the bitter lesson'), 'bare Chinese this-reference keeps the previous failed target');

  const explicitAttachment = mod.buildTaskContinuityHint(
    '把这个写成 md 放下面',
    'u20',
    failedBeforeCurrent.concat([
      { id: 'u20', role: 'user', content: '把这个写成 md 放下面' },
      { id: 'a20', role: 'assistant', content: '' },
    ]),
    [{ label: 'Attached PDF', detail: 'paper/attached.pdf', isCurrent: false }],
  );
  t.eq(explicitAttachment, '', 'explicit attachment takes priority over previous failed target');

  const explicitSelection = mod.buildTaskContinuityHint(
    '把这个写成 md 放下面',
    'u21',
    failedBeforeCurrent.concat([
      { id: 'u21', role: 'user', content: '把这个写成 md 放下面' },
      { id: 'a21', role: 'assistant', content: '' },
    ]),
    ambientItems,
    { hasExplicitSelection: true },
  );
  t.eq(explicitSelection, '', 'explicit selection takes priority over previous failed target');

  const attachmentStrongContinuation = mod.buildTaskContinuityHint(
    '继续刚才那个下载任务',
    'u22',
    failedBeforeCurrent.concat([
      { id: 'u22', role: 'user', content: '继续刚才那个下载任务' },
      { id: 'a22', role: 'assistant', content: '' },
    ]),
    [{ label: 'Attached PDF', detail: 'paper/attached.pdf', isCurrent: false }],
  );
  t.ok(attachmentStrongContinuation.toLowerCase().includes('the bitter lesson'), 'explicit attachment does not block strong continuation to previous failed target');

  const explicitPreviousWithTitle = mod.buildTaskContinuityHint(
    '继续刚才的 The Bitter Lesson 下载任务',
    'u29',
    failedBeforeCurrent.concat([
      { id: 'u29', role: 'user', content: '继续刚才的 The Bitter Lesson 下载任务' },
      { id: 'a29', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(explicitPreviousWithTitle.toLowerCase().includes('the bitter lesson'), 'explicit previous task with repeated title keeps continuity context');
  t.ok(explicitPreviousWithTitle.includes('Failed to fetch'), 'explicit previous task with repeated title keeps failed tool result');

  const previousButReplacement = mod.buildTaskContinuityHint(
    '继续刚才，但换成另一篇论文',
    'u30',
    failedBeforeCurrent.concat([
      { id: 'u30', role: 'user', content: '继续刚才，但换成另一篇论文' },
      { id: 'a30', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(previousButReplacement, '', 'explicit replacement target is not pulled back to the previous failed task');

  const attachmentGenericContinue = mod.buildTaskContinuityHint(
    'continue summarizing',
    'u24',
    failedBeforeCurrent.concat([
      { id: 'u24', role: 'user', content: 'continue summarizing' },
      { id: 'a24', role: 'assistant', content: '' },
    ]),
    [{ label: 'Attached PDF', detail: 'paper/attached.pdf', isCurrent: false }],
  );
  t.eq(attachmentGenericContinue, '', 'explicit attachment blocks generic continue from pulling in previous failed target');

  const attachmentNegatedPrevious = mod.buildTaskContinuityHint(
    '不要继续刚才那个任务，处理这个',
    'u26',
    failedBeforeCurrent.concat([
      { id: 'u26', role: 'user', content: '不要继续刚才那个任务，处理这个' },
      { id: 'a26', role: 'assistant', content: '' },
    ]),
    [{ label: 'Attached PDF', detail: 'paper/attached.pdf', isCurrent: false }],
  );
  t.eq(attachmentNegatedPrevious, '', 'negated previous-task reference keeps explicit attachment priority');

  const staleFailureShortRef = mod.buildTaskContinuityHint(
    '把这个写成 md',
    'u27',
    failedBeforeCurrent.concat([
      { id: 'u27a', role: 'user', content: '总结当前文件内容' },
      { id: 'a27a', role: 'assistant', content: '已总结。' },
      { id: 'u27', role: 'user', content: '把这个写成 md' },
      { id: 'a27', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(staleFailureShortRef, '', 'stale failed tool result does not leak across an intervening user task');

  const continueAfterInterveningTask = mod.buildTaskContinuityHint(
    '继续',
    'u28',
    failedBeforeCurrent.concat([
      { id: 'u28a', role: 'user', content: '总结当前文件内容' },
      { id: 'a28a', role: 'assistant', content: '已总结。' },
      { id: 'u28', role: 'user', content: '继续' },
      { id: 'a28', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(continueAfterInterveningTask.includes('总结当前文件内容'), 'generic continue follows the intervening user task');
  t.ok(!continueAfterInterveningTask.toLowerCase().includes('the bitter lesson'), 'generic continue does not jump back to a stale failed task');

  const continueOldDownloadTask = mod.buildTaskContinuityHint(
    '继续之前那个下载任务',
    'u31',
    failedBeforeCurrent.concat([
      { id: 'u31a', role: 'user', content: '总结当前文件内容' },
      { id: 'a31a', role: 'assistant', content: '已总结。' },
      { id: 'u31', role: 'user', content: '继续之前那个下载任务' },
      { id: 'a31', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(continueOldDownloadTask.toLowerCase().includes('the bitter lesson'), 'typed previous-task reference can jump back to an older matching download task');
  t.ok(continueOldDownloadTask.includes('Failed to fetch'), 'typed previous-task reference carries the older matching task failure');

  const continueOldTitledTask = mod.buildTaskContinuityHint(
    '继续之前那个 The Bitter Lesson',
    'u33',
    failedBeforeCurrent.concat([
      { id: 'u33a', role: 'user', content: '总结当前文件内容' },
      { id: 'a33a', role: 'assistant', content: '已总结。' },
      { id: 'u33', role: 'user', content: '继续之前那个 The Bitter Lesson' },
      { id: 'a33', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(continueOldTitledTask.toLowerCase().includes('the bitter lesson'), 'explicit previous-task title can jump back to an older matching task');
  t.ok(continueOldTitledTask.includes('Failed to fetch'), 'explicit previous-task title carries the older matching task failure');

  const continueOldLowercaseTitleTask = mod.buildTaskContinuityHint(
    '继续之前那个 the bitter lesson',
    'u34',
    failedBeforeCurrent.concat([
      { id: 'u34a', role: 'user', content: '总结当前文件内容' },
      { id: 'a34a', role: 'assistant', content: '已总结。' },
      { id: 'u34', role: 'user', content: '继续之前那个 the bitter lesson' },
      { id: 'a34', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(continueOldLowercaseTitleTask.toLowerCase().includes('the bitter lesson'), 'lowercase previous-task title can jump back to an older matching task');
  t.ok(continueOldLowercaseTitleTask.includes('Failed to fetch'), 'lowercase previous-task title carries the older matching task failure');

  const continueOldDomainTask = mod.buildTaskContinuityHint(
    '继续之前那个 incompleteideas.net 链接',
    'u35',
    failedBeforeCurrent.concat([
      { id: 'u35a', role: 'user', content: '总结当前文件内容' },
      { id: 'a35a', role: 'assistant', content: '已总结。' },
      { id: 'u35', role: 'user', content: '继续之前那个 incompleteideas.net 链接' },
      { id: 'a35', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(continueOldDomainTask.toLowerCase().includes('the bitter lesson'), 'explicit previous-task domain can jump back to an older matching task');
  t.ok(continueOldDomainTask.includes('Failed to fetch'), 'explicit previous-task domain carries the older matching task failure');

  const continueOldUrlTask = mod.buildTaskContinuityHint(
    '继续之前那个 https://incompleteideas.net/IncIdeas/BitterLesson.html',
    'u36',
    failedBeforeCurrent.concat([
      { id: 'u36a', role: 'user', content: '总结当前文件内容' },
      { id: 'a36a', role: 'assistant', content: '已总结。' },
      { id: 'u36', role: 'user', content: '继续之前那个 https://incompleteideas.net/IncIdeas/BitterLesson.html' },
      { id: 'a36', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(continueOldUrlTask.toLowerCase().includes('the bitter lesson'), 'explicit previous-task URL can jump back to an older matching task');
  t.ok(continueOldUrlTask.includes('Failed to fetch'), 'explicit previous-task URL carries the older matching task failure');

  const unmatchedOldDomainTask = mod.buildTaskContinuityHint(
    '继续之前那个 example.com 链接',
    'u37',
    failedBeforeCurrent.concat([
      { id: 'u37a', role: 'user', content: '总结当前文件内容' },
      { id: 'a37a', role: 'assistant', content: '已总结。' },
      { id: 'u37', role: 'user', content: '继续之前那个 example.com 链接' },
      { id: 'a37', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(unmatchedOldDomainTask, '', 'unmatched previous-task domain does not fall back to an unrelated task');

  const unmatchedOldTitleTask = mod.buildTaskContinuityHint(
    '继续之前那个 Unknown Paper',
    'u38',
    failedBeforeCurrent.concat([
      { id: 'u38a', role: 'user', content: '总结当前文件内容' },
      { id: 'a38a', role: 'assistant', content: '已总结。' },
      { id: 'u38', role: 'user', content: '继续之前那个 Unknown Paper' },
      { id: 'a38', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(unmatchedOldTitleTask, '', 'unmatched previous-task title does not fall back to an unrelated task');

  const continueInterveningSummaryTask = mod.buildTaskContinuityHint(
    '继续之前那个总结任务',
    'u32',
    failedBeforeCurrent.concat([
      { id: 'u32a', role: 'user', content: '总结当前文件内容' },
      { id: 'a32a', role: 'assistant', content: '已总结。' },
      { id: 'u32', role: 'user', content: '继续之前那个总结任务' },
      { id: 'a32', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(continueInterveningSummaryTask.includes('总结当前文件内容'), 'typed previous-task reference can choose the intervening matching summary task');
  t.ok(!continueInterveningSummaryTask.toLowerCase().includes('the bitter lesson'), 'typed previous summary task does not jump back to older download task');

  const selectionStrongContinuation = mod.buildTaskContinuityHint(
    'retry previous',
    'u23',
    failedBeforeCurrent.concat([
      { id: 'u23', role: 'user', content: 'retry previous' },
      { id: 'a23', role: 'assistant', content: '' },
    ]),
    ambientItems,
    { hasExplicitSelection: true },
  );
  t.ok(selectionStrongContinuation.toLowerCase().includes('the bitter lesson'), 'explicit selection does not block strong continuation to previous failed target');

  const selectionGenericContinue = mod.buildTaskContinuityHint(
    '继续总结',
    'u25',
    failedBeforeCurrent.concat([
      { id: 'u25', role: 'user', content: '继续总结' },
      { id: 'a25', role: 'assistant', content: '' },
    ]),
    ambientItems,
    { hasExplicitSelection: true },
  );
  t.eq(selectionGenericContinue, '', 'explicit selection blocks generic continue from pulling in previous failed target');

  const bareEnglishThis = mod.buildTaskContinuityHint(
    'write this as markdown',
    'u15',
    failedBeforeCurrent.concat([
      { id: 'u15', role: 'user', content: 'write this as markdown' },
      { id: 'a15', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(bareEnglishThis.toLowerCase().includes('the bitter lesson'), 'bare English this-reference keeps the previous failed target');

  const outputPathOnly = mod.buildTaskContinuityHint(
    '把这个写到 paper/BitterLesson.md',
    'u16',
    failedBeforeCurrent.concat([
      { id: 'u16', role: 'user', content: '把这个写到 paper/BitterLesson.md' },
      { id: 'a16', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(outputPathOnly.toLowerCase().includes('the bitter lesson'), 'output path does not replace the previous failed target');

  const inputPathTarget = mod.buildTaskContinuityHint(
    '读取 paper/BitterLesson.md 然后写摘要',
    'u17',
    failedBeforeCurrent.concat([
      { id: 'u17', role: 'user', content: '读取 paper/BitterLesson.md 然后写摘要' },
      { id: 'a17', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(inputPathTarget, '', 'input path is not pulled back to the previous failed task');

  const convertChinese = mod.buildTaskContinuityHint(
    '把这个改成中文',
    'u18',
    failedBeforeCurrent.concat([
      { id: 'u18', role: 'user', content: '把这个改成中文' },
      { id: 'a18', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(convertChinese.toLowerCase().includes('the bitter lesson'), 'format/language conversion keeps the previous failed target');

  const convertEnglish = mod.buildTaskContinuityHint(
    'write this in Chinese instead',
    'u19',
    failedBeforeCurrent.concat([
      { id: 'u19', role: 'user', content: 'write this in Chinese instead' },
      { id: 'a19', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.ok(convertEnglish.toLowerCase().includes('the bitter lesson'), 'english format conversion keeps the previous failed target');

  const quotedTitleTarget = mod.buildTaskContinuityHint(
    '把“Attention Is All You Need”写成 md 放下面',
    'u13',
    failedBeforeCurrent.concat([
      { id: 'u13', role: 'user', content: '把“Attention Is All You Need”写成 md 放下面' },
      { id: 'a13', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(quotedTitleTarget, '', 'quoted title is not pulled back to the previous failed task');

  const newUrlTarget = mod.buildTaskContinuityHint(
    '下载 https://example.com/new-paper.pdf，直接获得内容然后写成 md',
    'u6',
    failedBeforeCurrent.concat([
      { id: 'u6', role: 'user', content: '下载 https://example.com/new-paper.pdf，直接获得内容然后写成 md' },
      { id: 'a6', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(newUrlTarget, '', 'explicit new URL target is not pulled back to the previous failed task');

  const newNamedTarget = mod.buildTaskContinuityHint(
    '下载 AlphaGo Zero 论文，直接获得内容然后写成 md',
    'u7',
    failedBeforeCurrent.concat([
      { id: 'u7', role: 'user', content: '下载 AlphaGo Zero 论文，直接获得内容然后写成 md' },
      { id: 'a7', role: 'assistant', content: '' },
    ]),
    ambientItems,
  );
  t.eq(newNamedTarget, '', 'explicit new named target is not pulled back to the previous failed task');

  const retryHint = mod.buildTaskContinuityHint(
    '继续写成 markdown',
    'u4',
    [
      { id: 'u1', role: 'user', content: '把 The Bitter Lesson 整理成中文笔记' },
      { id: 'a1', role: 'assistant', content: '可以。' },
      { id: 'u4', role: 'user', content: '继续写成 markdown' },
    ],
    [],
  );
  t.ok(retryHint.includes('The Bitter Lesson'), 'strong continuation keeps the previous explicit target even without a failed tool');
};
