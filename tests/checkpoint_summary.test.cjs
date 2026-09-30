const path = require('node:path');

exports.run = async (t, load) => {
  class TFile { constructor(path) { this.path = path; } }
  const { CheckpointManager } = await load(path.resolve(__dirname, '../src/agent/checkpoint.ts'), { TFile });
  function fixture(initial) {
    const files = new Map(Object.entries(initial)), metadata = new Map();
    const state = { files, beforeProcess: null };
    const adapter = {
      exists: async p => metadata.has(p),
      read: async p => metadata.get(p),
      write: async (p, content) => { metadata.set(p, content); },
      remove: async p => { metadata.delete(p); },
      rename: async (from, to) => { metadata.set(to, metadata.get(from)); metadata.delete(from); },
    };
    const plugin = {
      manifest: { dir: '.obsidian/plugins/glossa' }, settings: { checkpointEnabled: true },
      encryptBlob: async text => text, decryptBlob: async text => text,
      app: {
        vault: {
          adapter,
          getAbstractFileByPath: p => files.has(p) ? new TFile(p) : null,
          read: async file => files.get(file.path),
          create: async (p, content) => {
            if (files.has(p)) throw new Error('already exists');
            files.set(p, content);
          },
          process: async (file, fn) => {
            state.beforeProcess?.(file.path);
            const content = fn(files.get(file.path)); files.set(file.path, content); return content;
          },
        },
        fileManager: { trashFile: async file => { files.delete(file.path); } },
      },
    };
    state.manager = new CheckpointManager(plugin);
    return state;
  }

  const f = fixture({ 'A.md': 'old\n', 'B.md': 'stable\n' });
  await Promise.all([f.manager.snapshot('session', 'turn', ['A.md']), f.manager.snapshot('session', 'turn', ['B.md'])]);
  f.files.set('A.md', 'new\n');
  await f.manager.recordAfter('session', 'turn', ['A.md', 'B.md']);
  let entry = (await f.manager.listForSession('session'))[0];
  t.eq(entry.snapshots.length, 2, 'concurrent snapshots retain both paths');
  t.eq(entry.snapshots.find(s => s.path === 'A.md').after.change, { kind: 'modified', adds: 1, dels: 1 }, 'recorded changes reflect actual tool result');
  t.eq(entry.snapshots.find(s => s.path === 'B.md').after.change, null, 'failed/no-op write is not a changed file');
  f.files.set('A.md', 'user edit\n');
  let result = await f.manager.rollback('session', 'turn');
  t.eq(result.restored, 0, 'later user edit blocks rollback');
  t.eq(f.files.get('A.md'), 'user edit\n', 'later user content is preserved');
  f.files.set('A.md', 'new\n');
  result = await f.manager.rollback('session', 'turn', ['A.md']);
  t.eq(result, { restored: 1, failed: [] }, 'single-file rollback succeeds when still matching');
  t.eq(f.files.get('B.md'), 'stable\n', 'single-file rollback leaves other files alone');
  t.eq(f.files.get('A.md'), 'old\n', 'undo restores original content');
  t.eq((await f.manager.rollback('session', 'turn')).restored, 0, 'repeated undo does not write again');

  const g = fixture({ 'deleted.md': 'restore me\n' });
  await g.manager.snapshot('s', 't', ['created.md', 'deleted.md']);
  g.files.set('created.md', 'created\n'); g.files.delete('deleted.md');
  await g.manager.recordAfter('s', 't', ['created.md', 'deleted.md']);
  result = await g.manager.rollback('s', 't', ['created.md']);
  t.eq(result.restored, 1, 'created file can be undone separately');
  t.ok(!g.files.has('created.md') && !g.files.has('deleted.md'), 'single-file undo does not undo a deletion elsewhere');
  result = await g.manager.rollback('s', 't');
  t.eq(result.restored, 1, 'undo all restores remaining deleted file');
  t.eq(g.files.get('deleted.md'), 'restore me\n', 'deleted contents are restored');

  const h = fixture({ 'A.md': 'a', 'B.md': 'b' });
  await h.manager.snapshot('s', 't', ['A.md', 'B.md']);
  h.files.set('A.md', 'A'); h.files.set('B.md', 'B');
  await h.manager.recordAfter('s', 't', ['A.md', 'B.md']);
  h.files.set('B.md', 'external');
  result = await h.manager.rollback('s', 't');
  t.eq(result.restored, 0, 'all-files undo preflights every file before first write');
  t.eq(h.files.get('A.md'), 'A', 'preflight failure leaves other selected changes intact');
  h.beforeProcess = p => h.files.set(p, 'raced');
  result = await h.manager.rollback('s', 't', ['A.md']);
  t.eq(result.restored, 0, 'edit racing the undo is rejected inside atomic process');
  t.eq(h.files.get('A.md'), 'raced', 'racing edit is preserved');

  const repeated = fixture({ 'A.md': 'first\n' });
  await repeated.manager.snapshot('s', 't', ['A.md']);
  repeated.files.set('A.md', 'second\n');
  await repeated.manager.recordAfter('s', 't', ['A.md']);
  await repeated.manager.snapshot('s', 't', ['A.md']);
  repeated.files.set('A.md', 'third\nlast\n');
  await repeated.manager.recordAfter('s', 't', ['A.md']);
  entry = (await repeated.manager.listForSession('s'))[0];
  t.eq(entry.snapshots[0].contentBefore, 'first\n', 'repeated same-turn edits preserve the first before-state');
  t.eq(entry.snapshots[0].after.change.adds, 2, 'summary compares final result to turn start');
  await repeated.manager.rollback('s', 't');
  t.eq(repeated.files.get('A.md'), 'first\n', 'undo covers all edits in the turn');

  const blocked = fixture({ 'A.md': 'before' });
  await blocked.manager.snapshot('s', 'legacy', ['A.md']);
  blocked.files.set('A.md', 'after');
  t.eq((await blocked.manager.rollback('s', 'legacy')).restored, 0, 'legacy checkpoints cannot overwrite an unverified current file');
  await blocked.manager.recordAfter('s', 'legacy', ['A.md'], true);
  t.eq((await blocked.manager.rollback('s', 'legacy')).restored, 0, 'rename side effects cannot be partially undone by a file snapshot');
  const binary = fixture({ 'paper.pdf': 'binary bytes are not a text backup' });
  await binary.manager.snapshot('s', 't', ['paper.pdf']);
  binary.files.delete('paper.pdf');
  await binary.manager.recordAfter('s', 't', ['paper.pdf']);
  t.eq((await binary.manager.rollback('s', 't')).restored, 0, 'binary files cannot be recreated from a lossy text snapshot');
  t.eq((await binary.manager.listForSession('s'))[0].snapshots[0].after.change.dels, null, 'binary content never produces misleading line counts');
};
