const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/composer_events.ts'));

  const calls = [];
  const fileDrag = {
    dataTransfer: { files: [], items: [{ kind: 'file' }], types: ['Files'] },
    preventDefault: () => calls.push('prevent'),
    stopPropagation: () => calls.push('stop'),
  };
  t.eq(mod.consumeComposerFileDrag(fileDrag), true, 'file drags are claimed by the composer');
  t.eq(calls, ['prevent', 'stop'], 'claimed file drags cannot continue into the host workspace');

  const textCalls = [];
  const textDrag = {
    dataTransfer: { files: [], items: [{ kind: 'string' }], types: ['text/plain'] },
    preventDefault: () => textCalls.push('prevent'),
    stopPropagation: () => textCalls.push('stop'),
  };
  t.eq(mod.consumeComposerFileDrag(textDrag), false, 'ordinary text drags are not treated as attachments');
  t.eq(textCalls, [], 'ordinary text drags keep their native behavior');

  t.eq(mod.isComposerDeletionKey('Backspace'), true, 'Backspace is isolated to the composer');
  t.eq(mod.isComposerDeletionKey('Delete'), true, 'forward Delete is isolated to the composer');
  t.eq(mod.isComposerDeletionKey('Enter'), false, 'unrelated keys are not isolated by the deletion guard');
  t.eq(mod.isComposerDeletionInput('deleteContentBackward'), true, 'backward beforeinput deletion is isolated');
  t.eq(mod.isComposerDeletionInput('insertText'), false, 'text insertion keeps normal propagation');
};
