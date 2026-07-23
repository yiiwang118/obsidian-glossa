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

  const screenshot = { name: '', type: 'image/png', size: 42 };
  const pasteCalls = [];
  const imagePaste = {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }],
      files: [],
    },
    preventDefault: () => pasteCalls.push('prevent'),
    stopPropagation: () => pasteCalls.push('stop'),
  };
  t.eq(mod.consumeComposerImagePaste(imagePaste), [screenshot], 'image paste returns clipboard image files');
  t.eq(pasteCalls, ['prevent', 'stop'], 'image paste is claimed by the composer');

  const blankItemTypeImage = { name: 'image.png', type: 'image/png', size: 42 };
  t.eq(mod.clipboardImageFiles({
    items: [{ kind: 'file', type: '', getAsFile: () => blankItemTypeImage }],
    files: [],
  }), [blankItemTypeImage], 'clipboard image uses the resolved file type when the item type is blank');

  const extensionOnlyImage = { name: 'Screenshot.PNG', type: '', size: 42 };
  t.eq(mod.clipboardImageFiles({
    items: [{ kind: 'file', type: '', getAsFile: () => extensionOnlyImage }],
    files: [],
  }), [extensionOnlyImage], 'clipboard image falls back to a supported image extension');

  const nonImageFile = { name: 'notes.txt', type: 'text/plain', size: 42 };
  t.eq(mod.clipboardImageFiles({
    items: [{ kind: 'file', type: 'text/plain', getAsFile: () => nonImageFile }],
    files: [],
  }), [], 'clipboard non-image files are ignored');

  const textPasteCalls = [];
  const textPaste = {
    clipboardData: {
      items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      files: [],
    },
    preventDefault: () => textPasteCalls.push('prevent'),
    stopPropagation: () => textPasteCalls.push('stop'),
  };
  t.eq(mod.consumeComposerImagePaste(textPaste), [], 'ordinary text paste has no image attachments');
  t.eq(textPasteCalls, [], 'ordinary text paste keeps its native behavior');

  const fixedTime = new Date(2026, 6, 22, 15, 4, 5);
  t.eq(mod.screenshotBaseName(fixedTime, 0), 'Screenshot-20260722-150405', 'first screenshot gets a stable timestamp name');
  t.eq(mod.screenshotBaseName(fixedTime, 1), 'Screenshot-20260722-150405-2', 'multiple screenshots get distinct names');
};
