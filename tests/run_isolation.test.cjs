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
  for (const [p, content] of Object.entries(tree)) file(p, content);
  const stored = new Map();
  const trashed = [];
  const app = {
    workspace: {}, metadataCache: {},
    vault: {
      configDir: '.obsidian', getName: () => 'Test',
      adapter: {
        exists: async p => stored.has(p), read: async p => stored.get(p), write: async (p, s) => { stored.set(p, s); },
        mkdir: async () => {}, list: async () => ({ files: [], folders: [] }),
        rename: async (a, b) => { stored.set(b, stored.get(a)); stored.delete(a); }, remove: async p => { stored.delete(p); },
      },
      getAbstractFileByPath: p => nodes.get(p) ?? null,
      read: async f => f.content,
      create: async (p, content) => file(p, content),
      createFolder: async p => folder(p),
    },
    fileManager: {
      trashFile: async node => { trashed.push(node.path); node.parent.children = node.parent.children.filter(c => c !== node); nodes.delete(node.path); },
      renameFile: async (node, to) => {
        nodes.delete(node.path); node.parent.children = node.parent.children.filter(c => c !== node);
        const parent = folder(to.split('/').slice(0, -1).join('/'));
        node.path = to; node.name = to.split('/').pop(); node.parent = parent; parent.children.push(node); nodes.set(to, node);
      },
    },
  };
  return { app, trashed };
}

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/** A provider that plays one step per model request; a step may wait first. */
function scripted(steps) {
  let i = 0;
  return {
    id: 'test', displayName: 'Test', isAvailable: async () => true, defaultModel: () => 'test',
    async *stream() {
      const step = steps[i++] ?? { text: 'done' };
      if (step.before) await step.before();
      for (const [name, args] of step.calls ?? []) yield { type: 'tool_call', id: `${name}-${i}`, name, args };
      if (step.text) yield { type: 'text', text: step.text };
      yield { type: 'final', text: step.text ?? '' };
    },
  };
}

exports.run = async (t, load) => {
  const runtime = await load(path.resolve(__dirname, 'support/agent_runtime.ts'), { TFile, TFolder });
  const run = (app, provider, extra = {}) => runtime.runAgentLoop({
    app, provider, systemPrompt: 'test', userContent: 'go', history: [], enableTools: true,
    permissionLevel: 'workspace-write', runMode: 'act', maxSteps: 6, autoApproveTools: [], neverApproveTools: [],
    onText: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onStepBoundary: () => {}, onFinal: () => {},
    onError: () => {}, ...extra,
  });

  // A skill that allows deleting in one chat does not approve deletes in another.
  runtime.registerBundledSkill({ name: 'cleanup', description: 'Clean old drafts', allowedTools: ['delete_note'], body: 'Delete old drafts.' });
  const vault = fakeVault({ 'A/old.md': 'a', 'B/old.md': 'b' });
  let releaseB; const bWaits = new Promise(resolve => { releaseB = resolve; });
  let bDecided; const bChecked = new Promise(resolve => { bDecided = resolve; });
  const approvalsA = [], approvalsB = [];
  const runB = run(vault.app, scripted([
    { calls: [['tool_search', { exact_names: ['delete_note'] }]] },
    { before: () => bWaits, calls: [['delete_note', { path: 'B/old.md' }]] },
  ]), {
    approver: async tool => { approvalsB.push(tool.spec.name); bDecided(); return { ok: true }; },
    onToolEnd: ev => { if (ev.name === 'delete_note' && ev.status !== 'running') bDecided(); },
  });
  await tick(10);
  const runA = run(vault.app, scripted([
    { calls: [['tool_search', { exact_names: ['skill', 'delete_note'] }]] },
    { calls: [['skill', { skill: 'cleanup' }]] },
    // With the skill active in A, let B try its delete.
    { before: async () => { releaseB(); await bChecked; }, calls: [['delete_note', { path: 'A/old.md' }]] },
  ]), { approver: async tool => { approvalsA.push(tool.spec.name); return { ok: true }; } });
  await Promise.all([runA, runB]);
  t.eq(approvalsB, ['delete_note'], "another chat's skill does not skip this chat's approval");
  t.eq(approvalsA, ['skill'], 'the chat that loaded the skill deletes without asking again');
  t.eq(vault.trashed.sort(), ['A/old.md', 'B/old.md'], 'both deletes ran after their approvals');

  // Stop pressed while waiting for another chat's file lock cancels the change.
  const locked = fakeVault({ 'Notes/a.md': 'A' });
  let releaseMove; const moveWaits = new Promise(resolve => { releaseMove = resolve; });
  const rename = locked.app.fileManager.renameFile;
  locked.app.fileManager.renameFile = async (node, to) => { await moveWaits; return rename(node, to); };
  const mover = run(locked.app, scripted([
    { calls: [['tool_search', { exact_names: ['rename_note'] }]] },
    { calls: [['rename_note', { from: 'Notes/a.md', to: 'Notes/b.md' }]] },
  ]), { approver: async () => ({ ok: true }) });
  await tick(20);
  const stop = new AbortController();
  let deleteApproved; const deleteWaiting = new Promise(resolve => { deleteApproved = resolve; });
  const results = [];
  const deleter = run(locked.app, scripted([
    { calls: [['tool_search', { exact_names: ['delete_note'] }]] },
    { calls: [['delete_note', { path: 'Notes/b.md' }]] },
  ]), {
    signal: stop.signal,
    approver: async () => { deleteApproved(); return { ok: true }; },
    onToolEnd: ev => { if (ev.name === 'delete_note' && ev.status !== 'running') results.push(ev); },
  });
  await deleteWaiting;
  await tick(20);
  stop.abort();
  releaseMove();
  await Promise.all([mover, deleter]);
  t.ok(locked.app.vault.getAbstractFileByPath('Notes/b.md'), 'the moved note is not deleted after Stop');
  t.eq(locked.trashed, [], 'nothing went to the trash');
  t.eq(results.map(ev => [ev.status, ev.result]), [['cancelled', 'Cancelled before execution.']], 'the waiting delete is reported as cancelled');
};
