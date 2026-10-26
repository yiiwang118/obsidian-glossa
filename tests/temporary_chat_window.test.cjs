const path = require('path');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
exports.run = async (t, load) => {
  const { TemporaryChatStore } = await load(path.resolve(__dirname, '../src/temporary_chat.ts'));
  const { openTemporaryChat, closeEndedTemporaryChats, TemporaryChatView, VIEW_TYPE_TEMPORARY_CHAT } = await load(path.resolve(__dirname, '../src/ui/temporary_chat_view.ts'), { ItemView: class { async setState() {} onPaneMenu() {} }, normalizePath: p => p });
  const gate = deferred(), leaves = [], calls = [];
  const plugin = { settings: { activeEndpointId: 'cli', endpoints: [{ id: 'cli', kind: 'codex-cli' }, { id: 'api', kind: 'custom-api', label: 'API' }] }, temporaryChats: new TemporaryChatStore(), app: { workspace: {
    getLeavesOfType: type => type === VIEW_TYPE_TEMPORARY_CHAT ? leaves : [],
    revealLeaf: async leaf => calls.push(['reveal', leaf]),
    openPopoutLeaf: data => {
      calls.push(['popout', data]);
      const leaf = { detach: () => calls.push(['detach']), setViewState: async state => {
        calls.push(['state', state]); await gate.promise;
        leaf.view = Object.create(TemporaryChatView.prototype); leaf.view.chat = plugin.temporaryChats.get(state.state.id);
        leaf.view.focusComposer = () => calls.push(['focus']);
      } };
      leaves.push(leaf); return leaf;
    },
  } } };
  const parent = { id: 'parent', title: 'Source', messages: [] };
  const quote = { id: 'q', messageId: 'm', role: 'assistant', text: 'Quote', question: '', truncated: false };
  const one = openTemporaryChat(plugin, parent, [quote]);
  const two = openTemporaryChat(plugin, parent, [{ ...quote, id: 'q2', text: 'Second' }]);
  gate.resolve(); await Promise.all([one, two]);
  t.eq(calls.filter(c => c[0] === 'popout').length, 1, 'rapid repeated selections open only one independent window');
  t.eq(calls[0][1].size, { width: 560, height: 740 }, 'opens at a readable compact window size');
  const chat = leaves[0].view.chat;
  t.eq(chat.pending.length, 2, 'both pending selections wait in the same composer');
  t.eq(chat.endpointId, 'api', 'CLI selection does not expose tools or native storage to temporary chat');
  t.ok(calls.some(c => c[0] === 'focus'), 'the composer is focused once the window is open');
  const state = calls.find(c => c[0] === 'state')[1];
  t.eq(Object.keys(state.state), ['id'], 'initial leaf binding contains only an opaque transient identifier');
  t.eq(leaves[0].view.getState(), {}, 'saved workspace layout drops even the transient identifier');
  calls.length = 0;
  await openTemporaryChat(plugin, parent, [{ ...quote, id: 'q3', text: 'Third' }]);
  t.eq(calls.map(c => c[0]), ['reveal', 'focus'], 'adding to an open chat brings its window forward with the caret in the box');
  t.eq(chat.pending.length, 3, 'a later quote joins the open composer');
  const reopened = new TemporaryChatView({}, plugin);
  reopened.closed = true;
  await reopened.setState({}, {});
  t.eq(reopened.chat, undefined, 'workspace restoration cannot resurrect the old side chat');

  // Restored layouts: windows without a live chat close; a live one stays.
  const detached = [];
  const live = Object.create(TemporaryChatView.prototype); live.chat = chat;
  const ended = Object.create(TemporaryChatView.prototype);
  const restored = [{ view: live }, { view: ended }, { view: { getViewType: () => VIEW_TYPE_TEMPORARY_CHAT } }].map((leaf, i) => ({ ...leaf, detach: () => detached.push(i) }));
  closeEndedTemporaryChats({ workspace: { getLeavesOfType: () => restored } });
  t.eq(detached, [1, 2], 'ended and deferred temporary windows are closed, the live one is kept');

  // A settings change reaches an open window without rebuilding its transcript.
  const synced = Object.create(TemporaryChatView.prototype);
  let syncs = 0; synced.sync = () => { syncs++; };
  synced.refresh();
  t.eq(syncs, 1, 'settings refresh only re-syncs the window');

  // Nothing to choose in the window itself: the title bar's ⋯ menu holds the rest.
  const items = [];
  const menu = {
    addSeparator() { items.push('—'); return menu; },
    addItem(build) {
      const item = { checked: null, disabled: false };
      for (const [name, key] of [['setTitle', 'title'], ['setChecked', 'checked'], ['setDisabled', 'disabled'], ['setIsLabel', 'label'], ['onClick', 'click']]) item[name] = value => { item[key] = value; return item; };
      item.setIcon = () => item;
      build(item); items.push(item); return menu;
    },
  };
  const menuView = new TemporaryChatView({}, plugin);
  menuView.chat = chat; menuView.closed = false; menuView.sync = () => {}; menuView.focusComposer = () => {};
  plugin.settings.endpoints.push({ id: 'api2', kind: 'custom-api', label: 'Second', model: 'm2' });
  menuView.onPaneMenu(menu, 'more-options');
  t.eq(items.map(item => item === '—' ? item : item.title), ['Open the source chat', 'Save as note', 'Clear', '—', 'Model', 'API', 'Second · m2'], 'the menu lists the source chat, save, clear and the API models');
  t.eq([items[1].disabled, items[2].disabled], [true, false], 'nothing to save yet, but pending quotes can be cleared');
  t.eq(items.slice(5).map(item => item.checked), [true, false], 'the model in use is checked');
  items[6].click();
  t.eq(chat.endpointId, 'api2', 'picking another model switches this temporary chat');
  items.length = 0; plugin.settings.endpoints.pop(); chat.endpointId = 'api';
  menuView.onPaneMenu(menu, 'more-options');
  t.ok(!items.some(item => item.label), 'with one API endpoint there is no model to choose');
  const button = () => ({ setAttribute(key, value) { this[key] = value; } });
  menuView.saveAction = button(); menuView.clearAction = button();
  menuView.syncActions();
  t.eq([menuView.saveAction.disabled, menuView.clearAction.disabled, menuView.saveAction['aria-disabled']], [true, false, 'true'], 'title-bar actions are disabled while they have nothing to act on');

  // Closing/reopening while key unlocking is pending must not send an old draft.
  const unlocked = deferred(); let sent = 0;
  plugin.getDecryptedEndpoint = () => unlocked.promise;
  const view = new TemporaryChatView({}, plugin);
  view.chat = chat; view.closed = false; view.sync = () => {};
  view.contentEl = { empty() {} }; view.clearMessageUIs = () => {};
  chat.draft = 'Do not send after close'; chat.send = async () => { sent++; };
  const sending = view.run('send');
  await view.onClose(); view.closed = false;
  unlocked.resolve({ id: 'api', kind: 'custom-api' }); await sending;
  t.eq(sent, 0, 'old unlock promise cannot start a turn after window lifecycle changes');
  t.eq(chat.draft, 'Do not send after close', 'unsent draft remains available when reopening');
  let stopped = false; chat.stop = () => { stopped = true; };
  view.closed = true; view.endSession();
  t.ok(stopped && !view.chat, 'plugin unload clears the view association without detaching the pane');

  // Export must capture the authorized discussion before any asynchronous vault work.
  const exporting = plugin.temporaryChats.forParent({ ...parent, id: 'export' }, 'api');
  exporting.messages.push({ id: 'uq', role: 'user', content: 'Original question', status: 'complete' }, { id: 'aa', role: 'assistant', content: 'Original answer', status: 'complete', truncated: true });
  const folder = deferred(), saved = [];
  const saveView = new TemporaryChatView({}, plugin);
  saveView.chat = exporting; saveView.closed = false;
  saveView.app = { vault: { getAbstractFileByPath: () => null, createFolder: async () => folder.promise, create: async (path, content) => { saved.push({ path, content }); } } };
  const saving = saveView.saveAsNote();
  exporting.clear(); folder.resolve(); await saving;
  t.ok(saved[0]?.content.includes('Original answer'), 'clear during folder creation cannot empty the saved discussion');
  t.ok(saved[0]?.content.includes('output limit'), 'saved note retains provider truncation warning');
};
