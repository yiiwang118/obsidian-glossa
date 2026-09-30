const path = require('node:path');

function content() {
  return {
    name: 'paper-notes', title: 'Paper notes',
    description: 'Preserve YAML and the original abstract when organizing paper notes.',
    whenToUse: 'Use when organizing a paper note.',
    body: '# Goal\nOrganize papers.\n# Workflow\nPreserve YAML and abstract. Append references.\n# Guardrails\nKeep original text.\n# Done when\nOriginal blocks remain.',
    examples: [
      { name: 'Paper A', request: 'Organize paper A', input: '---\ntitle: A\n---\nSummary A', shouldTrigger: true, includes: ['title: A', 'Summary A'], excludes: ['REPLACED'] },
      { name: 'Paper B', request: 'Organize paper B', input: 'Summary B', shouldTrigger: true, includes: ['Summary B'], excludes: [] },
      { name: 'Arithmetic', request: 'Return 2+2 as one digit', input: '', shouldTrigger: false, includes: ['4'], excludes: ['References'] },
    ],
  };
}

function adapter() {
  const files = new Map();
  return {
    files, exists: async p => files.has(p), read: async p => { if (!files.has(p)) throw new Error('Missing'); return files.get(p); },
    write: async (p, text) => { files.set(p, text); }, mkdir: async p => { files.set(p, ''); },
    remove: async p => { files.delete(p); }, rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
  };
}

exports.run = async (t, loadModule) => {
  const core = await loadModule(path.resolve(__dirname, '../src/agent/learning_contract.ts'));
  const store = await loadModule(path.resolve(__dirname, '../src/agent/learning_store.ts'));
  const model = await loadModule(path.resolve(__dirname, '../src/agent/learning_model.ts'));
  const reject = async (fn, label) => { try { await fn(); t.ok(false, label); } catch { t.ok(true, label); } };
  const draft = core.parseLearningContent({ ...content(), allowedTools: ['delete_note'], context: 'fork', model: 'secret' });
  t.eq(draft, content(), 'untrusted capability-bearing fields are never persisted');
  t.eq(core.learningSkill(draft).allowedTools, undefined, 'learned skills cannot grant permissions');
  t.throws(() => core.parseLearningContent({ ...draft, name: '../escape' }), 'names cannot escape the store');
  t.throws(() => core.parseLearningContent({ ...draft, body: 'Only vague advice' }), 'structured workflow required');
  t.throws(() => core.parseExamples(draft.examples.slice(0, 2)), 'requires positive and negative cases');
  t.throws(() => core.parseExamples(draft.examples.map(e => ({ ...e, shouldTrigger: true }))), 'negative activation case required');
  t.throws(() => core.parseExamples(draft.examples.map(e => ({ ...e, includes: [] }))), 'vacuous assertions refused');
  t.throws(() => core.parseExamples(draft.examples.map(e => ({ ...e, includes: ['forbidden text'], excludes: ['forbidden'] }))), 'contradictory assertions refused');
  t.throws(() => core.parseLearningEvaluation({ rows: [] }), 'invalid persisted evaluation refused');
  t.throws(() => core.parseLearningSource({ tools: [] }), 'invalid source refused');
  t.eq(core.scoreExample(draft.examples[0], { applySkill: true, output: draft.examples[0].input }, true).failures, [], 'preserved blocks pass');
  t.eq(core.scoreExample(draft.examples[0], { applySkill: true, output: 'REPLACED' }, true).failures.length, 3, 'missing blocks and forbidden text fail independently');
  t.eq(core.scoreExample(draft.examples[2], { applySkill: true, output: '4' }, true).failures.length, 1, 'correct answer with wrong trigger still fails');
  t.eq(core.scoreExample(draft.examples[0], { applySkill: false, output: draft.examples[0].input }, false).failures, [], 'no-skill baseline judged on behavior, not an impossible trigger');

  const requests = [];
  const provider = {
    async *stream(req) {
      requests.push(req);
      const task = JSON.parse(req.messages[1].content);
      const applySkill = !req.messages[0].content.endsWith('(none)') && task.request.startsWith('Organize');
      yield { type: 'final', text: JSON.stringify({ applySkill, output: task.input || '4' }), usage: { input: 80, output: 12 } };
    },
  };
  const progress = [];
  const evaluation = await model.evaluateLearning(provider, draft, null, 'endpoint', 'model', new AbortController().signal, (done, total) => progress.push([done, total]));
  t.eq(requests.length, 6, 'three cases run candidate and baseline separately');
  t.eq(progress.at(-1), [6, 6], 'bounded progress reports every call');
  t.ok(requests.every(req => req.tools.length === 0 && req.messages.length === 2), 'all evaluations have no tools and fresh context');
  t.ok(requests.every(req => !req.messages[1].content.includes('shouldTrigger') && !req.messages[1].content.includes('includes')), 'expected answers and trigger labels are not sent to the model');
  t.eq(evaluation.rows[0].candidate.inputTokens, 80, 'provider usage recorded');
  t.ok(core.canActivate(draft, evaluation, null), 'passing exact draft can activate');
  t.ok(!core.canActivate({ ...draft, body: draft.body + '\nNew behavior' }, evaluation, null), 'workflow changes invalidate verification');
  t.ok(!core.canActivate({ ...draft, examples: draft.examples.map(e => ({ ...e, input: e.input + ' changed' })) }, evaluation, null), 'fixture changes invalidate verification');
  t.ok(!core.canActivate(draft, evaluation, 'new-baseline'), 'baseline revision drift prevents activation');
  t.ok(!core.canActivate(draft, undefined, null), 'unverified draft cannot activate');

  const badProvider = { async *stream() { yield { type: 'tool_call', name: 'delete_note', args: {} }; } };
  await reject(() => model.evaluateLearning(badProvider, draft, null, 'e', 'm', new AbortController().signal, () => {}), 'tool requests never execute during validation');
  const cancelled = new AbortController(); cancelled.abort();
  const beforeCancel = requests.length;
  await reject(() => model.evaluateLearning(provider, draft, null, 'e', 'm', cancelled.signal, () => {}), 'cancelled validation stops');
  t.eq(requests.length, beforeCancel, 'aborted run spends no model calls');
  const failing = { async *stream() { yield { type: 'error', error: 'Network failed' }; } };
  await reject(() => model.proposeLearning(failing, 'Keep YAML', '', null, new AbortController().signal), 'provider error never becomes a passing result');
  const proposing = { async *stream() { yield { type: 'text', text: 'partial' }; yield { type: 'final', text: JSON.stringify(draft) }; } };
  t.eq(await model.proposeLearning(proposing, 'Keep YAML', '', null, new AbortController().signal), draft, 'canonical final payload replaces streamed partial text');
  await reject(() => model.proposeLearning(proposing, 'Keep YAML', '', { ...draft, name: 'another-skill' }, new AbortController().signal), 'update proposals cannot silently rename a selected skill');

  const a = adapter();
  let ledger = await store.readLearningLedger(a);
  t.eq(ledger.revision, 0, 'new vault starts with empty ledger');
  const v1 = { ...draft, id: 'v1', createdAt: 1, correction: 'Keep YAML', evaluation };
  ledger = await store.saveLearningVersion(a, 0, v1, false, null);
  t.eq((await store.loadLearnedSkills(a)).length, 0, 'saved draft is not injected into runtime');
  ledger = await store.saveLearningVersion(a, ledger.revision, v1, true, null);
  t.eq((await store.loadLearnedSkills(a))[0].learningVersion, 'v1', 'enabled revision reaches normal skill discovery');
  await reject(() => store.saveLearningVersion(a, ledger.revision, { ...v1, id: 'unsafe', evaluation: undefined }, true, 'v1'), 'store independently refuses activation without verification');
  await reject(() => store.saveLearningVersion(a, ledger.revision, { ...v1, body: v1.body + 'tampered' }, false, 'v1'), 'saved versions cannot be mutated');
  const staleRevision = ledger.revision;
  const both = await Promise.allSettled([
    store.setLearningActive(a, staleRevision, draft.name, null),
    store.setLearningActive(a, staleRevision, draft.name, null),
  ]);
  t.eq(both.filter(r => r.status === 'fulfilled').length, 1, 'only one simultaneous window mutation commits');
  t.eq((await store.loadLearnedSkills(a)).length, 0, 'disabled skill is absent from runtime');
  ledger = await store.readLearningLedger(a);
  ledger = await store.setLearningActive(a, ledger.revision, draft.name, 'v1');
  t.eq((await store.loadLearnedSkills(a))[0].body, draft.body, 'restore returns the exact saved workflow');
  const another = { ...v1, name: 'paper-links', id: 'link-v1', evaluation: { ...evaluation, signature: core.learningSignature({ ...draft, name: 'paper-links' }) } };
  ledger = await store.saveLearningVersion(a, ledger.revision, another, true, null);
  const discovery = await loadModule(path.resolve(__dirname, '../src/agent/skills.ts'));
  const app = { vault: { adapter: a, getAbstractFileByPath: () => null } };
  t.eq((await discovery.discoverSkills(app)).map(s => s.name), ['paper-links', 'paper-notes'], 'multiple learned skills sharing one ledger are all discoverable');
  t.eq((await discovery.discoverSkills({ vault: { adapter: adapter(), getAbstractFileByPath: () => null } })).length, 0, 'discovery cache never leaks learned skills across vaults');
  for (let i = 2; i <= 15; i++) ledger = await store.saveLearningVersion(a, ledger.revision, { ...v1, id: `v${i}`, createdAt: i, evaluation: undefined }, false, 'v1');
  t.eq(ledger.skills[0].versions.length, 12, 'version history is bounded');
  t.ok(ledger.skills[0].versions.some(v => v.id === 'v1'), 'history trimming preserves the active revision');
  await reject(() => store.setLearningActive(a, ledger.revision, draft.name, 'v15'), 'restore cannot activate an untested draft');
  const altered = adapter();
  const alteredLedger = JSON.parse(JSON.stringify(ledger));
  alteredLedger.skills[0].versions.find(v => v.id === 'v1').body += '\nUnverified edit';
  altered.files.set(store.LEARNING_PATH, JSON.stringify(alteredLedger));
  await reject(() => store.loadLearnedSkills(altered), 'manual drift in an enabled skill fails closed instead of loading unverified content');
  const corrupt = adapter(); corrupt.files.set(store.LEARNING_PATH, '{broken');
  await reject(() => store.saveLearningVersion(corrupt, 0, v1, false, null), 'corrupt history is never silently reset');
  t.eq(corrupt.files.get(store.LEARNING_PATH), '{broken', 'corrupt source kept for recovery');
  const orphan = adapter(); orphan.files.set(store.LEARNING_PATH + '.bak', JSON.stringify(ledger));
  await reject(() => store.readLearningLedger(orphan), 'interrupted ledger write cannot be mistaken for empty history');

  const message = { id: 'm', turnId: 't', role: 'assistant', content: 'The answer', timestamp: 1,
    modelSnapshot: { endpointId: 'original', model: 'model-before-switch' },
    toolEvents: [{ name: 'skill', status: 'success', skillVersion: 'v1', result: 'PRIVATE TOOL RESULT', args: { apiKey: 'PRIVATE KEY' } }] };
  const source = core.correctionContext({ id: 'chat', messages: [{ id: 'u', role: 'user', content: 'PRIVATE ATTACHMENT', displayContent: 'Organize this', timestamp: 0 }, message] }, message);
  t.ok(source.context.includes('Organize this') && !source.context.includes('PRIVATE'), 'learning context uses visible prompt and excludes tool/attachment payloads');
  t.eq(source.source.model, 'model-before-switch', 'feedback records the original model, not current selection');
  t.eq(source.source.tools[0], { name: 'skill', status: 'success', skillVersion: 'v1' }, 'feedback includes the actual skill revision without arguments');
  const legacy = core.correctionContext({ id: 'chat', messages: [{ role: 'user', content: 'PRIVATE LEGACY ATTACHMENT' }, message] }, message);
  t.ok(!legacy.context.includes('PRIVATE'), 'legacy prompts without a separate visible snapshot are not swept into feedback');
};
