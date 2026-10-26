const path = require('path');

/* A small in-memory DOM: just what selection reading uses. Boundary points
 * compare like real DOM ranges: the gap between two nodes sorts after the end of
 * the first and before the start of the second. */
function buildDom() {
  const text = data => ({ nodeType: 3, data, childNodes: [] });
  return (tag, attrs, ...kids) => {
    const node = {
      nodeType: 1, localName: tag, attrs: attrs || {}, childNodes: [], parentElement: null, isConnected: true,
      classList: { contains: c => String((attrs || {}).class || '').split(/\s+/).includes(c) },
      getAttribute: k => (attrs || {})[k] ?? null,
      get children() { return this.childNodes.filter(n => n.nodeType === 1); },
      get className() { return (attrs || {}).class || ''; },
      querySelector(selector) {
        const [, tagName, attr, value] = /^([\w-]*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(selector);
        const match = n => n.nodeType === 1 && (!tagName || n.localName === tagName) && (!attr || (value === undefined ? n.getAttribute(attr) !== null : n.getAttribute(attr) === value));
        const walk = n => { for (const c of n.childNodes) { if (match(c)) return c; const f = walk(c); if (f) return f; } return null; };
        return walk(this);
      },
    };
    for (const kid of kids) {
      const child = typeof kid === 'string' ? text(kid) : kid;
      child.parentNode = node; if (child.nodeType === 1) child.parentElement = node;
      node.childNodes.push(child);
    }
    return node;
  };
}
const textsOf = node => node.nodeType === 3 ? [node] : node.childNodes.flatMap(textsOf);

function rangeOver(root) {
  const texts = textsOf(root), base = new Map(), index = new Map();
  let offset = 0;
  texts.forEach((node, i) => { base.set(node, offset); index.set(node, i); offset += node.data.length; });
  const point = (node, o) => [base.get(node) + o, 2 * index.get(node) + 1];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  return (startNode, startOffset, endNode, endOffset) => {
    const start = point(startNode, startOffset), end = point(endNode, endOffset);
    return {
      startContainer: startNode, startOffset, endContainer: endNode, endOffset,
      intersectsNode(node) {
        const inner = textsOf(node);
        if (!inner.length) return false;
        const first = inner[0], last = inner[inner.length - 1];
        return less([base.get(first), 2 * index.get(first)], end) && less(start, [base.get(last) + last.data.length, 2 * index.get(last) + 2]);
      },
      compareBoundaryPoints(how, other) {
        const a = how === 0 ? start : end, b = how === 0 ? point(other.startContainer, other.startOffset) : point(other.endContainer, other.endOffset);
        return less(a, b) ? -1 : less(b, a) ? 1 : 0;
      },
      toString() { return texts.map(n => { const b = base.get(n); return n.data.slice(Math.max(0, start[0] - b), Math.max(0, end[0] - b)); }).join(''); },
    };
  };
}

exports.run = async (t, load) => {
  const { selectedChatPassages, rangeText } = await load(path.resolve(__dirname, '../src/ui/chat_excerpt_selection.ts'));

  // Shape of an Obsidian-rendered answer: MathJax 4 keeps TeX in data-latex.
  const h = buildDom();
  const indentedCode = h('div', {}, h('p', {}, 'Intro'), h('pre', {}, h('code', { class: 'language-python' }, '    first()\n    second()\n')));
  const codeText = textsOf(indentedCode)[1];
  t.eq(rangeText(indentedCode, rangeOver(indentedCode)(codeText, 0, codeText, codeText.data.length)), '```python\n    first()\n    second()\n```', 'selected code retains indentation on its first line');
  const body = h('div', { class: 'nc-msg-body' },
    h('p', {}, 'The loss is ', h('span', { class: 'math math-inline is-loaded' }, h('mjx-container', { class: 'MathJax', jax: 'CHTML' }, h('mjx-math', { 'data-latex': '\\mathcal{L}=-\\log p_\\theta(x)' }, 'L=−log𝑝𝜃(𝑥)'))), ' per token.'),
    '\n',
    h('p', {}, 'Second ', h('strong', {}, 'bold'), ' paragraph.'),
    h('div', { class: 'math math-block is-loaded' }, h('mjx-container', { display: 'true' }, h('mjx-math', { 'data-latex': '\\frac{a}{b}' }, '𝑎𝑏'))),
    h('ol', { start: '3' }, h('li', {}, 'three'), h('li', {}, 'four ', h('code', {}, 'x_1'))),
    h('ul', {}, h('li', { class: 'task-list-item', 'data-task': 'x' }, 'done', h('ul', {}, h('li', {}, 'nested')))),
    h('pre', {}, h('code', { class: 'language-python' }, 'print(1)\nprint(2)\n'), h('div', { class: 'nc-code-actions' }, h('button', {}, 'Copy'))),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'a'), h('th', {}, 'b'))), h('tbody', {}, h('tr', {}, h('td', {}, '1'), h('td', {}, 'x|y')))),
    h('blockquote', {}, h('p', {}, 'quoted')),
  );
  const textNodes = textsOf(body), range = rangeOver(body);
  const first = textNodes[0], last = textNodes[textNodes.length - 1];
  const all = rangeText(body, range(first, 0, last, last.data.length));
  t.eq(all, [
    'The loss is $\\mathcal{L}=-\\log p_\\theta(x)$ per token.',
    '',
    'Second bold paragraph.',
    '',
    '$$\\frac{a}{b}$$',
    '',
    '3. three',
    '4. four `x_1`',
    '',
    '- [x] done',
    '      - nested',
    '',
    '```python',
    'print(1)',
    'print(2)',
    '```',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | x\\|y |',
    '',
    '> quoted',
  ].join('\n'), 'rendered blocks come back as Markdown, formulas as their TeX and code without toolbar labels');
  const glyph = textNodes.find(n => n.data === 'L=−log𝑝𝜃(𝑥)');
  t.eq(rangeText(body, range(first, 4, glyph, 3)), 'loss is $\\mathcal{L}=-\\log p_\\theta(x)$', 'a formula touched by the selection is quoted whole, never as glyphs');
  const four = textNodes.find(n => n.data === 'four ');
  t.eq(rangeText(body, range(four, 0, four, 4)), '4. four', 'a partly selected list keeps its real numbering');
  const legacy = h('p', {}, 'v3 ', h('span', { class: 'math math-inline' }, h('mjx-container', {}, h('mjx-assistive-mml', {}, 'HIDDEN'), 'x')));
  const legacyTexts = textsOf(legacy);
  t.eq(rangeText(legacy, rangeOver(legacy)(legacyTexts[0], 0, legacyTexts[2], 1)), 'v3 x', 'without TeX the visible glyphs remain and hidden MathML stays out');

  // Selection plumbing: per-message clipping and whole-message detection.
  const d = buildDom();
  const u1 = d('div', {}, 'First question'), a1 = d('div', {}, 'First answer'), u2 = d('div', {}, 'Second question');
  const root = d('div', {}, u1, a1, u2);
  const make = rangeOver(root);
  const [tq, ta] = textsOf(root);
  let selection;
  root.ownerDocument = {
    getSelection: () => selection,
    createRange: () => {
      let s = [tq, 0], e = [tq, 0];
      const r = {
        selectNodeContents(node) { const [f] = textsOf(node); s = [f, 0]; e = [f, f.data.length]; Object.assign(r, make(...s, ...e)); },
        setStart(node, offset) { s = [node, offset]; Object.assign(r, make(...s, ...e)); },
        setEnd(node, offset) { e = [node, offset]; Object.assign(r, make(...s, ...e)); },
      };
      return r;
    },
  };
  root.contains = node => textsOf(root).includes(node);
  const select = (...points) => { const r = make(...points); selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => r }; };
  const bodies = [{ id: 'u1', body: u1 }, { id: 'a1', body: a1 }, { id: 'u2', body: u2 }];
  select(ta, 3, ta, 8);
  t.eq(selectedChatPassages(root, bodies), [{ id: 'a1', text: 'st an', whole: false }], 'extracts the selected substring, not the full answer');
  select(tq, 6, ta, 5);
  t.eq(selectedChatPassages(root, bodies), [{ id: 'u1', text: 'question', whole: false }, { id: 'a1', text: 'First', whole: false }], 'a cross-message selection gives separate clipped quotes');
  select(ta, 0, ta, ta.data.length);
  t.eq(selectedChatPassages(root, bodies)[0].whole, true, 'selecting a whole message is detected, so its source can be quoted');
  selection.isCollapsed = true;
  t.eq(selectedChatPassages(root, bodies), [], 'empty selection ignored');
  select(tq, 0, ta, 3);
  root.contains = node => node === ta;
  t.eq(selectedChatPassages(root, bodies), [], 'a selection crossing in from a note never imports unrelated content');
  root.contains = node => textsOf(root).includes(node);
  a1.isConnected = false;
  select(ta, 0, ta, 4);
  t.eq(selectedChatPassages(root, bodies), [], 'detached previous chat bodies cannot be selected');
};
