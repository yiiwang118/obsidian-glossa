import { App, Component, MarkdownRenderer } from 'obsidian';

/**
 * Markdown rendering — Obsidian-native everywhere.
 * No marked dependency, no innerHTML of untrusted strings.
 *
 * - `renderInto`  : safe async render into a target element. Used for both streaming chunks
 *                   and final messages. Throttled at call site.
 * - `escapeHtml`  : kept for status / error text only.
 * - `decorateCodeBlocks`: post-render augmentation (copy / insert / apply buttons).
 */

export async function renderInto(
  app: App,
  src: string,
  target: HTMLElement,
  component: Component,
  sourcePath = ''
) {
  target.empty();
  await MarkdownRenderer.render(app, src || '', target, sourcePath, component);
  // Force MathJax to typeset any math expressions we just inserted.
  // Obsidian normally does this on its own preview, but custom views sometimes
  // miss the trigger. Belt-and-suspenders.
  try {
    const mj = (window as any).MathJax;
    if (mj?.typesetPromise) await mj.typesetPromise([target]);
  } catch { /* ignore */ }
}

/** During streaming, trim trailing incomplete math so we don't keep flickering
 *  half-rendered LaTeX. Keeps everything up to the last closed delimiter.
 *
 *  Implementation note: the trick is that `$$` and `$` inside fenced code blocks
 *  are literal — they must NOT count toward the delimiter parity. Earlier
 *  versions stripped code blocks to count, then used `buf.lastIndexOf('$$')`
 *  to find the cut point on the original string — that re-introduced the
 *  code-block `$$` as a "match" and cut math off mid-stream. Now we walk the
 *  original buffer, tracking code-block state, and only consider `$`/`$$`
 *  occurrences OUTSIDE code as both counters and trim anchors. */
export function trimIncompleteMath(buf: string): string {
  if (!buf) return buf;
  let dd = 0;     // count of $$ delimiters seen outside code
  let single = 0;     // count of standalone $ outside code (and outside $$)
  let lastDdIdx = -1;
  let lastSingleIdx = -1;
  let i = 0;
  const n = buf.length;
  let inFenced = false;
  let inInline = false;
  while (i < n) {
    if (!inFenced && !inInline && buf.startsWith('```', i)) {
      inFenced = true; i += 3; continue;
    }
    if (inFenced && buf.startsWith('```', i)) {
      inFenced = false; i += 3; continue;
    }
    if (!inFenced && !inInline && buf[i] === '`') { inInline = true; i++; continue; }
    if (inInline && buf[i] === '`') { inInline = false; i++; continue; }
    if (inFenced || inInline) { i++; continue; }
    if (buf.startsWith('$$', i)) {
      dd++; lastDdIdx = i; i += 2; continue;
    }
    if (buf[i] === '$' && buf[i + 1] !== '$' && buf[i - 1] !== '$' && buf[i - 1] !== '\\') {
      single++; lastSingleIdx = i; i++; continue;
    }
    i++;
  }
  if (dd % 2 === 1 && lastDdIdx >= 0) return buf.slice(0, lastDdIdx);
  if (single % 2 === 1 && lastSingleIdx >= 0) return buf.slice(0, lastSingleIdx);
  return buf;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string)
  );
}

/** Decorated <pre> elements — kept in a WeakSet so GC handles cleanup
 *  when the containing message bubble is removed from the DOM. Skipping
 *  these in the per-call loop avoids both the redundant innerHTML check
 *  AND the no-op DOM walk that ran every time the streaming finalizer
 *  re-decorated a fully-decorated container. */
const decoratedPres = new WeakSet<HTMLElement>();

export function decorateCodeBlocks(
  container: HTMLElement,
  handlers: { copy: (code: string) => void; apply?: (code: string) => void; insert?: (code: string) => void }
) {
  // Cheap early-out: skip the whole scan when the container has no <pre>.
  // Common case during streaming finalize on text-only messages.
  if (!container.querySelector('pre')) return;
  const pres = container.querySelectorAll('pre');
  for (let i = 0; i < pres.length; i++) {
    const pre = pres[i] as HTMLElement;
    if (decoratedPres.has(pre)) continue;
    // Belt + suspenders: also check the action-bar marker so older bubbles
    // re-rendered without the WeakSet entry don't double-decorate.
    if (pre.querySelector('.nc-code-actions')) { decoratedPres.add(pre); continue; }

    const codeEl = pre.querySelector('code');
    const code = codeEl?.textContent ?? '';

    const bar = document.createElement('div');
    bar.className = 'nc-code-actions';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = (e) => { e.stopPropagation(); handlers.copy(code); copyBtn.textContent = '✓'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); };
    bar.appendChild(copyBtn);

    if (handlers.insert) {
      const insertBtn = document.createElement('button');
      insertBtn.textContent = '↳ Insert';
      insertBtn.onclick = (e) => { e.stopPropagation(); handlers.insert!(code); };
      bar.appendChild(insertBtn);
    }
    if (handlers.apply) {
      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Apply';
      applyBtn.onclick = (e) => { e.stopPropagation(); handlers.apply!(code); };
      bar.appendChild(applyBtn);
    }
    pre.appendChild(bar);
    decoratedPres.add(pre);
  }
}
