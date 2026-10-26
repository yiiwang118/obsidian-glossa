const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

exports.run = async (t, load) => {
  const { evaluateLearningFiles } = await load(path.resolve(__dirname, '../src/agent/file_evaluation.ts'));
  const { parseFileExamples, fixturePath } = await load(path.resolve(__dirname, '../src/agent/file_evaluation_contract.ts'));
  const core = await load(path.resolve(__dirname, '../src/agent/learning_contract.ts'));
  const store = await load(path.resolve(__dirname, '../src/agent/learning_store.ts'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glossa-file-evaluation-'));
  const writes = [];
  const adapter = {
    exists: async p => { try { await fs.access(path.join(root, p)); return true; } catch { return false; } },
    mkdir: async p => fs.mkdir(path.join(root, p), { recursive: true }),
    read: async p => fs.readFile(path.join(root, p), 'utf8'),
    write: async (p, text) => { writes.push(p); await fs.writeFile(path.join(root, p), text); },
    remove: async p => fs.unlink(path.join(root, p)),
    rmdir: async p => fs.rm(path.join(root, p), { recursive: true, force: true }),
    rename: async (a, b) => fs.rename(path.join(root, a), path.join(root, b)),
  };
  const before = '---\ntags: [test]\n---\n# Old\n[[Keep]]\n';
  const after = before.replace('# Old', '# New');
  const example = { name: 'Preserve and repeat', request: 'Change Old to New in note.md.', files: { 'note.md': before, 'other.md': 'Keep me' }, expectedFiles: { 'note.md': after }, repeat: true };
  const draft = { name: 'rename-heading', title: 'Rename heading', description: 'Preserve note structure.', whenToUse: 'When renaming headings.',
    body: '# Goal\nRename requested headings.\n# Workflow\nRead and edit only the heading.\n# Guardrails\nKeep other content.\n# Done when\nHeading matches.',
    examples: [true, true, false].map((v, i) => ({ name: `Text ${i}`, request: 'Task', input: '', shouldTrigger: v, includes: ['OK'], excludes: [] })),
    fileExamples: [example],
  };
  const requests = [], progress = [], firstReads = [];
  const provider = { async *stream(req) {
    requests.push(JSON.stringify(req));
    const last = req.messages.at(-1);
    if (req.messages.length === 1) yield { type: 'tool_call', id: 'read', name: 'read_note', args: { path: 'note.md' } };
    else if (last.toolName === 'read_note') {
      firstReads.push(last.content);
      if (last.content.includes('# Old')) yield { type: 'tool_call', id: 'edit', name: 'file_edit', args: { file_path: 'note.md', old_string: '# Old', new_string: '# New' } };
    }
    yield { type: 'final', text: '', usage: { input: 10, output: 2 } };
  } };
  try {
    await fs.writeFile(path.join(root, 'real.md'), 'Untouched real note');
    const result = await evaluateLearningFiles(adapter, provider, draft, null, 'api', 'model', new AbortController().signal, (d, n) => progress.push([d, n]));
    t.eq(result.rows[0].candidate.failures, [], 'real file edits preserve YAML, wikilinks and unrelated notes');
    t.eq(firstReads, [before, after, before, after], 'baseline and candidate start independently; repeat sees modified files');
    t.eq(progress, [[1, 2], [2, 2]], 'reports progress for both sides');
    t.ok(result.rows[0].candidate.inputTokens > 0, 'records evaluation usage');
    t.eq(await fs.readdir(path.join(root, '.glossa/evaluations')), [], 'all fixture directories removed after success');
    t.eq(await fs.readFile(path.join(root, 'real.md'), 'utf8'), 'Untouched real note', 'ordinary vault file untouched');
    t.ok(requests.every(r => !r.includes('expectedFiles') && !r.includes('Preserve and repeat')), 'expected results and checks withheld from the model');
    t.ok(writes.every(p => p.startsWith('.glossa/evaluations/')), 'all tool writes confined to private fixture roots');
    const textEvaluation = { ...result, rows: draft.examples.map(e => ({ ...result.rows[0], name: e.name })) };
    t.ok(!core.canActivate(draft, textEvaluation, null), 'file examples require additional passing evaluation');
    t.ok(core.canActivate(draft, textEvaluation, null, result), 'both passing evaluations enable exact draft');
    t.ok(!core.canActivate({ ...draft, fileExamples: [{ ...example, request: 'Changed' }] }, textEvaluation, null, result), 'file task changes invalidate verification');
    const version = { ...draft, id: 'v1', createdAt: 1, correction: 'Keep note structure', evaluation: textEvaluation, fileEvaluation: result };
    await store.saveLearningVersion(adapter, 0, version, true, null);
    const ledger = await store.readLearningLedger(adapter);
    t.eq(ledger.skills[0].versions[0].fileEvaluation.rows.length, 1, 'single file case survives persistence');
    t.eq((await store.loadLearnedSkills(adapter)).length, 1, 'verified file skill loads through activation gate');

    const failProvider = { async *stream(req) {
      if (req.messages.length === 1) yield { type: 'tool_call', id: 'escape', name: 'write_note', args: { path: '../../real.md', content: 'bad' } };
      else t.ok(req.messages.at(-1).toolIsError, 'path escape is returned as a tool error');
      yield { type: 'final', text: '' };
    } };
    const failed = await evaluateLearningFiles(adapter, failProvider, { ...draft, fileExamples: [{ ...example, repeat: false }] }, null, 'api', 'model', new AbortController().signal, () => {});
    t.ok(failed.rows[0].candidate.failures.length > 0, 'incorrect final contents fail local checks');
    t.eq(await fs.readFile(path.join(root, 'real.md'), 'utf8'), 'Untouched real note', 'escape cannot overwrite real files');
    const negative = { ...draft, fileExamples: [{ ...example, repeat: false, expectedFiles: { ...example.files } }] };
    const noop = { async *stream() { yield { type: 'final', text: 'No change needed' }; } };
    const untouched = await evaluateLearningFiles(adapter, noop, negative, null, 'api', 'model', new AbortController().signal, () => {});
    t.eq(untouched.rows[0].candidate.failures, [], 'negative example can require all files unchanged');
    let replayed;
    const thinking = { async *stream(req) {
      if (req.messages.length === 1) {
        yield { type: 'reasoning', text: 'Plan' };
        yield { type: 'tool_call', id: 'r', name: 'read_note', args: { path: 'note.md' } };
        yield { type: 'final', text: '', thinkingBlocks: [{ type: 'thinking', thinking: 'Plan', signature: 'sig' }] };
        return;
      }
      replayed ??= req.messages.find(m => m.role === 'assistant');
      yield { type: 'final', text: '' };
    } };
    await evaluateLearningFiles(adapter, thinking, negative, null, 'api', 'model', new AbortController().signal, () => {});
    t.eq([replayed.reasoningContent, replayed.thinkingBlocks[0].signature], ['Plan', 'sig'], 'reasoning and thinking blocks are replayed with the tool step');
    let secondEdit;
    const twoEdits = { async *stream(req) {
      if (req.messages.length === 1) yield { type: 'tool_call', id: 'r', name: 'read_note', args: { path: 'note.md' } };
      else if (req.messages.length === 3) {
        yield { type: 'tool_call', id: 'e1', name: 'file_edit', args: { file_path: 'note.md', old_string: '# Old', new_string: '# New' } };
        yield { type: 'tool_call', id: 'e2', name: 'file_edit', args: { file_path: 'note.md', old_string: '[[Keep]]', new_string: '[[Kept]]' } };
      } else secondEdit ??= req.messages.at(-1);
      yield { type: 'final', text: '' };
    } };
    const edited = await evaluateLearningFiles(adapter, twoEdits, { ...draft, fileExamples: [{ ...example, repeat: false, expectedFiles: { 'note.md': after.replace('[[Keep]]', '[[Kept]]') } }] }, null, 'api', 'model', new AbortController().signal, () => {});
    t.ok(!secondEdit.toolIsError, 'the model may edit again what it just wrote');
    t.eq(edited.rows[0].candidate.failures, [], 'consecutive edits after one read reach the expected file');
    let pass = 0, repeatEdit;
    const repeat = { async *stream(req) {
      if (req.messages.length === 1) {
        pass++;
        yield pass === 1
          ? { type: 'tool_call', id: 'r', name: 'read_note', args: { path: 'note.md' } }
          : { type: 'tool_call', id: 'e', name: 'file_edit', args: { file_path: 'note.md', old_string: '# Old', new_string: '# New' } };
      } else if (pass === 2) repeatEdit ??= req.messages.at(-1);
      yield { type: 'final', text: '' };
    } };
    await evaluateLearningFiles(adapter, repeat, draft, null, 'api', 'model', new AbortController().signal, () => {});
    t.eq(repeatEdit.content, 'Read the current note before changing it.', 'a repeat pass is a new conversation that must read first');
    const controller = new AbortController();
    const abortProvider = { async *stream() { controller.abort(); yield { type: 'final', text: '' }; } };
    let aborted = false;
    try { await evaluateLearningFiles(adapter, abortProvider, draft, null, 'api', 'model', controller.signal, () => {}); } catch { aborted = true; }
    t.ok(aborted, 'parent cancellation propagates');
    t.eq(await fs.readdir(path.join(root, '.glossa/evaluations')), [], 'cancelled and failed evaluations also clean up');
    for (const p of ['../note.md', '/note.md', 'a/../note.md', '.obsidian/x.md', 'x\\y.md', 'CON.md']) t.throws(() => fixturePath(p), 'reject unsafe fixture ' + p);
    t.throws(() => parseFileExamples([{ ...example, expectedFiles: { 'Note.md': after } }]), 'cross-map case collisions rejected');
    t.throws(() => parseFileExamples([{ ...example, files: { 'a.md': '', 'a.md/b.md': '' } }]), 'file and directory collisions rejected');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
};
