export interface ChatPassage {
  id: string;
  text: string;
  /** The selection covers the whole message, so its source text can be used verbatim. */
  whole: boolean;
}

/** Read selection from the transcript's own document, including Obsidian popouts. */
export function selectedChatPassages(root: HTMLElement, bodies: Array<{ id: string; body: HTMLElement }>): ChatPassage[] {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return [];
  const selected = selection.getRangeAt(0);
  if (!root.contains(selected.startContainer) || !root.contains(selected.endContainer)) return [];
  const passages: ChatPassage[] = [];
  for (const { id, body } of bodies) {
    if (!body.isConnected || !selected.intersectsNode(body)) continue;
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(body);
    const all = range.toString();
    // DOM Range START_TO_START = 0, END_TO_END = 2. No ambient-window constructors.
    if (selected.compareBoundaryPoints(0, range) > 0) range.setStart(selected.startContainer, selected.startOffset);
    if (selected.compareBoundaryPoints(2, range) < 0) range.setEnd(selected.endContainer, selected.endOffset);
    const text = rangeText(body, range);
    if (text) passages.push({ id, text, whole: squash(range.toString()) === squash(all) });
  }
  return passages;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const SKIPPED = new Set(['button', 'svg', 'style', 'script', 'template', 'input', 'select', 'textarea', 'mjx-assistive-mml']);
const BLOCKS = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'header', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tr', 'ul']);

/** Text with line breaks between blocks; spaces inside a line collapse as on screen. */
class Lines {
  private out = '';
  private gap = 0;
  text(value: string, preformatted = false) {
    let text = preformatted ? value : value.replace(/[ \t\r\n\f]+/g, ' ');
    // Whitespace between blocks is layout, not content.
    if (!preformatted && (!this.out || this.gap || this.out.endsWith('\n'))) text = text.replace(/^ +/, '');
    if (!text) return;
    if (this.gap && this.out) this.out = this.out.replace(/[ \t]+$/, '') + '\n'.repeat(this.gap);
    this.gap = 0;
    this.out += text;
  }
  block(lines: number) { this.gap = Math.max(this.gap, lines); }
  toString(preformatted = false) { return preformatted ? this.out : this.out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim(); }
}

/** The selected part of a rendered message, written back as Markdown-like text.
 *  MathJax 4 keeps each formula's TeX in `data-latex`; a formula touched by the
 *  selection is quoted whole, since its glyphs alone lose fractions and scripts. */
export function rangeText(root: Node, range: Range): string {
  const lines = new Lines();
  const visit = (node: Node, out: Lines, preformatted: boolean) => {
    if (!range.intersectsNode(node)) return;
    if (node.nodeType === 3) {
      const data = (node as Text).data;
      out.text(data.slice(node === range.startContainer ? range.startOffset : 0, node === range.endContainer ? range.endOffset : data.length), preformatted);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName;
    if (SKIPPED.has(tag) || el.classList.contains('nc-code-actions') || el.classList.contains('copy-code-button')) return;
    const children = (target: Lines, pre = preformatted) => { for (const child of Array.from(el.childNodes)) visit(child, target, pre); };
    const nested = (pre = preformatted) => { const inner = new Lines(); children(inner, pre); return inner.toString(pre); };
    if (el.classList.contains('math') || tag === 'mjx-container') {
      const tex = (el.getAttribute('data-latex') ?? el.querySelector('[data-latex]')?.getAttribute('data-latex') ?? '').trim();
      const display = el.classList.contains('math-block') || el.getAttribute('display') === 'true' || !!el.querySelector('mjx-container[display="true"]');
      if (!tex) { children(out); return; }
      if (display) { out.block(1); out.text(`$$${tex}$$`, true); out.block(1); } else out.text(`$${tex}$`, true);
      return;
    }
    if (tag === 'br') { out.text('\n', true); return; }
    if (tag === 'img') { out.text(`[${el.getAttribute('alt') || 'image'}]`); return; }
    if (tag === 'hr') { out.block(2); out.text('---', true); out.block(2); return; }
    if (tag === 'pre') {
      const language = /(?:^|\s)language-([\w+#.-]+)/.exec(el.querySelector('code')?.className ?? '')?.[1] ?? '';
      const code = nested(true).replace(/\n+$/, '');
      if (!code) return;
      out.block(2); out.text(`\`\`\`${language}\n${code}\n\`\`\``, true); out.block(2);
      return;
    }
    if (tag === 'code' && !preformatted) { const code = nested(true); if (code) out.text(`\`${code}\``, true); return; }
    if (tag === 'li') {
      const list = el.parentElement;
      const index = list?.localName === 'ol' ? Array.from(list.children).filter(item => item.localName === 'li').indexOf(el) : -1;
      const task = el.classList.contains('task-list-item') ? `[${(el.getAttribute('data-task') ?? ' ').trim() ? 'x' : ' '}] ` : '';
      const marker = (index >= 0 ? `${Number(list?.getAttribute('start') ?? 1) + index}. ` : '- ') + task;
      const text = nested();
      if (!text) return;
      out.block(1); out.text(text.split('\n').map((line, i) => (i ? ' '.repeat(marker.length) : marker) + line).join('\n'), true); out.block(1);
      return;
    }
    if (tag === 'blockquote') {
      const text = nested();
      if (text) { out.block(2); out.text(text.split('\n').map(line => `> ${line}`).join('\n'), true); out.block(2); }
      return;
    }
    if (tag === 'tr') {
      const cells = Array.from(el.children).filter(cell => range.intersectsNode(cell)).map(cell => {
        const inner = new Lines();
        for (const child of Array.from(cell.childNodes)) visit(child, inner, false);
        return inner.toString().replace(/\n+/g, ' ').replace(/\|/g, '\\|');
      });
      if (!cells.length) return;
      const header = el.parentElement?.localName === 'thead' ? `\n| ${cells.map(() => '---').join(' | ')} |` : '';
      out.block(1); out.text(`| ${cells.join(' | ')} |${header}`, true); out.block(1);
      return;
    }
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      const text = nested().replace(/\n+/g, ' ');
      if (text) { out.block(2); out.text(`${'#'.repeat(Number(heading[1]))} ${text}`, true); out.block(2); }
      return;
    }
    const nestedList = (tag === 'ul' || tag === 'ol') && el.parentElement?.localName === 'li';
    const gap = !nestedList && (tag === 'p' || tag === 'ul' || tag === 'ol' || tag === 'table') ? 2 : BLOCKS.has(tag) ? 1 : 0;
    if (gap) out.block(gap);
    children(out);
    if (gap) out.block(gap);
  };
  for (const child of Array.from(root.childNodes)) visit(child, lines, false);
  return lines.toString();
}
