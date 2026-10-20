const path = require('path');

class TFolder {
  constructor(p) { this.path = p; this.name = p.split('/').pop() || p; this.children = []; this.parent = null; }
}
class TFile {
  constructor(p, content) {
    this.path = p; this.name = p.split('/').pop(); this.parent = null;
    this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.content = content; this.stat = { size: content.length };
  }
}

/** A small vault: folders, files, trash and moves through the file manager. */
function fakeVault(tree) {
  const root = new TFolder('');
  const nodes = new Map([['', root]]);
  const folder = p => {
    if (nodes.has(p)) return nodes.get(p);
    const parent = folder(p.split('/').slice(0, -1).join('/'));
    const created = new TFolder(p);
    created.parent = parent; parent.children.push(created); nodes.set(p, created);
    return created;
  };
  const file = (p, content) => {
    const parent = folder(p.split('/').slice(0, -1).join('/'));
    const created = new TFile(p, content);
    created.parent = parent; parent.children.push(created); nodes.set(p, created);
    return created;
  };
  const forget = node => { nodes.delete(node.path); for (const child of node.children ?? []) forget(child); };
  for (const [p, content] of Object.entries(tree)) file(p, content);
  const stored = new Map();
  const trashed = [];
  const app = {
    workspace: {},
    metadataCache: {},
    vault: {
      configDir: '.obsidian',
      getName: () => 'Test',
      adapter: {
        exists: async p => stored.has(p),
        read: async p => stored.get(p),
        write: async (p, s) => { stored.set(p, s); },
        rename: async (a, b) => { stored.set(b, stored.get(a)); stored.delete(a); },
        remove: async p => { stored.delete(p); },
      },
      getAbstractFileByPath: p => nodes.get(p) ?? null,
      read: async f => f.content,
      create: async (p, content) => file(p, content),
      createFolder: async p => folder(p),
      process: async (f, edit) => { f.content = edit(f.content); },
    },
    fileManager: {
      trashFile: async node => {
        trashed.push(node.path);
        node.parent.children = node.parent.children.filter(child => child !== node);
        forget(node);
      },
      renameFile: async (node, to) => {
        const from = node.path;
        node.parent.children = node.parent.children.filter(child => child !== node);
        const move = n => { nodes.delete(n.path); n.path = to + n.path.slice(from.length); nodes.set(n.path, n); for (const child of n.children ?? []) move(child); };
        move(node);
        const parent = folder(to.split('/').slice(0, -1).join('/'));
        node.parent = parent; parent.children.push(node); node.name = to.split('/').pop();
      },
    },
  };
  return { app, trashed };
}

const pluginFor = app => ({
  app, manifest: { dir: 'plug' }, settings: { checkpointEnabled: true },
  decryptBlob: async s => s, encryptBlob: async s => s,
});

exports.run = async (t, load) => {
  const fakes = { TFile, TFolder };
  const { deleteNote } = await load(path.resolve(__dirname, '../src/agent/tools/delete_note.ts'), fakes);
  const { renameNote } = await load(path.resolve(__dirname, '../src/agent/tools/rename_note.ts'), fakes);
  const { createFolder } = await load(path.resolve(__dirname, '../src/agent/tools/create_folder.ts'), fakes);
  const { CheckpointManager, filesTouchedByTool } = await load(path.resolve(__dirname, '../src/agent/checkpoint.ts'), fakes);
  const types = await load(path.resolve(__dirname, '../src/types.ts'));

  // Deleting is no longer blocked by default; older settings are migrated once.
  t.eq(types.DEFAULT_SETTINGS.agentNeverApproveTools, [], 'nothing is on the never-approve list by default');
  const old = { agentNeverApproveTools: ['delete_note', 'web_fetch'] };
  types.restoreDeleteTool(old);
  t.eq(old, { agentNeverApproveTools: ['web_fetch'], deleteToolRestored: true }, 'settings from before 1.1 can delete again');
  old.agentNeverApproveTools.push('delete_note');
  types.restoreDeleteTool(old);
  t.ok(old.agentNeverApproveTools.includes('delete_note'), 'a later choice to block deleting is kept');

  // Files and whole folders go to the trash.
  const v = fakeVault({ 'Projects/a.md': 'alpha', 'Projects/sub/b.md': 'beta', 'Projects/pic.png': 'PNG', 'Keep.md': 'k' });
  t.ok((await deleteNote.preview(v.app, { path: 'Projects' })).includes('3 files'), 'the approval preview counts the files in a folder');
  t.eq(filesTouchedByTool(v.app, 'delete_note', { path: 'Projects' }).sort(), ['Projects/a.md', 'Projects/pic.png', 'Projects/sub/b.md'], 'deleting a folder touches every file in it');
  const removed = await deleteNote.run(v.app, { path: 'Projects' });
  t.ok(removed.startsWith('Moved folder to trash: Projects') && removed.includes('3 files'), 'a folder goes to the trash with everything in it');
  t.eq(v.trashed, ['Projects'], 'it is trashed through the file manager, following the trash setting');
  t.eq(v.app.vault.getAbstractFileByPath('Projects/sub/b.md'), null, 'its files are gone');
  t.eq(await deleteNote.run(v.app, { path: 'Keep.md' }), 'Moved to trash: Keep.md', 'single files still go to the trash');
  t.ok((await deleteNote.run(v.app, { path: 'Missing.md' })).startsWith('Error: not found'), 'a missing path is an error');
  for (const p of ['./', '.obsidian', '.obsidian/plugins/glossa', '.Obsidian/app.json']) {
    t.eq((await deleteNote.checkPermissions(v.app, { path: p })).behavior, 'deny', `deleting "${p}" is refused before any approval`);
    t.ok((await deleteNote.run(v.app, { path: p })).startsWith('Error: refusing'), `deleting "${p}" is refused when run`);
  }
  t.eq((await deleteNote.checkPermissions(v.app, { path: 'Notes/x.md' })).behavior, 'passthrough', 'other deletes go through the usual approval');

  // Folders move and rename with their files.
  const m = fakeVault({ 'Inbox/a.md': 'A', 'Inbox/deep/b.md': 'B' });
  t.eq(filesTouchedByTool(m.app, 'rename_note', { from: 'Inbox', to: 'Archive/Inbox' }).sort(),
    ['Archive/Inbox/a.md', 'Archive/Inbox/deep/b.md', 'Inbox/a.md', 'Inbox/deep/b.md'], 'moving a folder touches the old and new place of every file');
  t.ok((await renameNote.run(m.app, { from: 'Inbox', to: 'Archive/Inbox' })).startsWith('Renamed Inbox → Archive/Inbox'), 'folders can be moved');
  t.ok(m.app.vault.getAbstractFileByPath('Archive/Inbox/deep/b.md'), 'their files move along');
  t.ok((await renameNote.run(m.app, { from: 'Archive', to: 'Archive/Old' })).includes('into itself'), 'a folder cannot move into itself');
  t.eq((await renameNote.checkPermissions(m.app, { from: 'Archive', to: '.obsidian/Archive' })).behavior, 'deny', 'nothing moves into the configuration folder');
  t.eq((await renameNote.checkPermissions(m.app, { from: '.obsidian', to: 'Config' })).behavior, 'deny', 'the configuration folder does not move');
  t.eq((await renameNote.checkPermissions(m.app, { from: 'Archive', to: 'Old' })).behavior, 'passthrough', 'other moves go through the usual approval');

  // Empty folders can be created, parents included.
  const c = fakeVault({ 'Notes/a.md': 'A' });
  t.eq(await createFolder.run(c.app, { path: 'Projects/2026/Q4/' }), 'Created folder: Projects/2026/Q4', 'a nested folder is created with its parents');
  t.ok(c.app.vault.getAbstractFileByPath('Projects/2026') instanceof TFolder, 'the parent folders exist');
  t.eq(await createFolder.run(c.app, { path: 'Notes' }), 'Folder already exists: Notes', 'an existing folder is left as it is');
  t.ok((await createFolder.run(c.app, { path: 'Notes/a.md' })).startsWith('Error: a file already exists'), 'a file is not turned into a folder');
  t.eq((await createFolder.checkPermissions(c.app, { path: '.obsidian/snippets' })).behavior, 'deny', 'nothing is created in the configuration folder');

  // A deleted folder's notes can be brought back from the turn's checkpoint.
  const u = fakeVault({ 'Old/a.md': 'alpha', 'Old/deep/b.md': 'beta', 'Old/pic.png': 'PNG' });
  const checkpoints = new CheckpointManager(pluginFor(u.app));
  const touched = filesTouchedByTool(u.app, 'delete_note', { path: 'Old' });
  await checkpoints.snapshot('s', 't', touched);
  await deleteNote.run(u.app, { path: 'Old' });
  await checkpoints.recordAfter('s', 't', touched);
  const [entry] = await checkpoints.listForSession('s');
  t.eq(entry.snapshots.map(s => s.after.change.kind), ['deleted', 'deleted', 'deleted'], 'every deleted file shows in the turn summary');
  t.eq(await checkpoints.rollback('s', 't', ['Old/a.md', 'Old/deep/b.md']), { restored: 2, failed: [] }, 'deleted notes can be restored');
  t.eq(await u.app.vault.read(u.app.vault.getAbstractFileByPath('Old/deep/b.md')), 'beta', 'with their folders recreated');
  const image = await checkpoints.rollback('s', 't', ['Old/pic.png']);
  t.ok(image.restored === 0 && image.failed.length === 1, 'files text cannot restore stay with the trash');

  // A very large folder keeps no copies but is still listed.
  const big = fakeVault(Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`Big/n${i}.md`, 'note'])));
  const bigCheckpoints = new CheckpointManager(pluginFor(big.app));
  const bigTouched = filesTouchedByTool(big.app, 'delete_note', { path: 'Big' });
  await bigCheckpoints.snapshot('s', 't', bigTouched);
  await deleteNote.run(big.app, { path: 'Big' });
  await bigCheckpoints.recordAfter('s', 't', bigTouched);
  const [bigEntry] = await bigCheckpoints.listForSession('s');
  t.ok(bigEntry.snapshots.every(s => s.contentSkipped && s.contentBefore === null && s.undoBlocked), 'a very large folder keeps no copies');
  t.ok(bigEntry.snapshots.every(s => s.after.change.kind === 'deleted' && s.after.change.dels === null), 'its files are listed as deleted without line counts');

  // In Act mode the agent can delete after approval.
  const loop = await load(path.resolve(__dirname, '../src/agent/loop.ts'), fakes);
  const live = fakeVault({ 'Drafts/old.md': 'x', 'Drafts/older.md': 'y' });
  let step = 0;
  const results = [];
  const approvals = [];
  await loop.runAgentLoop({
    app: live.app,
    provider: {
      id: 'test', displayName: 'Test', isAvailable: async () => true, defaultModel: () => 'test',
      async *stream(req) {
        step += 1;
        if (step === 1) { yield { type: 'tool_call', id: 'load', name: 'tool_search', args: { exact_names: ['delete_note'] } }; yield { type: 'final', text: '' }; return; }
        if (step === 2) { yield { type: 'tool_call', id: 'del', name: 'delete_note', args: { path: 'Drafts' } }; yield { type: 'final', text: '' }; return; }
        results.push([...req.messages].reverse().find(message => message.role === 'tool')?.content);
        yield { type: 'text', text: 'done' };
        yield { type: 'final', text: 'done' };
      },
    },
    systemPrompt: 'test', userContent: 'delete the Drafts folder', history: [], enableTools: true,
    permissionLevel: 'workspace-write', runMode: 'act', maxSteps: 4,
    autoApproveTools: [], neverApproveTools: types.DEFAULT_SETTINGS.agentNeverApproveTools,
    approver: async tool => { approvals.push(tool.spec.name); return { ok: true }; },
    onText: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onStepBoundary: () => {}, onFinal: () => {},
    onError: error => { throw new Error(error); },
  });
  t.eq(approvals, ['delete_note'], 'deleting asks for approval');
  t.ok(String(results[0]).startsWith('Moved folder to trash: Drafts'), 'and then deletes the folder');
  t.eq(live.trashed, ['Drafts'], 'through the trash');
};
