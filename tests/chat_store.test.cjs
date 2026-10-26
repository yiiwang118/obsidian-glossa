const path = require('path');

function fakeVault() {
  const files = new Map();
  const dirs = new Set();
  const writes = [];
  const reads = [];
  const adapter = {
    exists: async p => files.has(p) || dirs.has(p),
    read: async p => { reads.push(p); if (!files.has(p)) throw new Error(`ENOENT ${p}`); return files.get(p); },
    write: async (p, s) => { writes.push(p); files.set(p, s); },
    mkdir: async p => { dirs.add(p); },
    list: async dir => ({
      files: [...files.keys()].filter(f => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/')),
      folders: [...dirs].filter(d => d.startsWith(`${dir}/`)),
    }),
    rename: async (a, b) => { files.set(b, files.get(a)); files.delete(a); },
    remove: async p => { files.delete(p); dirs.delete(p); },
  };
  return { files, writes, reads, host: { app: { vault: { adapter } }, manifest: { dir: 'plug' } } };
}

const chat = (n, extra = {}) => ({
  id: `c${n}`, title: `Chat ${n}`, createdAt: 1, updatedAt: 1000 + (typeof n === 'number' ? n : 0), mode: 'chat', endpointId: 'api',
  messages: [
    { id: `u${n}`, role: 'user', content: `Expanded prompt with attached note secret-note-${n}`, displayContent: `question ${n}`, timestamp: 1 },
    { id: `a${n}`, role: 'assistant', content: `answer ${n}`, timestamp: 2 },
  ],
  ...extra,
});
const json = (v, p) => JSON.parse(v.files.get(p));

exports.run = async (t, load) => {
  const { ChatStore, chatSearchPreview } = await load(path.resolve(__dirname, '../src/chat_store.ts'));
  const stores = [];
  const open = async (v, legacy) => { const s = new ChatStore(v.host); stores.push(s); await s.load(legacy); return s; };

  // Upgrade from the single-file store: nothing is capped, each chat gets a file.
  const v = fakeVault();
  const v3 = {
    version: 3, updatedAt: 5,
    folders: [{ id: 'f1', name: 'Research', createdAt: 1 }],
    sessions: [...Array.from({ length: 150 }, (_, i) => chat(i, i === 3 ? { folderId: 'f1' } : {})), chat('gone')],
    deletedSessionIds: { cgone: 1 },
  };
  v.files.set('plug/chats.json', JSON.stringify(v3));
  const store = await open(v);
  t.eq(store.listSessions().length, 150, 'more than 100 chats are kept');
  t.eq(store.listSessions()[0].id, 'c149', 'chats are listed newest first');
  t.eq(json(v, 'plug/chats.v3-backup.json').sessions.length, 151, 'the old store is kept as it was');
  const index = json(v, 'plug/chats.json');
  t.eq(index.version, 4, 'chats.json becomes an index');
  t.ok(index.sessions.every(s => !('messages' in s)), 'the index holds no messages');
  t.eq(index.folders[0].name, 'Research', 'folders move into the index');
  t.eq(json(v, 'plug/chats/c7.json').session.messages.length, 2, 'each chat has its own file');
  t.ok(!v.files.has('plug/chats/cgone.json'), 'deleted chats are not moved');
  t.eq(store.listSessions().find(s => s.id === 'c3').folderId, 'f1', 'folder membership is listed');

  // Reloading reads only the index; a chat file is read when the chat opens.
  v.reads.length = 0;
  const again = await open(v);
  t.ok(!v.reads.some(p => p.startsWith('plug/chats/')), 'loading reads no chat files');
  t.eq(again.loadedSession('c7'), undefined, 'chats are not in memory until opened');
  const summary = again.listSessions().find(s => s.id === 'c7');
  t.ok(summary.preview.includes('question 7') && summary.preview.includes('answer 7'), 'the search preview holds typed text and answers');
  t.ok(!summary.preview.includes('secret-note'), 'the search preview leaves out attached notes');
  const [opened, twice] = await Promise.all([again.openSession('c7'), again.openSession('c7')]);
  t.eq(opened.messages[1].content, 'answer 7', 'opening reads the chat file');
  t.ok(opened === twice && opened === again.loadedSession('c7'), 'an opened chat stays one object');

  // A save writes that chat; the index follows later.
  v.writes.length = 0;
  opened.messages.push({ id: 'u-follow', role: 'user', content: 'follow up', timestamp: 3 });
  opened.updatedAt = 99999;
  await again.saveSession(opened);
  const written = v.writes.filter(p => p.startsWith('plug/chats/'));
  t.ok(written.length > 0 && written.every(p => p.startsWith('plug/chats/c7.json')), 'a save writes only that chat file');
  t.ok(!v.writes.some(p => p.startsWith('plug/chats.json')), 'the index write waits while a chat is saving');
  t.eq(again.listSessions()[0].id, 'c7', 'the list follows the save at once');
  await again.flush();
  t.eq(json(v, 'plug/chats.json').sessions[0].id, 'c7', 'flush writes the index');

  // A chat listed before its first save is not written yet.
  const fresh = chat('fresh', { updatedAt: 100000 });
  v.writes.length = 0;
  again.track(fresh);
  t.ok(again.hasSession('cfresh') && again.listSessions()[0].id === 'cfresh', 'a tracked chat is listed at once');
  t.eq(v.writes.length, 0, 'tracking writes nothing');
  await again.saveSession(fresh);
  await again.flush();

  // A lost index is rebuilt from the chat files.
  v.files.delete('plug/chats.json');
  v.files.delete('plug/chats.json.bak');
  const rebuilt = await open(v);
  t.eq(rebuilt.listSessions().length, 151, 'a lost index is rebuilt from the chat files');
  t.eq((await rebuilt.openSession('c7')).messages.length, 3, 'rebuilt chats open with their latest content');

  // A damaged index comes back from its previous copy, folders included.
  await rebuilt.createFolder('Kept');
  await rebuilt.persist();
  v.files.set('plug/chats.json', '{damaged');
  const recovered = await open(v);
  t.ok(recovered.listFolders().some(f => f.name === 'Kept'), 'folders come back from the index backup');
  t.eq(recovered.listSessions().length, 151, 'chats come back with a damaged index');

  // Deleting removes the file, the copy in the upgrade backup and the index's previous copy.
  await recovered.deleteSession('c5');
  await recovered.flush();
  t.ok(!v.files.has('plug/chats/c5.json'), 'deleting removes the chat file');
  t.ok(!json(v, 'plug/chats.v3-backup.json').sessions.some(s => s.id === 'c5'), 'deleting removes the chat from the upgrade backup');
  t.ok(!json(v, 'plug/chats.json.bak').sessions.some(s => s.id === 'c5'), 'the previous index copy no longer lists it');
  v.files.set('plug/chats/c5.json', JSON.stringify({ version: 4, session: chat(5) }));
  const synced = await open(v);
  t.ok(!synced.hasSession('c5'), 'a stale synced file does not bring a deleted chat back');
  t.ok(!v.files.has('plug/chats/c5.json'), 'the stale file is removed');

  // An older Glossa may write chats.json again; newer copies win either way.
  v.files.set('plug/chats.json', JSON.stringify({
    version: 3, folders: [], deletedSessionIds: {},
    sessions: [chat('older', { updatedAt: 50000 }), chat(8, { updatedAt: 60000, title: 'edited in 1.0' }), chat(7)],
  }));
  const back = await open(v);
  t.ok(back.hasSession('colder'), 'a chat written by an older Glossa is picked up');
  t.eq((await back.openSession('c8')).title, 'edited in 1.0', 'a newer copy from the older store wins');
  t.eq((await back.openSession('c7')).messages.length, 3, 'an older copy does not overwrite a newer chat file');
  t.eq(back.listSessions().length, 151, 'chat files the older store did not list stay listed');
  t.eq(json(v, 'plug/chats.v3-backup.json').sessions.length, 150, 'the first upgrade backup is not replaced');

  // Endpoint and context clean-ups reach chats that were never opened.
  t.eq(await back.detachEndpoint('api'), 151, 'a deleted endpoint is detached from every chat');
  const detached = await open(v);
  t.eq((await detached.openSession('c9')).endpointId, null, 'the detachment is written to unopened chats');
  const withContext = chat('ctx', { messages: [{ id: 'm', role: 'user', content: 'x', timestamp: 1, contextSnapshot: [{ id: 'i', kind: 'file', label: 'n', content: 'body' }] }] });
  v.files.set('plug/chats/cctx.json', JSON.stringify({ version: 4, session: withContext }));
  const ctxStore = await open(v);
  t.eq(await ctxStore.purgeLegacyContext(), 1, 'old context bodies are stripped from chat files');
  t.ok(!v.files.get('plug/chats/cctx.json').includes('"body"'), 'the stripped body is gone from disk');

  // A damaged chat file does not break the list.
  v.files.set('plug/chats/c11.json', '{broken');
  const damaged = await open(v);
  t.eq(await damaged.openSession('c11'), undefined, 'a damaged chat file cannot be opened');
  t.ok(damaged.hasSession('c11'), 'it stays listed so it can be deleted');

  // Clearing removes every chat file and both backups.
  await damaged.clearAll();
  await damaged.flush();
  t.eq([...v.files.keys()].filter(p => p.startsWith('plug/chats/')).length, 0, 'clearing removes every chat file');
  t.ok(!v.files.has('plug/chats.v3-backup.json'), 'clearing removes the upgrade backup');
  t.eq(json(v, 'plug/chats.json.bak').sessions.length, 0, 'the previous index copy is emptied too');
  t.eq((await open(v)).listSessions().length, 0, 'nothing comes back after clearing');

  // The upgrade backup is removed a month later.
  const old = fakeVault();
  old.files.set('plug/chats.json', JSON.stringify({ version: 3, folders: [], sessions: [chat(1)] }));
  await (await open(old)).flush();
  const aged = json(old, 'plug/chats.json');
  aged.backupAt = Date.now() - 31 * 24 * 3600_000;
  old.files.set('plug/chats.json', JSON.stringify(aged));
  await (await open(old)).flush();
  t.ok(!old.files.has('plug/chats.v3-backup.json'), 'the upgrade backup expires after a month');

  // Chats from data.json (before chats.json existed) are moved too.
  const legacy = fakeVault();
  const fromData = await open(legacy, [chat(1), chat(2)]);
  t.eq(fromData.listSessions().length, 2, 'chats from data.json are kept');
  t.ok(legacy.files.has('plug/chats/c1.json') && legacy.files.has('plug/chats.v3-backup.json'), 'they get their own files and a backup');

  // A chat that cannot be written keeps the old store until every chat has its file.
  const flaky = fakeVault();
  flaky.files.set('plug/chats.json', JSON.stringify({ version: 3, folders: [], sessions: [chat(1), chat(2)] }));
  const write = flaky.host.app.vault.adapter.write;
  let diskFull = true;
  flaky.host.app.vault.adapter.write = async (p, s) => {
    if (diskFull && p.startsWith('plug/chats/c2.json')) throw new Error('disk full');
    return write(p, s);
  };
  const failing = await open(flaky);
  t.eq(failing.listSessions().length, 2, 'a chat that could not be written is still listed');
  await failing.saveSession({ ...(await failing.openSession('c1')), updatedAt: 5000 });
  await failing.flush();
  t.eq(json(flaky, 'plug/chats.json').version, 3, 'chats.json keeps the old store while a chat is unwritten');
  diskFull = false;
  const retried = await open(flaky);
  t.eq(retried.listSessions().length, 2, 'the move is retried on the next start and nothing is lost');
  t.eq(json(flaky, 'plug/chats.json').version, 4, 'the index replaces the old store once every chat has its file');
  t.eq((await retried.openSession('c2')).messages.length, 2, 'the retried chat opens with its messages');

  // An index entry whose file went missing comes back from the upgrade copy.
  const lost = fakeVault();
  lost.files.set('plug/chats.json', JSON.stringify({ version: 3, folders: [], sessions: [chat(1)] }));
  await (await open(lost)).flush();
  lost.files.delete('plug/chats/c1.json');
  const healed = await open(lost);
  t.eq(healed.listSessions().length, 1, 'a chat whose file is missing is restored from chats.v3-backup.json');
  t.ok(lost.files.has('plug/chats/c1.json'), 'and gets its own file again');
  for (const p of ['plug/chats.json', 'plug/chats.json.bak', 'plug/chats/c1.json']) lost.files.delete(p);
  t.eq((await open(lost)).listSessions().length, 1, 'with no index and no chat files, the upgrade copy is used for recovery');

  // The search preview stays bounded and covers every message of a long chat.
  const long = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, role: 'user', content: `topic-${i} ${'x'.repeat(500)}`, timestamp: i }));
  const preview = chatSearchPreview(long);
  t.ok(preview.length <= 3000, 'the search preview is bounded');
  t.ok(long.every((_, i) => preview.includes(`topic-${i} `)), 'every message keeps its start in the preview');
  t.eq(chatSearchPreview([{ id: 'x', role: 'user', content: 'short', timestamp: 1 }]), 'short', 'short chats are whole');

  // A copy starts without the original's run status, subtask progress and Codex thread.
  const dv = fakeVault();
  const ds = await open(dv);
  const running = chat('d1', { runs: [{ id: 'turn', startedAt: 1, checkpoint: { seq: 0, phase: 'running' }, events: [], state: { seq: 1, phase: 'running' } }],
    subtasks: [{ id: 's', title: 'Child', phase: 'running', startedAt: 1, steps: 0, output: '', queued: 0 }],
    nativeSession: { threadId: 'thread', ownerId: 'cd1', endpointId: 'codex', policyKey: 'p', historyKey: 'h' } });
  await ds.saveSession(running);
  const copy = await ds.duplicateSession('cd1');
  t.eq([copy.runs, copy.subtasks, copy.nativeSession], [undefined, undefined, undefined], 'a duplicated chat owns no run, subtask or Codex thread');
  t.eq(running.runs.length + running.subtasks.length, 2, 'the original keeps its own records');

  for (const s of stores) await s.flush();
};
