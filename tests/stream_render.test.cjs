const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Only the DOM operations used by the stream renderer; no browser or live vault.
class Element {
  constructor(text = '') { this.text = text; this.children = []; this.parent = null; }
  get isConnected() { return this.root || !!this.parent?.isConnected; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(text) { this.empty(); this.text = text; }
  empty() {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = '';
  }
  appendChild(child) { child.parent = this; this.children.push(child); }
  insertBefore(child, before) {
    const index = this.children.indexOf(before);
    if (index < 0) throw new Error('Missing reference node');
    child.parent = this;
    this.children.splice(index, 0, child);
  }
}

const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

exports.run = async (t, loadModule) => {
  const markdown = await loadModule(path.resolve(__dirname, '../src/utils/markdown.ts'));
  const source = fs.readFileSync(path.resolve(__dirname, '../src/ui/view.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const timers = new Map();
  let now = 0, nextId = 0;
  const clock = {
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const advance = async ms => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
      await drain();
    }
    now = end;
    await drain();
  };
  const slowChunk = deferred(), slowFinal = deferred(), finalStarted = deferred();
  const body = new Element(); body.root = true;
  const renders = [];
  let first = true;
  const renderInto = async (_app, text, target) => {
    renders.push({ text, target });
    target.empty();
    target.appendChild(new Element(text));
    if (first) { first = false; await slowChunk.promise; }
    else if (target === body) { finalStarted.resolve(); await slowFinal.promise; }
  };
  const modules = {
    obsidian: { ItemView: class {} },
    '../utils/markdown': { ...markdown, renderInto, decorateCodeBlocks() {} },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: name => modules[name] ?? {}, window: clock,
    activeWindow: { createDiv: () => new Element() }, console,
  });
  const view = Object.create(exports.GlossaView.prototype);
  const message = { id: 'answer', role: 'assistant', content: '' };
  const ui = { msg: message, body };
  const session = { id: 'chat' };
  const run = { session, ui, asst: message, buf: 'Table\n\nExplanation $n=2.25$' };
  Object.assign(view, {
    session, hub: { runs: new Map([[session.id, run]]) }, viewClosed: false,
    streamRenderInFlight: false, streamRenderTimer: null,
    app: { workspace: { getActiveFile: () => null } },
    scrollToBottom() {}, codeBlockHandlers: () => ({}), applyPreambleStyle() {},
  });

  // The last tokens arrive while an earlier paragraph is still rendering.
  const streaming = view.doStreamingRender();
  run.buf += '.';
  message.content = run.buf;
  const finalizing = view.finalizeAsstRender(ui, message);
  slowChunk.resolve();
  await streaming;
  await advance(20);
  await finalStarted.promise;
  // A slow final MathJax render outlasts the stream renderer's 150 ms retry.
  await advance(200);
  slowFinal.resolve();
  await finalizing;
  t.eq(body.textContent, message.content, 'completion renders the final paragraph exactly once');
  t.eq(message.content, 'Table\n\nExplanation $n=2.25$.', 'rendering never changes saved message text');

  // The run remains in the hub until persistence/cleanup completes.
  const countAfterFinal = renders.length;
  view.scheduleStreamingRender();
  await advance(200);
  t.eq(renders.length, countAfterFinal, 'completed segment rejects late stream scheduling');
  t.eq(body.textContent, message.content, 'late ticks cannot append a second tail');

  // A following tool/assistant segment can still stream normally.
  const nextBody = new Element(); nextBody.root = true;
  run.ui = { msg: { id: 'next' }, body: nextBody };
  run.buf = 'Next segment';
  view.scheduleStreamingRender();
  await advance(200);
  t.eq(nextBody.textContent, 'Next segment', 'finishing one segment does not stop the next segment');
};
