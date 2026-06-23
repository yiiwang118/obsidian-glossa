import { App, TFile, TFolder, MarkdownView, FileView, getAllTags, normalizePath } from 'obsidian';
import { estimateTokens } from '../utils/tokens';
import { uid } from '../utils/dom';
import { fetchWithSafeRedirects, parseHttpUrl } from '../utils/safe_web';
import { extractPdfTextFromArrayBuffer } from '../utils/pdf';
import type { ContextItem } from '../types';

/* ============================================================
   Selection extraction — works on markdown, PDF, HTML, custom views
   ============================================================ */

export interface SelectionInfo {
  text: string;
  source: 'markdown' | 'pdf' | 'html' | 'unknown';
  file?: TFile;
}

export function getCurrentSelection(app: App): SelectionInfo | null {
  const af = app.workspace.getActiveFile();

  // 1) Markdown editor — most accurate
  const mdView = app.workspace.getActiveViewOfType(MarkdownView);
  if (mdView?.editor) {
    const sel = mdView.editor.getSelection();
    if (sel && sel.trim()) return { text: sel, source: 'markdown', file: af ?? undefined };
  }

  // 2) Generic DOM selection — covers PDF.js text layer, HTML view, canvas text, web view, etc.
  const winSel = window.getSelection();
  if (winSel && winSel.toString().trim()) {
    const view = app.workspace.getMostRecentLeaf()?.view;
    let source: SelectionInfo['source'] = 'unknown';
    const vt = view?.getViewType?.();
    if (vt === 'pdf') source = 'pdf';
    else if (vt === 'markdown') source = 'markdown';
    else if (vt === 'html' || (af && af.extension.toLowerCase() === 'html')) source = 'html';
    else if (af?.extension?.toLowerCase() === 'pdf') source = 'pdf';
    return { text: winSel.toString(), source, file: af ?? undefined };
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
const IMAGE_EXT = /^(png|jpg|jpeg|gif|webp|bmp|svg)$/i;
/** Common MIME guesses for image extensions, so the data URI sets a
 *  reasonable Content-Type even when Obsidian doesn't supply one. */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
};
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PDF_CONTEXT_MAX_PAGES = 80;
const PDF_CONTEXT_MAX_CHARS = 100_000;

export async function resolveFile(app: App, file: TFile): Promise<ContextItem> {
  const ext = (file.extension || '').toLowerCase();

  // Images → attach as inline base64 image so multimodal providers receive
  // the pixels. Without this branch users could @ a PNG from the vault but
  // it would be silently turned into mojibake by cachedRead.
  if (IMAGE_EXT.test(ext)) {
    try {
      const buf = await app.vault.readBinary(file);
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        return {
          id: uid(), kind: 'file', label: file.basename + '.' + ext,
          detail: file.path,
          content: `### Image (skipped): ${file.path} — ${humanSize(buf.byteLength)} exceeds 5 MB cap.`,
          tokens: 0, pinned: false,
        };
      }
      const bytes = new Uint8Array(buf);
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
      }
      const dataUri = `data:${IMAGE_MIME[ext] ?? 'image/png'};base64,${btoa(bin)}`;
      return {
        id: uid(), kind: 'image', label: file.basename + '.' + ext,
        detail: file.path,
        content: dataUri,
        tokens: Math.ceil(buf.byteLength / 1024),
        pinned: false,
      };
    } catch (e: any) {
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
      const buf = await app.vault.readBinary(file);
      const res = await extractPdfTextFromArrayBuffer(buf, {
        maxPages: PDF_CONTEXT_MAX_PAGES,
        maxChars: PDF_CONTEXT_MAX_CHARS,
      });
      const warnings = res.warnings.length ? `\n\nWarnings:\n${res.warnings.map(w => `- ${w}`).join('\n')}` : '';
      const content = `### PDF: ${file.path}\n\n${res.text}${warnings}`;
      return {
        id: uid(),
        kind: 'file',
        label: file.basename + '.pdf',
        detail: `${file.path} · ${res.pageCount} pages · read ${res.pageLabel}`,
        content,
        tokens: estimateTokens(content),
        pinned: false,
      };
    } catch (e: any) {
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
  const files = folder.children.filter((c): c is TFile => c instanceof TFile && c.extension === 'md');
  const parts: string[] = [];
  for (const f of files.slice(0, 30)) {        // cap to avoid context bombs
    const text = await app.vault.cachedRead(f);
    parts.push(`### ${f.path}\n${text}`);
  }
  const content = parts.join('\n\n');
  return {
    id: uid(),
    kind: 'folder',
    label: folder.name + '/',
    detail: `${files.length} files`,
    content,
    tokens: estimateTokens(content),
    pinned: false,
  };
}

export async function resolveTag(app: App, tag: string): Promise<ContextItem> {
  const tagNorm = tag.startsWith('#') ? tag : '#' + tag;
  const parts: string[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(f);
    const all = cache ? getAllTags(cache) ?? [] : [];
    if (all.includes(tagNorm)) {
      parts.push(`### ${f.path}\n${await app.vault.cachedRead(f)}`);
      if (parts.length >= 20) break;
    }
  }
  const content = parts.join('\n\n');
  return {
    id: uid(),
    kind: 'tag',
    label: tagNorm,
    detail: `${parts.length} notes`,
    content,
    tokens: estimateTokens(content),
    pinned: false,
  };
}

const WEB_FETCH_BYTE_CAP = 80_000;
const WEB_FETCH_TIMEOUT_MS = 15_000;

export async function resolveWebUrl(url: string): Promise<ContextItem> {
  let validated: URL;
  try { validated = parseHttpUrl(url); }
  catch (e: any) {
    return {
      id: uid(), kind: 'web', label: 'rejected', detail: url,
      content: `(refused: ${e.message})`, tokens: 0, pinned: false,
    };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WEB_FETCH_TIMEOUT_MS);
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
  } catch (e: any) {
    return {
      id: uid(), kind: 'web', label: 'fetch failed', detail: validated.href,
      content: `(failed to fetch ${validated.href}: ${e.message})`, tokens: 0, pinned: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveClipboard(): Promise<ContextItem | null> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return null;
    return {
      id: uid(), kind: 'clipboard', label: 'clipboard',
      detail: text.length + ' chars',
      content: `### Clipboard\n\n${text}`,
      tokens: estimateTokens(text), pinned: false,
    };
  } catch { return null; }
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
    pinned: false,
  };
}

const TEXT_EXT = /\.(md|markdown|txt|json|csv|tsv|log|py|js|ts|jsx|tsx|css|html|xml|yaml|yml|toml|ini|sh|bash|zsh|rs|go|java|c|cpp|h|hpp|swift|kt|sql|graphql|env|gitignore|dockerfile|tex|bib|r|jl|lua|vim|asm)$/i;

export async function resolveDroppedFile(f: File): Promise<ContextItem> {
  if (f.type.startsWith('image/')) return resolveImageFile(f);
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
      });
      const warnings = res.warnings.length ? `\n\nWarnings:\n${res.warnings.map(w => `- ${w}`).join('\n')}` : '';
      const content = `### PDF: ${f.name}\n\n${res.text}${warnings}`;
      return {
        id: uid(), kind: 'file', label: f.name,
        detail: `${humanSize(f.size)} · PDF · ${res.pageCount} pages · read ${res.pageLabel}`,
        content,
        tokens: estimateTokens(content),
        pinned: false,
      };
    } catch (e: any) {
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

export async function resolveImageFile(f: File): Promise<ContextItem> {
  if (f.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large (${(f.size / 1024 / 1024).toFixed(1)} MB > 5 MB cap). Resize and retry.`);
  }
  const buf = await f.arrayBuffer();
  // Convert to base64 (chunked to avoid call-stack overflow on large files)
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
  }
  const base64 = btoa(binary);
  const dataUri = `data:${f.type || 'image/png'};base64,${base64}`;
  return {
    id: uid(), kind: 'image', label: f.name,
    detail: `${humanSize(f.size)} · ${f.type || 'image'}`,
    content: dataUri,
    tokens: Math.ceil(f.size / 1024),    // rough — varies by model
    pinned: false,
  };
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

export function listFilesForPicker(app: App, query: string, limit = 30): { kind: 'file'; file: TFile }[] {
  // Aurora v0.4: `getFiles()` instead of `getMarkdownFiles()` — users
  // routinely want to @ PDFs, images, code files, .canvas, etc. The
  // resolve step downstream handles each extension correctly.
  const files = app.vault.getFiles();
  const q = query.toLowerCase().trim();
  type Hit = { file: TFile; score: number };
  const hits: Hit[] = [];
  for (const f of files) {
    const score = scoreMatch(f.basename, f.path, q, f.stat?.mtime ?? 0);
    if (score <= 0 && q) continue;
    hits.push({ file: f, score });
  }
  hits.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  return hits.slice(0, limit).map(h => ({ kind: 'file' as const, file: h.file }));
}

export function listFoldersForPicker(app: App, query: string, limit = 20): { kind: 'folder'; folder: TFolder }[] {
  const root = app.vault.getRoot();
  const all: TFolder[] = [];
  const visit = (f: TFolder) => {
    all.push(f);
    f.children.forEach(c => { if (c instanceof TFolder) visit(c); });
  };
  visit(root);
  const q = query.toLowerCase().trim();
  type Hit = { folder: TFolder; score: number };
  const hits: Hit[] = [];
  for (const f of all) {
    if (!f.path) continue;        // skip the virtual root
    // Use folder name as the "label" for scoring so a query like
    // "research" prioritizes /research/ over /papers/research-notes/.
    const score = scoreMatch(f.name || f.path, f.path, q, 0);
    if (score <= 0 && q) continue;
    // Empty-query case: just sort by path alphabetically (no mtime
    // signal for folders); scoreMatch returns 0 for everyone, so
    // we get a stable alphabetic listing.
    hits.push({ folder: f, score });
  }
  hits.sort((a, b) => b.score - a.score || a.folder.path.localeCompare(b.folder.path));
  return hits.slice(0, limit).map(h => ({ kind: 'folder' as const, folder: h.folder }));
}

export function listTagsForPicker(app: App, query: string, limit = 20): string[] {
  const counts = new Map<string, number>();
  for (const f of app.vault.getMarkdownFiles()) {
    const c = app.metadataCache.getFileCache(f);
    if (!c) continue;
    for (const t of getAllTags(c) ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const q = query.toLowerCase().trim();
  return [...counts.entries()]
    .filter(([t]) => !q || t.toLowerCase().includes(q))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))    // frequency desc, then alpha
    .slice(0, limit)
    .map(([t]) => t);
}
