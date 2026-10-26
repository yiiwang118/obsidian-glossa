const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

exports.run = async t => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/ui/view.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {}, notices = [], calls = [];
  const modules = {
    obsidian: { ItemView: class {}, Notice: class { constructor(text) { notices.push(text); } } },
    '../utils/i18n': { bi: en => en },
    '../utils/notice': { quickNotice: text => notices.push(text) },
  };
  vm.runInNewContext(code, { exports, console, require: name => modules[name] ?? {} });
  const view = Object.create(exports.GlossaView.prototype);
  view.session = { id: 'source' }; view.viewClosed = true;
  t.eq(await view.openChat('source'), false, 'closed main view cannot report a successful open');
  view.viewClosed = false;
  view.inputEl = { value: 'Existing draft', ownerDocument: { defaultView: { focus() {} } }, focus() {}, setSelectionRange() {} };
  view.hub = { idleCompactor: { cancel: id => calls.push(id) } };
  view.recomputeInputHeight = () => {}; view.updateSubmitBtn = () => {};
  t.eq(await view.placeInComposer('source', 'Side answer'), true, 'explicit transfer places a side reply in the source composer');
  t.ok(view.inputEl.value.startsWith('Existing draft\n\n') && view.inputEl.value.endsWith('Side answer'), 'transfer preserves the existing draft');
  t.eq(calls, ['source'], 'transfer cancels idle compaction, never starts a model turn');
  const savedDraft = view.inputEl.value;
  view.openChat = async () => { view.session = { id: 'other' }; return true; };
  t.eq(await view.placeInComposer('source', 'Must not land'), false, 'switching chats during async open prevents a misdirected insertion');
  t.eq(view.inputEl.value, savedDraft, 'stale transfer leaves the composer untouched');
  view.openChat = async () => { view.session = { id: 'source' }; view.viewClosed = true; return true; };
  t.eq(await view.placeInComposer('source', 'Too late'), false, 'closing the main view during transfer rejects late insertion');
  t.eq(view.inputEl.value, savedDraft, 'closed-view transfer does not change the draft');
};
