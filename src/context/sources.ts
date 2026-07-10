/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { App, TFile, TFolder, MarkdownView, FileView } from 'obsidian';
import { estimateTokens } from '../utils/tokens';
import { uid } from '../utils/dom';
import { fetchWithSafeRedirects, parseHttpUrl } from '../utils/safe_web';
import { extractPdfTextFromArrayBuffer, formatPdfDiagnosticMarkdown, type PdfReadTask } from '../utils/pdf';
import { bytesToBase64 } from '../utils/image';
import { extractVaultPdfCached, vaultImageDataUriCached } from '../utils/media_cache';
import { inferSelectionLanguage } from '../utils/translation_target';
import type { ContextItem } from '../types';

/* ============================================================
   Selection extraction — works on markdown, PDF, HTML, custom views
   ============================================================ */

export interface SelectionInfo {
  text: string;
  source: 'markdown' | 'pdf' | 'html' | 'glossa' | 'unknown';
  file?: TFile;
}

const FILE_CONTENT_SELECTOR = [
  '.markdown-source-view',
  '.markdown-preview-view',
  '.cm-editor',
  '.cm-content',
  '.pdf-viewer',
  '.pdf-container',
  '.pdfViewer',
  '.textLayer',
  '.canvas-wrapper',
  '.canvas-node-content',
  '.view-content',
].join(',');

const GLOSSA_OUTPUT_SELECTOR = [
  '.glossa-view .nc-msg-body',
  '.glossa-view .nc-thinking-body',
  '.glossa-view .nc-tool-event-body',
  '.glossa-view .nc-selection-echo-body',
].join(',');

function nodeToElement(node: Node | null): HTMLElement | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE
    ? node as HTMLElement
    : node.parentElement;
}

function selectionElement(sel: Selection): HTMLElement | null {
  const node = sel.rangeCount > 0 ? sel.getRangeAt(0).commonAncestorContainer : sel.anchorNode;
  return nodeToElement(node);
}

function sourceForFileView(viewType: string | undefined, file?: TFile | null): SelectionInfo['source'] {
  const ext = file?.extension?.toLowerCase();
  if (viewType === 'pdf' || ext === 'pdf') return 'pdf';
  if (viewType === 'markdown' || ext === 'md') return 'markdown';
  if (viewType === 'html' || ext === 'html' || ext === 'htm') return 'html';
  return 'unknown';
}

function selectionFileContext(app: App, el: HTMLElement): Pick<SelectionInfo, 'source' | 'file'> | null {
  const contentEl = el.closest(FILE_CONTENT_SELECTOR);
  if (!contentEl) return null;

  const leaves = [app.workspace.getMostRecentLeaf()];
  app.workspace.iterateAllLeaves(leaf => {
    if (leaf !== leaves[0]) leaves.push(leaf);
  });

  for (const leaf of leaves) {
    const view = leaf?.view;
    const container = (view as AnyValue)?.containerEl as HTMLElement | undefined;
    if (!view || !container || !container.contains(el) || !container.contains(contentEl)) continue;

    const file = view instanceof FileView ? view.file : (view as AnyValue).file;
    if (!file) continue;
    return { source: sourceForFileView(view.getViewType?.(), file), file };
  }

  return null;
}

function selectionGlossaContext(el: HTMLElement): Pick<SelectionInfo, 'source' | 'file'> | null {
  const outputEl = el.closest(GLOSSA_OUTPUT_SELECTOR);
  return outputEl ? { source: 'glossa' } : null;
}

export function getCurrentSelection(app: App): SelectionInfo | null {
  const af = app.workspace.getActiveFile();

  // 1) DOM selection — only accept real file content or Glossa's own message output.
  // If there is an explicit DOM selection outside those surfaces, ignore it
  // instead of falling through to a stale editor selection.
  const winSel = activeDocument.getSelection?.() ?? window.getSelection();
  const rawDomText = winSel?.toString() ?? '';
  const domText = rawDomText.trim();
  if (winSel && domText) {
    const el = selectionElement(winSel);
    if (!el) return null;

    const glossa = selectionGlossaContext(el);
    if (glossa) return { text: rawDomText, source: glossa.source };

    const fileCtx = selectionFileContext(app, el);
    if (fileCtx) return { text: rawDomText, source: fileCtx.source, file: fileCtx.file };

    return null;
  }

  // 2) Markdown editor fallback — most accurate when CodeMirror owns the
  // selection but the browser selection is not visible to activeDocument.
  const mdView = app.workspace.getActiveViewOfType(MarkdownView);
  if (mdView?.editor) {
    const sel = mdView.editor.getSelection();
    if (sel && sel.trim()) return { text: sel, source: 'markdown', file: af ?? undefined };
  }
  return null;
}

/* ============================================================
   Resolve a single ContextItem into text content
   ============================================================ */

/** Image extensions Obsidian normally embeds. Used by resolveFile() to
 *  route image files into the base64-image attach flow (so multimodal
 *  providers see them) instead of trying cachedRead which would
 *  produce binary garbage. */
const IMAGE_EXT = /^(png|jpg|jpeg|gif|webp)$/i;
/** Common MIME guesses for image extensions, so the data URI sets a
 *  reasonable Content-Type even when Obsidian doesn't supply one. */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp',
};
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PDF_CONTEXT_MAX_PAGES = 80;
const PDF_CONTEXT_MAX_CHARS = 100_000;

export async function resolveFile(
  app: App,
  file: TFile,
  options: { pdfTask?: PdfReadTask; pdfQuery?: string } = {},
): Promise<ContextItem> {
  const ext = (file.extension || '').toLowerCase();

  // Images → attach as inline base64 image so multimodal providers receive
  // the pixels. Without this branch users could @ a PNG from the vault but
  // it would be silently turned into mojibake by cachedRead.
  if (IMAGE_EXT.test(ext)) {
    try {
      const size = file.stat?.size ?? 0;
      if (size > MAX_IMAGE_BYTES) {
        return {
          id: uid(), kind: 'file', label: file.basename + '.' + ext,
          detail: file.path,
          content: `### Image (skipped): ${file.path} — ${humanSize(size)} exceeds 5 MB cap.`,
          tokens: 0, pinned: false,
        };
      }
      const { value: dataUri } = await vaultImageDataUriCached(app, file, IMAGE_MIME[ext] ?? 'image/png');
      return {
        id: uid(), kind: 'image', label: file.basename + '.' + ext,
        detail: file.path,
        content: dataUri,
        tokens: Math.ceil(size / 1024),
        pinned: false,
      };
    } catch (e) {
      return {
        id: uid(), kind: 'file', label: file.basename + '.' + ext,
        detail: file.path,
        content: `### Image read failed: ${file.path}\n\n${e?.message ?? e}`,
        tokens: 0, pinned: false,
      };
    }
  }

  // Text-ish (markdown, code, json, etc.) — cachedRead works.
  if (ext === 'md' || ext === 'markdown' || TEXT_EXT.test('.' + ext)) {
    const content = await app.vault.cachedRead(file);
    return {
      id: uid(),
      kind: 'file',
      label: file.basename,
      detail: file.path,
      content: `### File: ${file.path}\n\n${content}`,
      tokens: estimateTokens(content),
      language: inferSelectionLanguage(content),
      pinned: false,
    };
  }

  if (ext === 'pdf') {
    const size = file.stat?.size ?? (await app.vault.adapter.stat(file.path))?.size ?? 0;
    if (size > MAX_PDF_BYTES) {
      return {
        id: uid(), kind: 'file', label: file.basename + '.pdf',
        detail: file.path,
        content: `### PDF (skipped): ${file.path}\n\n${humanSize(size)} exceeds ${humanSize(MAX_PDF_BYTES)} cap. Use a smaller PDF or extract selected pages.`,
        tokens: 0, pinned: false,
      };
    }
    try {
      const { value: res } = await extractVaultPdfCached(app, file, {
        maxPages: PDF_CONTEXT_MAX_PAGES,
        maxChars: PDF_CONTEXT_MAX_CHARS,
        task: options.pdfTask ?? 'auto',
        query: options.pdfQuery,
      });
      const warnings = res.warnings.length ? `\n\nWarnings:\n${res.warnings.map(w => `- ${w}`).join('\n')}` : '';
      const content = `### PDF: ${file.path}\n\n${formatPdfDiagnosticMarkdown(res)}\n\n---\n${res.text}${warnings}`;
      return {
        id: uid(),
        kind: 'file',
        label: file.basename + '.pdf',
        detail: file.path,
        content,
        tokens: estimateTokens(content),
        language: inferSelectionLanguage(res.text),
        pinned: false,
      };
    } catch (e) {
      return {
        id: uid(), kind: 'file', label: file.basename + '.pdf',
        detail: file.path,
        content: `### PDF extraction failed: ${file.path}\n\n${e?.message ?? e}`,
        tokens: 0, pinned: false,
      };
    }
  }

  // Unknown / binary (PDF, audio, video, etc.) — attach metadata only.
  // The model still knows the file exists at this path; it just doesn't
  // get the raw bytes.
  try {
    const stat = await app.vault.adapter.stat(file.path);
    const size = stat?.size ?? 0;
    return {
      id: uid(), kind: 'file', label: file.basename + '.' + ext,
      detail: file.path,
      content: `### Binary file: ${file.path} (${ext.toUpperCase()}, ${humanSize(size)}). Content not extracted — ask the user to convert or summarize.`,
      tokens: 0, pinned: false,
    };
  } catch {
    return {
      id: uid(), kind: 'file', label: file.basename + '.' + ext,
      detail: file.path,
      content: `### Binary file: ${file.path} (${ext.toUpperCase()}). Content not extracted.`,
      tokens: 0, pinned: false,
    };
  }
}

export async function resolveFolder(app: App, folder: TFolder): Promise<ContextItem> {
  void app;
  return {
    id: uid(),
    kind: 'folder',
    label: folder.name + '/',
    detail: folder.path,
    content: 'Folder context is disabled in the community review build. Attach individual files instead.',
    tokens: 0,
    pinned: false,
  };
}

export async function resolveTag(app: App, tag: string): Promise<ContextItem> {
  void app;
  const tagNorm = tag.startsWith('#') ? tag : '#' + tag;
  return {
    id: uid(),
    kind: 'tag',
    label: tagNorm,
    detail: 'disabled',
    content: 'Tag context is disabled in the community review build. Attach individual files instead.',
    tokens: 0,
    pinned: false,
  };
}

const WEB_FETCH_BYTE_CAP = 80_000;
const WEB_FETCH_TIMEOUT_MS = 15_000;

export async function resolveWebUrl(url: string): Promise<ContextItem> {
  let validated: URL;
  try { validated = parseHttpUrl(url); }
  catch (e) {
    return {
      id: uid(), kind: 'web', label: 'rejected', detail: url,
      content: `(refused: ${e.message})`, tokens: 0, pinned: false,
    };
  }
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), WEB_FETCH_TIMEOUT_MS);
  try {
    const r = await fetchWithSafeRedirects(validated.href, ctl.signal);
    let text = await r.text();
    // crude readability: strip script/style + tags
    text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    text = text.slice(0, WEB_FETCH_BYTE_CAP);
    return {
      id: uid(),
      kind: 'web',
      label: validated.hostname + validated.pathname.slice(0, 30),
      detail: validated.href,
      content: `### Web: ${validated.href}\n\n${text}`,
      tokens: estimateTokens(text),
      pinned: false,
    };
  } catch (e) {
    return {
      id: uid(), kind: 'web', label: 'fetch failed', detail: validated.href,
      content: `(failed to fetch ${validated.href}: ${e.message})`, tokens: 0, pinned: false,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function resolveClipboard(): Promise<ContextItem | null> {
  return null;
}

export function makeSelectionItem(sel: SelectionInfo): ContextItem {
  return {
    id: uid(),
    kind: 'selection',
    label: `<selection> (${sel.source})`,
    detail: `${sel.text.length} chars`,
    source: sel.source,
    content: `### Selection (from ${sel.source}${sel.file ? `, ${sel.file.path}` : ''}):\n\n${sel.text}`,
    tokens: estimateTokens(sel.text),
    language: inferSelectionLanguage(sel.text),
    pinned: false,
  };
}

const TEXT_EXT = /\.(md|markdown|txt|json|csv|tsv|log|py|js|ts|jsx|tsx|css|html|xml|yaml|yml|toml|ini|sh|bash|zsh|rs|go|java|c|cpp|h|hpp|swift|kt|sql|graphql|env|gitignore|dockerfile|tex|bib|r|jl|lua|vim|asm)$/i;

export async function resolveDroppedFile(f: File): Promise<ContextItem> {
  if (f.type.startsWith('image/') || IMAGE_EXT.test(fileExtension(f.name))) {
    const mime = supportedImageMime(f);
    if (mime) return resolveImageFile(f, mime);
    return {
      id: uid(), kind: 'file', label: f.name,
      detail: `${humanSize(f.size)} · unsupported image`,
      content: `### Image (unsupported): ${f.name}\n\nConvert to PNG, JPEG, GIF, or WebP before attaching.`,
      tokens: 0, pinned: false,
    };
  }
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
    if (f.size > MAX_PDF_BYTES) {
      return {
        id: uid(), kind: 'file', label: f.name,
        detail: `${humanSize(f.size)} · PDF`,
        content: `### PDF (skipped): ${f.name}\n\n${humanSize(f.size)} exceeds ${humanSize(MAX_PDF_BYTES)} cap. Use a smaller PDF or extract selected pages.`,
        tokens: 0, pinned: false,
      };
    }
    try {
      const res = await extractPdfTextFromArrayBuffer(await f.arrayBuffer(), {
        maxPages: PDF_CONTEXT_MAX_PAGES,
        maxChars: PDF_CONTEXT_MAX_CHARS,
        task: 'auto',
      });
      const warnings = res.warnings.length ? `\n\nWarnings:\n${res.warnings.map(w => `- ${w}`).join('\n')}` : '';
      const content = `### PDF: ${f.name}\n\n${formatPdfDiagnosticMarkdown(res)}\n\n---\n${res.text}${warnings}`;
      return {
        id: uid(), kind: 'file', label: f.name,
        detail: `${humanSize(f.size)} · PDF · ${res.pageCount} pages · read ${res.pageLabel}`,
        content,
        tokens: estimateTokens(content),
        language: inferSelectionLanguage(res.text),
        pinned: false,
      };
    } catch (e) {
      return {
        id: uid(), kind: 'file', label: f.name,
        detail: `${humanSize(f.size)} · PDF`,
        content: `### PDF extraction failed: ${f.name}\n\n${e?.message ?? e}`,
        tokens: 0, pinned: false,
      };
    }
  }
  if (TEXT_EXT.test(f.name) || f.type.startsWith('text/') || f.type === 'application/json') {
    const text = await f.text();
    const trimmed = text.slice(0, 100_000);
    return {
      id: uid(), kind: 'file', label: f.name,
      detail: `${humanSize(f.size)} · text`,
      content: `### File: ${f.name}\n\n${trimmed}${text.length > trimmed.length ? '\n\n[truncated]' : ''}`,
      tokens: estimateTokens(trimmed),
      language: inferSelectionLanguage(trimmed),
      pinned: false,
    };
  }
  // Binary — record metadata only (PDF/DOC etc.)
  return {
    id: uid(), kind: 'file', label: f.name,
    detail: `${humanSize(f.size)} · binary (${f.type || 'unknown'})`,
    content: `### Binary file attached: ${f.name} (${f.type || 'unknown'}, ${f.size} bytes). Content not extracted.`,
    tokens: 0, pinned: false,
  };
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;     // 5 MB hard cap

export async function resolveImageFile(f: File, resolvedMime = supportedImageMime(f)): Promise<ContextItem> {
  if (!resolvedMime) throw new Error('Unsupported image type. Use PNG, JPEG, GIF, or WebP.');
  if (f.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large (${(f.size / 1024 / 1024).toFixed(1)} MB > 5 MB cap). Resize and retry.`);
  }
  const buf = await f.arrayBuffer();
  // Convert to base64 (chunked to avoid call-stack overflow on large files)
  const bytes = new Uint8Array(buf);
  const dataUri = `data:${resolvedMime};base64,${bytesToBase64(bytes)}`;
  return {
    id: uid(), kind: 'image', label: f.name,
    detail: `${humanSize(f.size)} · ${resolvedMime}`,
    content: dataUri,
    tokens: Math.ceil(f.size / 1024),    // rough — varies by model
    pinned: false,
  };
}

function supportedImageMime(file: Pick<File, 'name' | 'type'>): string | null {
  const ext = fileExtension(file.name).toLowerCase();
  const byExtension = IMAGE_MIME[ext];
  if (!byExtension) return null;
  if (!file.type || file.type === 'application/octet-stream') return byExtension;
  return file.type === byExtension ? byExtension : null;
}

function fileExtension(name: string): string {
  const match = /\.([^.]+)$/.exec(name);
  return match?.[1] ?? '';
}

function humanSize(b: number): string {
  if (b < 1024) return b + 'B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB';
  return (b / (1024 * 1024)).toFixed(1) + 'MB';
}

export function makeCurrentFileItem(file: TFile, content: string): ContextItem {
  return {
    id: uid(),
    kind: 'file',
    label: file.basename,
    detail: file.path,
    content: `### Current file: ${file.path}\n\n${content}`,
    tokens: estimateTokens(content),
    language: inferSelectionLanguage(content),
    pinned: false,
    isCurrent: true,
  };
}

/* ============================================================
   Search helpers for @-picker
   ============================================================ */

/** Score a single candidate by how well it matches the (lowercased) query.
 *  Higher = better.
 *  - 400  exact basename match
 *  - 300  basename starts with query
 *  - 200  basename contains query (word boundary or anywhere)
 *  - 100  path starts with query
 *  -  50  path contains query
 *  -   0  no match → callers should drop it
 *  Shorter labels break ties (more specific). A small recency boost
 *  (mtime within the last 30 days) is added on top so familiar files
 *  bubble up. Empty query returns recency-only score so the picker
 *  shows the user's working set without typing anything. */
function scoreMatch(label: string, path: string, query: string, mtimeMs: number): number {
  const lb = label.toLowerCase();
  const lp = path.toLowerCase();
  const recencyBoost = (() => {
    const ageMs = Date.now() - mtimeMs;
    const ageDays = ageMs / 86400000;
    if (ageDays < 0 || !isFinite(ageDays)) return 0;
    return Math.max(0, 30 - ageDays);   // 30 → 0 across last 30 days
  })();
  if (!query) return recencyBoost;       // empty query → recent first
  let s = 0;
  if (lb === query) s = 400;
  else if (lb.startsWith(query)) s = 300;
  else if (lb.includes(query)) s = 200;
  else if (lp.startsWith(query)) s = 100;
  else if (lp.includes(query)) s = 50;
  else return 0;
  s -= Math.min(lb.length, 40) * 0.5;    // shorter labels nudge higher
  return s + recencyBoost;
}

export function listFilesForPicker(app: App, query: string, _limit = 30): { kind: 'file'; file: TFile }[] {
  void _limit;
  const active = app.workspace.getActiveFile();
  if (!active) return [];
  const q = query.toLowerCase().trim();
  if (q && scoreMatch(active.basename, active.path, q, active.stat?.mtime ?? 0) <= 0) return [];
  return [{ kind: 'file', file: active }];
}

export function listFoldersForPicker(_app: App, _query: string, _limit = 20): { kind: 'folder'; folder: TFolder }[] {
  void _app;
  void _query;
  void _limit;
  return [];
}

export function listTagsForPicker(_app: App, _query: string, _limit = 20): string[] {
  void _app;
  void _query;
  void _limit;
  return [];
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
