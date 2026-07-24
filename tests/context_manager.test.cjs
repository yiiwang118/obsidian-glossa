const path = require('path');

exports.run = async function(t, loadModule) {
  const { ContextManager } = await loadModule(path.resolve(__dirname, '../src/context/manager.ts'));
  const manager = new ContextManager();
  manager.add({
    id: 'attached',
    kind: 'selection',
    label: 'English PDF excerpt',
    detail: 'Paper/BLIP2.pdf',
    content: 'The framework connects a frozen image encoder with a language model through a Q-Former.',
    tokens: 30,
    pinned: false,
  });
  manager.updateCurrent({
    id: 'current',
    kind: 'file',
    label: '当前笔记',
    detail: 'Notes/当前笔记.md',
    content: '这是一篇当前打开的中文笔记，只作为环境背景。',
    tokens: 20,
    pinned: false,
    isCurrent: true,
  });

  const prompt = manager.asPromptBlock(1000, 1200);
  t.ok(prompt.text.includes('<context-manifest>'), 'context prompt includes a structured manifest');
  t.ok(prompt.text.includes('role=user-attached') && prompt.text.includes('language=en'), 'attached English source is labelled explicitly');
  t.ok(prompt.text.includes('role=ambient-current') && prompt.text.includes('language=zh'), 'current Chinese note is labelled as ambient');
  t.ok(prompt.text.includes('does not determine the language of the reply'), 'context manifest separates source and response languages');
  t.ok(prompt.text.includes('这是一篇当前打开的中文笔记'), 'open-file body is included by default without requiring a selection');

  const deduped = manager.asPromptBlock(1000, 1200, { suppressAutoCurrent: true });
  t.ok(!deduped.text.includes('这是一篇当前打开的中文笔记'), 'already embedded current source can be suppressed to avoid duplication');
  t.ok(deduped.text.includes('The framework connects'), 'suppressing duplicate current source preserves explicit attachments');

  manager.add({ id: 'image-1', kind: 'image', label: 'Screenshot-1.png', detail: '42KB / image/png', content: 'data:image/png;base64,AAAA', tokens: 42, pinned: false });
  manager.add({ id: 'image-2', kind: 'image', label: 'Screenshot-2.png', detail: '42KB / image/png', content: 'data:image/png;base64,BBBB', tokens: 42, pinned: false });
  manager.add({ id: 'image-duplicate', kind: 'image', label: 'Another-name.png', detail: '99KB / image/png', content: 'data:image/png;base64,AAAA', tokens: 99, pinned: false });
  t.eq(manager.imagesForAPI().map(image => image.name), ['Screenshot-1.png', 'Screenshot-2.png'], 'same-size screenshots with different names are both retained');

  manager.add({ id: 'file-a', kind: 'file', label: 'A.md', detail: '1 KB', content: 'A', tokens: 1, pinned: false });
  manager.add({ id: 'file-b', kind: 'file', label: 'B.md', detail: '1 KB', content: 'B', tokens: 1, pinned: false });
  t.eq(manager.list().filter(item => item.id === 'file-a' || item.id === 'file-b').length, 2,
    'non-image attachments with the same detail retain the original filename-aware dedupe behavior');
};
