const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/context_policy.ts'));
  const current = [{ label: 'Transformers', detail: 'notes/Transformers.md', isCurrent: true }];

  t.eq(mod.currentContextRole('继续刚才的下载任务', current, false), 'ambient', 'unrelated continuation keeps open file as background without replacing prior task');
  t.eq(mod.currentContextRole('/summarize 总结一下', current, false), 'default-target', 'summarize slash command targets the open file without a selection');
  t.eq(mod.currentContextRole('总结一下', current, false), 'default-target', 'implicit Chinese document operation targets the open file');
  t.eq(mod.currentContextRole('explain this file', current, false), 'default-target', 'explicit English current-file request targets open content');
  t.eq(mod.currentContextRole('比较 Transformers.md 和前面的论文', current, false), 'default-target', 'direct filename mention targets current content');
  t.eq(mod.currentContextRole('总结一下', current, true), 'secondary', 'explicit attachment remains primary over open file');
  t.eq(mod.currentContextRole('总结一下', [], false), 'none', 'policy is omitted when no file is open');

  const hint = mod.buildCurrentContextPolicyHint('/summarize', current, false);
  t.ok(hint.includes('role="default-target"'), 'policy serializes default-target role');
  t.ok(hint.includes('do not call get_selection'), 'policy explicitly prevents unnecessary selection requests');
  t.ok(hint.includes('notes/Transformers.md'), 'policy identifies the open source path');

  t.eq(mod.pdfReadTaskForPrompt('/summarize 总结一下'), 'summarize', 'PDF summary prompt samples summary pages');
  t.eq(mod.pdfReadTaskForPrompt('识别这篇论文的标题'), 'inspect', 'PDF title prompt inspects front matter');
  t.eq(mod.pdfReadTaskForPrompt('把文件重命名'), 'rename', 'PDF rename prompt uses rename inspection');
  t.eq(mod.pdfReadTaskForPrompt('解释第三章的方法'), 'auto', 'general PDF question keeps broad automatic extraction');

  const pdfRef = mod.buildContextSourceReference({ path: 'paper/RL/A3C.pdf', extension: 'pdf' }, []);
  t.ok(pdfRef.includes('kind="current-file"') && pdfRef.includes('paper/RL/A3C.pdf'), 'non-Markdown slash source points to the open file');
  t.ok(pdfRef.includes('selection is not required'), 'non-Markdown source reference makes selection optional');
  const attachedRef = mod.buildContextSourceReference(
    { path: 'notes/background.md', extension: 'md' },
    [{ label: 'Paper', detail: 'paper/target.pdf' }],
  );
  t.ok(attachedRef.includes('kind="user-attached"') && attachedRef.includes('paper/target.pdf'), 'explicit attachment replaces open note as slash source');
  t.eq(mod.buildContextSourceReference({ path: 'notes/current.md', extension: 'md' }, []), '', 'Markdown source remains embedded directly without a duplicate reference');
};
