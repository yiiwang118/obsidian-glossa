/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { App, Component, MarkdownRenderer } from 'obsidian';
import { ICON } from '../ui/icons';
import { setTrustedSvg } from './dom';

/**
 * Markdown rendering — Obsidian-native everywhere.
 * No marked dependency, no raw markup injection of untrusted strings.
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
  const original = src || '';
  const mightContainBlockedResources = hasBlockedResourceScheme(original);
  const sanitized = mightContainBlockedResources ? sanitizeMarkdownResourceUrls(original) : original;
  const raw = normalizeObsidianMathDelimiters(sanitized);
  target.empty();
  await MarkdownRenderer.render(app, raw, target, sourcePath, component);
  if (mightContainBlockedResources) scrubRenderedResourceUrls(target);
  // Only touch MathJax when the source actually contains math. For ordinary
  // prose/tool output this avoids waking Obsidian's MathJax font loader, which
  // can produce noisy "slow network / fallback font" intervention warnings.
  if (!hasMarkdownMath(raw)) return;
  try {
    const ownerWindow = target.ownerDocument.defaultView ?? window;
    const mj = (ownerWindow as AnyValue).MathJax ?? (window as AnyValue).MathJax;
    if (mj?.typesetPromise) await mj.typesetPromise([target]);
  } catch { /* ignore */ }
}

const BLOCKED_IMAGE_SCHEMES = /^(?:upload):\/\//i;
const BLOCKED_RESOURCE_SCHEME_IN_TEXT = /\b(?:upload):\/\//i;

/**
 * Some imported/web content contains editor-private image URLs such as
 * `upload://...`. Chromium cannot resolve those inside Obsidian and logs
 * ERR_UNKNOWN_URL_SCHEME for every rendered image. Replace them before the
 * Markdown renderer creates <img> elements; keep a small textual marker so the
 * user can still tell an omitted image existed.
 */
export function sanitizeMarkdownResourceUrls(src: string): string {
  if (!hasBlockedResourceScheme(src)) return src;
  let out = src.replace(/!\[([^\]]*)\]\(\s*(upload:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/gi, (_m, alt, url) => {
    return omittedImageText(alt || basenameFromUrl(url));
  });
  out = out.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])(upload:\/\/[^"']+)\1[^>]*>/gi, (_m, _q, url) => {
    return omittedImageText(basenameFromUrl(url));
  });
  out = out.replace(/<img\b[^>]*\bsrc\s*=\s*(upload:\/\/[^\s>]+)[^>]*>/gi, (_m, url) => {
    return omittedImageText(basenameFromUrl(url));
  });
  return out;
}

/** Obsidian's Markdown parser consumes `\(` / `\[` as backslash escapes
 * before MathJax sees them. Convert complete LaTeX delimiter pairs to the
 * native `$` / `$$` form while preserving fenced and inline code verbatim. */
export function normalizeObsidianMathDelimiters(src: string): string {
  if (!src || (!src.includes('\\(') && !src.includes('\\['))) return src;
  const segments: string[] = [];
  let markerPrefix = '\uE000GLOSSA_CODE_';
  while (src.includes(markerPrefix)) markerPrefix += '_';
  const markerSuffix = '\uE001';
  const stash = (value: string): string => {
    const marker = `${markerPrefix}${segments.length}${markerSuffix}`;
    segments.push(value);
    return marker;
  };
  let protectedText = protectFencedCode(src, stash);
  protectedText = protectHtmlCode(protectedText, stash);
  protectedText = protectInlineCode(protectedText, stash);
  const normalized = normalizeMathPairs(protectedText);
  const markerPattern = new RegExp(`${escapeRegExp(markerPrefix)}(\\d+)${markerSuffix}`, 'g');
  return normalized.replace(markerPattern, (marker, indexText: string) => {
    return segments[Number(indexText)] ?? marker;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function protectFencedCode(src: string, stash: (value: string) => string): string {
  let output = '';
  let plainStart = 0;
  let cursor = 0;
  while (cursor < src.length) {
    const lineEnd = nextLineEnd(src, cursor);
    const line = src.slice(cursor, lineEnd);
    const opener = /^[ \t]*(`{3,}|~{3,})/.exec(stripMarkdownContainerPrefix(line));
    if (!opener) {
      cursor = lineEnd;
      continue;
    }
    const fenceChar = opener[1][0];
    const fenceLength = opener[1].length;
    let blockEnd = lineEnd;
    let scan = lineEnd;
    while (scan < src.length) {
      const candidateEnd = nextLineEnd(src, scan);
      const candidate = src.slice(scan, candidateEnd);
      const closer = /^[ \t]*(`+|~+)[ \t]*(?:\r?\n)?$/.exec(stripMarkdownContainerPrefix(candidate));
      blockEnd = candidateEnd;
      if (closer && closer[1][0] === fenceChar && closer[1].length >= fenceLength) break;
      scan = candidateEnd;
    }
    output += src.slice(plainStart, cursor) + stash(src.slice(cursor, blockEnd));
    cursor = blockEnd;
    plainStart = cursor;
  }
  return output + src.slice(plainStart);
}

function stripMarkdownContainerPrefix(line: string): string {
  let value = line;
  while (true) {
    const match = /^[ \t]{0,3}(?:>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+)/.exec(value);
    if (!match) return value;
    value = value.slice(match[0].length);
  }
}

function protectHtmlCode(src: string, stash: (value: string) => string): string {
  return src.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, match => stash(match));
}

function protectInlineCode(src: string, stash: (value: string) => string): string {
  let output = '';
  let plainStart = 0;
  let cursor = 0;
  while (cursor < src.length) {
    if (src[cursor] !== '`') {
      cursor++;
      continue;
    }
    const runLength = countRun(src, cursor, '`');
    let search = cursor + runLength;
    let closeEnd = -1;
    while (search < src.length) {
      const next = src.indexOf('`', search);
      if (next < 0) break;
      const closingLength = countRun(src, next, '`');
      if (closingLength === runLength) {
        closeEnd = next + closingLength;
        break;
      }
      search = next + closingLength;
    }
    if (closeEnd < 0) {
      cursor += runLength;
      continue;
    }
    output += src.slice(plainStart, cursor) + stash(src.slice(cursor, closeEnd));
    cursor = closeEnd;
    plainStart = cursor;
  }
  return output + src.slice(plainStart);
}

function normalizeMathPairs(src: string): string {
  let output = '';
  let cursor = 0;
  while (cursor < src.length) {
    const display = src.startsWith('\\[', cursor) && !isEscapedAt(src, cursor);
    const inline = !display && src.startsWith('\\(', cursor) && !isEscapedAt(src, cursor);
    if (!display && !inline) {
      output += src[cursor];
      cursor++;
      continue;
    }
    const closeToken = display ? '\\]' : '\\)';
    const close = findUnescapedToken(src, closeToken, cursor + 2);
    if (close < 0) {
      output += src[cursor];
      cursor++;
      continue;
    }
    const delimiter = display ? '$$' : '$';
    output += delimiter + src.slice(cursor + 2, close) + delimiter;
    cursor = close + 2;
  }
  return output;
}

function findUnescapedToken(src: string, token: string, start: number): number {
  let cursor = start;
  while (cursor < src.length) {
    const found = src.indexOf(token, cursor);
    if (found < 0) return -1;
    if (!isEscapedAt(src, found)) return found;
    cursor = found + token.length;
  }
  return -1;
}

function isEscapedAt(src: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && src[cursor] === '\\'; cursor--) slashes++;
  return slashes % 2 === 1;
}

function countRun(src: string, start: number, char: string): number {
  let cursor = start;
  while (cursor < src.length && src[cursor] === char) cursor++;
  return cursor - start;
}

function nextLineEnd(src: string, start: number): number {
  const newline = src.indexOf('\n', start);
  return newline < 0 ? src.length : newline + 1;
}

function hasBlockedResourceScheme(src: string): boolean {
  return !!src && BLOCKED_RESOURCE_SCHEME_IN_TEXT.test(src);
}

function scrubRenderedResourceUrls(target: HTMLElement) {
  const imgs = target.querySelectorAll('img');
  for (const img of Array.from(imgs)) {
    const src = img.getAttribute('src') || '';
    if (!BLOCKED_IMAGE_SCHEMES.test(src)) continue;
    const replacement = target.ownerDocument.win.createSpan();
    replacement.className = 'nc-omitted-image';
    replacement.textContent = omittedImageText(img.getAttribute('alt') || basenameFromUrl(src));
    img.replaceWith(replacement);
  }
}

function omittedImageText(label: string): string {
  const clean = (label || 'image').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `[image omitted: ${clean || 'unsupported source'}]`;
}

function basenameFromUrl(url: string): string {
  const clean = (url || '').split(/[?#]/)[0] || '';
  const last = clean.split('/').pop() || clean;
  return last || 'unsupported source';
}

export function hasMarkdownMath(src: string): boolean {
  if (!src) return false;
  let inFenced = false;
  let inInline = false;
  let pendingDollar = -1;

  for (let i = 0; i < src.length; i++) {
    if (!inInline && src.startsWith('```', i)) {
      inFenced = !inFenced;
      i += 2;
      continue;
    }
    if (inFenced) continue;

    const ch = src[i];
    if (ch === '`') {
      inInline = !inInline;
      continue;
    }
    if (inInline) continue;

    if (ch === '\\' && (src[i + 1] === '(' || src[i + 1] === '[')) return true;
    if (ch === '$') {
      if (src[i - 1] === '\\') continue;
      if (src[i + 1] === '$') return true;
      const prev = src[i - 1] ?? '';
      const next = src[i + 1] ?? '';
      if (!next || /\s/.test(next) || /[\d,.;:!?)]/.test(next)) continue;
      if (pendingDollar >= 0) {
        const before = src[i - 1] ?? '';
        if (before && !/\s/.test(before)) return true;
      } else if (!prev || !/[A-Za-z0-9]/.test(prev)) {
        pendingDollar = i;
      }
    }
  }
  return false;
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
  const slashMath: { kind: '(' | '['; index: number }[] = [];
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
    if (buf[i] === '\\' && !isEscapedAt(buf, i)) {
      const next = buf[i + 1];
      if (next === '(' || next === '[') {
        slashMath.push({ kind: next, index: i });
        i += 2;
        continue;
      }
      if (next === ')' || next === ']') {
        const expected = next === ')' ? '(' : '[';
        if (slashMath[slashMath.length - 1]?.kind === expected) slashMath.pop();
        i += 2;
        continue;
      }
    }
    if (buf.startsWith('$$', i)) {
      dd++; lastDdIdx = i; i += 2; continue;
    }
    if (buf[i] === '$' && buf[i + 1] !== '$' && buf[i - 1] !== '$' && buf[i - 1] !== '\\') {
      single++; lastSingleIdx = i; i++; continue;
    }
    i++;
  }
  const incomplete = [
    dd % 2 === 1 ? lastDdIdx : -1,
    single % 2 === 1 ? lastSingleIdx : -1,
    slashMath[0]?.index ?? -1,
  ].filter(index => index >= 0);
  if (incomplete.length) return buf.slice(0, Math.min(...incomplete));
  return buf;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

/** Decorated <pre> elements — kept in a WeakSet so GC handles cleanup
 *  when the containing message bubble is removed from the DOM. Skipping
 *  these in the per-call loop avoids both the redundant markup check
 *  AND the no-op DOM walk that ran every time the streaming finalizer
 *  re-decorated a fully-decorated container. */
const decoratedPres = new WeakSet<HTMLElement>();

export function decorateCodeBlocks(
  container: HTMLElement,
  handlers: { copy: (code: string) => void; apply?: (code: string) => void; insert?: (code: string) => void }
) {
  // Cheap early-out: skip the whole scan when the container has no <pre>.
  // Common case during streaming finalize on text-only messages.
  const pres = container.querySelectorAll('pre');
  if (pres.length === 0) return;
  for (let i = 0; i < pres.length; i++) {
    const pre = pres[i] as HTMLElement;
    if (decoratedPres.has(pre)) continue;
    // Belt + suspenders: also check the action-bar marker so older bubbles
    // re-rendered without the WeakSet entry don't double-decorate.
    if (pre.querySelector('.nc-code-actions')) { decoratedPres.add(pre); continue; }
    // Obsidian's MarkdownRenderer can inject its own large copy-code button as
    // a direct child of <pre>. Glossa provides a compact toolbar below, so
    // remove the host button to avoid duplicate controls that themes may size
    // as full buttons.
    for (const child of Array.from(pre.children)) {
      if (child.localName === 'button') child.remove();
    }

    const codeEl = pre.querySelector('code');
    const code = codeEl?.textContent ?? '';
    pre.classList.add('nc-has-code-actions');

    const bar = activeWindow.createDiv();
    bar.className = 'nc-code-actions';

    const makeButton = (icon: string, label: string, onClick: (button: HTMLButtonElement) => void) => {
      const button = activeWindow.createEl('button');
      button.type = 'button';
      button.className = 'nc-code-action';
      button.title = label;
      button.setAttribute('aria-label', label);
      setTrustedSvg(button, icon);
      button.onclick = (e) => {
        e.stopPropagation();
        onClick(button);
      };
      return button;
    };

    const copyBtn = makeButton(ICON.copy, 'Copy code', (button) => {
      handlers.copy(code);
      setTrustedSvg(button, ICON.checkThick);
      window.setTimeout(() => setTrustedSvg(button, ICON.copy), 1200);
    });
    bar.appendChild(copyBtn);

    if (handlers.insert) {
      bar.appendChild(makeButton(ICON.insert, 'Insert at cursor', () => handlers.insert(code)));
    }
    if (handlers.apply) {
      bar.appendChild(makeButton(ICON.apply, 'Apply to selection', () => handlers.apply(code)));
    }
    pre.appendChild(bar);
    decoratedPres.add(pre);
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
