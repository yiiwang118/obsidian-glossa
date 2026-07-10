/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile, TFolder } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, vaultFolderOf, type ToolImpl } from './_shared';
import { fetchWithSafeRedirects, parseHttpUrl } from '../../utils/safe_web';
import { fetchBytesWithCap, inferExtension, sanitizeFilename, sha256Hex, type WebFetchBytesResult } from '../../utils/web_content';
import { safeWriteJson } from '../../utils/safe_write';
import type { GlossaSettings } from '../../types';
import { setStyle } from '../../utils/dom';
import { extractPdfTextFromArrayBuffer, formatPdfDiagnosticMarkdown } from '../../utils/pdf';
import { clampNumber, httpFallbackUrl, readWebSettings } from './web_common';
import { findDownloadCandidates } from './web_search';

const DEFAULT_DOWNLOAD_DIR = 'Downloads/Glossa';
const DEFAULT_MAX_BYTES = 80 * 1024 * 1024;
const HARD_MAX_BYTES = 250 * 1024 * 1024;

export const downloadFile: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'download public URL file to vault',
  backfillObservableInput: normalizePathFields(['save_to']),
  describe: a => `download ${a.url ?? a.query ?? 'file'}`,
  preview: async (a) => {
    const target = typeof a.save_to === 'string' && a.save_to.trim()
      ? a.save_to.trim()
      : `${DEFAULT_DOWNLOAD_DIR}/<inferred filename>`;
    const url = typeof a.url === 'string' ? a.url.trim() : '';
    const query = typeof a.query === 'string' ? a.query.trim() : '';
    let domain = '';
    try { domain = new URL(url).hostname; } catch { /* noop */ }
    return [
      'Download file',
      domain ? `Domain: ${domain}` : '',
      url ? `URL: ${url}` : `Find: ${query}`,
      `Target: ${target}`,
      `Max size: ${humanSize(clampNumber(a.max_bytes, 1_000, HARD_MAX_BYTES, DEFAULT_MAX_BYTES))}`,
      a.overwrite === true ? 'Overwrite: yes' : 'Overwrite: no',
      a.inspect_after_download === true ? 'Post-download PDF inspection: yes' : '',
      'A .source.json provenance file will be written next to the download when enabled.',
    ].filter(Boolean).join('\n');
  },
  renderToolResultMessage(result) {
    if (!result.startsWith('Downloaded:')) return null;
    const fields = parseResultFields(result);
    const wrap = activeDocument.createElement('div');
    wrap.addClass('nc-download-result');
    setStyle(wrap, { display: 'grid', gap: '6px', padding: '8px 10px' });
    const title = wrap.createEl('div', { text: fields.Downloaded ?? 'Downloaded file' });
    setStyle(title, { fontWeight: '700' });
    const source = fields.Source ? wrap.createEl('div', { text: fields.Source }) : null;
    if (source) setStyle(source, { color: 'var(--text-muted)', fontSize: '12px', overflowWrap: 'anywhere' });
    const meta = wrap.createEl('div', { text: [fields['Content-Type'], fields.Size].filter(Boolean).join(' · ') });
    setStyle(meta, { color: 'var(--text-faint)', fontSize: '12px' });
    if (fields.SHA256) {
      const hash = wrap.createEl('code', { text: `sha256:${fields.SHA256.slice(0, 16)}…` });
      setStyle(hash, { fontSize: '11px' });
    }
    if (fields.Provenance) {
      const prov = wrap.createEl('div', { text: `source: ${fields.Provenance}` });
      setStyle(prov, { color: 'var(--text-faint)', fontSize: '11px' });
    }
    return wrap;
  },
  spec: {
    name: 'download_file',
    description: 'Save one public file into the vault. Pass url when known; otherwise pass an exact title/query so candidates can be ranked and validated before writing. Private-network redirects, oversize responses, wrong file types, and accidental overwrites are rejected. Requires explicit download intent and user approval.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public HTTP(S) URL to download.' },
        query: { type: 'string', description: 'Title or search query used when a direct URL is unknown. For papers, pass the exact title.' },
        save_to: { type: 'string', description: 'Optional vault-relative file path. If omitted, saves under Downloads/Glossa/.' },
        filename: { type: 'string', description: 'Optional filename used when save_to is a folder or omitted.' },
        allowed_types: { type: 'array', items: { type: 'string' }, description: 'Optional extension/type allowlist, e.g. ["pdf", "png", "html"].' },
        max_bytes: { type: 'integer', minimum: 1000, maximum: HARD_MAX_BYTES, description: `Maximum bytes to read. Default ${DEFAULT_MAX_BYTES}.` },
        overwrite: { type: 'boolean', description: 'Whether to replace an existing file. Default false.' },
        inspect_after_download: { type: 'boolean', description: 'For PDFs, extract the first page and diagnostic after saving. Use when the user asks to inspect/summarize the downloaded PDF.' },
        confirm_intent: { type: 'boolean', description: 'Set true only when the user explicitly asked to download/save this resource.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  run: async (app, args, ctx) => {
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!rawUrl && query.length < 2) return 'Error: provide either a public url or a query/title with at least 2 characters.';
    if (rawUrl) {
      try { parseHttpUrl(rawUrl); }
      catch (e) { return `Error: ${e.message}`; }
    }
    const settings = readWebSettings(app) as GlossaSettings;
    if (!settings.webAllowAutoDownload && args.confirm_intent !== true) {
      return 'Error: downloads require explicit user intent. Ask the user or call download_file with confirm_intent=true only when the user asked to download/save.';
    }
    const configuredMax = clampNumber(settings.webMaxDownloadBytes, 1_000, HARD_MAX_BYTES, DEFAULT_MAX_BYTES);
    const maxBytes = clampNumber(args.max_bytes, 1_000, configuredMax, configuredMax);
    const allowed = normalizeTypes(args.allowed_types);

    const candidates = await resolveDownloadCandidates(rawUrl, query, ctx?.signal);
    if (!candidates.length) return `Error: no download candidates found for "${query}". Nothing was saved.`;
    const failures: string[] = [];
    let selected: { fetched: WebFetchBytesResult; ext: string; candidate: DownloadCandidate } | null = null;
    for (const candidate of candidates.slice(0, 8)) {
      try {
        const fetched = await fetchBytesWithCap(fetchWithSafeRedirects, candidate.url, {
          signal: ctx?.signal,
          timeoutMs: 60_000,
          maxBytes,
        });
        const ext = validateFetchedCandidate(fetched, allowed, !!query);
        selected = { fetched, ext, candidate };
        break;
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e;
        failures.push(`${candidate.url} -> ${errorMessage(e)}`);
      }
    }
    if (!selected) {
      return [
        `Error: none of ${Math.min(candidates.length, 8)} download candidate(s) passed validation. Nothing was saved.`,
        ...failures.slice(0, 8).map(failure => `- ${failure}`),
      ].join('\n');
    }

    const { fetched, ext, candidate } = selected;
    try {
      const requestedName = args.filename ?? (query ? filenameFromQuery(query, ext) : undefined);
      const saveTo = typeof args.save_to === 'string' ? args.save_to.trim().replace(/\/+$/, '') : '';
      const saveToIsFolder = !!saveTo && app.vault.getAbstractFileByPath(saveTo) instanceof TFolder;
      const target = chooseTargetPath(args.save_to, requestedName, fetched.finalUrl, ext, settings.webDefaultDownloadFolder, saveToIsFolder);
      const existing = app.vault.getAbstractFileByPath(target);
      if (existing && !args.overwrite) {
        return `Error: target already exists: ${target}. Pass overwrite=true or choose a different save_to.`;
      }
      if (existing && !(existing instanceof TFile)) return `Error: target path is a folder: ${target}`;

      const folder = vaultFolderOf(target);
      if (folder) try { await app.vault.createFolder(folder); } catch { /* exists */ }
      const buffer = fetched.bytes.slice().buffer;
      if (existing instanceof TFile) await app.vault.modifyBinary(existing, buffer);
      else await app.vault.createBinary(target, buffer);

      const sha256 = sha256Hex(fetched.bytes);
      const sourcePath = `${target}.source.json`;
      if (settings.webSaveProvenance !== false) {
        await safeWriteJson(app.vault.adapter, sourcePath, {
          source_url: rawUrl,
          final_url: fetched.finalUrl,
          downloaded_at: new Date().toISOString(),
          content_type: fetched.contentType || null,
          size_bytes: fetched.bytes.byteLength,
          sha256,
          status: fetched.status,
          status_text: fetched.statusText,
          discovery_query: query || null,
          discovery_source: candidate.source,
          candidate_failures: failures,
        }, { pretty: true });
      }

      const inspection = args.inspect_after_download === true && ext === 'pdf'
        ? await inspectPdfDownload(buffer, ctx?.signal)
        : '';
      return [
        `Downloaded: ${target}`,
        `Source: ${fetched.finalUrl}`,
        query ? `Discovery: ${candidate.source} · ${query}` : '',
        `Content-Type: ${fetched.contentType || 'unknown'}`,
        `Size: ${humanSize(fetched.bytes.byteLength)}`,
        `SHA256: ${sha256}`,
        settings.webSaveProvenance !== false ? `Provenance: ${sourcePath}` : '',
        inspection,
        nextInspectionHint(target, ext),
      ].filter(Boolean).join('\n');
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (ctx?.signal?.aborted) return 'Error: cancelled by user.';
        return 'Error: timeout after 60s';
      }
      const failedUrl = selected?.candidate.url ?? rawUrl;
      return `Error downloading ${failedUrl}: ${e?.message ?? e}${downloadHttpFallbackHint(failedUrl, e, ctx?.signal)}`;
    }
  },
});

export function downloadHttpFallbackHint(url: string, error: unknown, signal?: AbortSignal): string {
  const fallbackUrl = httpFallbackUrl(url, error, signal);
  if (!fallbackUrl) return '';
  return [
    '',
    'HTTPS failed before saving. For read-only extraction, use web_fetch or web_research; those tools can report an HTTP fallback without writing files.',
    `To save via HTTP, retry download_file with url="${fallbackUrl}" only if the user accepts the non-HTTPS source.`,
  ].join('\n');
}

interface DownloadCandidate {
  url: string;
  source: string;
}

async function resolveDownloadCandidates(
  rawUrl: string,
  query: string,
  signal?: AbortSignal,
): Promise<DownloadCandidate[]> {
  const out: DownloadCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string, source: string) => {
    try { parseHttpUrl(url); }
    catch { return; }
    const key = url.replace(/#.*$/, '').replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url, source });
  };
  if (rawUrl) add(rawUrl, 'direct URL');
  if (query) {
    const discovered = await findDownloadCandidates(query, 12, signal).catch(() => []);
    for (const result of discovered) add(result.url, result.source);
  }
  return out;
}

export function validateFetchedCandidate(
  fetched: WebFetchBytesResult,
  allowedTypes: readonly string[],
  queryMode: boolean,
): string {
  if (fetched.status < 200 || fetched.status >= 300) {
    throw new Error(`HTTP ${fetched.status} ${fetched.statusText}`.trim());
  }
  if (fetched.truncated) throw new Error('candidate exceeded max_bytes');
  if (fetched.bytes.byteLength === 0) throw new Error('candidate returned an empty body');
  const ext = verifiedExtension(fetched);
  const type = fetched.contentType.toLowerCase();
  if (queryMode && allowedTypes.length === 0 && (ext === 'html' || type.includes('text/html'))) {
    throw new Error('candidate is an HTML landing page, not a downloadable asset');
  }
  if (allowedTypes.length && !allowedTypes.includes(ext) && !allowedTypes.some(item => type.includes(item))) {
    throw new Error(`content type "${fetched.contentType || 'unknown'}" / extension ".${ext}" is not allowed (${allowedTypes.join(', ')})`);
  }
  if (ext === 'pdf' && !hasPdfMagic(fetched.bytes)) {
    throw new Error('candidate claimed to be PDF but does not contain a PDF file header');
  }
  return ext;
}

function verifiedExtension(fetched: WebFetchBytesResult): string {
  if (hasPdfMagic(fetched.bytes)) return 'pdf';
  const contentTypeExt = inferExtension(fetched.contentType, 'https://download.invalid/file');
  if (contentTypeExt !== 'bin') return contentTypeExt;
  return inferExtension('', fetched.finalUrl);
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.byteLength - 4, 1_024);
  for (let index = 0; index <= limit; index++) {
    if (bytes[index] === 0x25 && bytes[index + 1] === 0x50 && bytes[index + 2] === 0x44 && bytes[index + 3] === 0x46 && bytes[index + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

function filenameFromQuery(query: string, ext: string): string {
  const title = query
    .replace(/\b(?:find|locate|get|download|fetch|save|official|paper|pdf|file|url|link|source|filetype)\b/gi, ' ')
    .replace(/(?:下载|查找|搜索|获取|保存|论文|文件|链接|地址|一下)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withExtension(sanitizeFilename(title || 'download'), ext);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chooseTargetPath(saveTo: unknown, filename: unknown, finalUrl: string, ext: string, defaultFolder: unknown, saveToIsFolder = false): string {
  const explicit = typeof saveTo === 'string' ? saveTo.trim() : '';
  if (explicit) {
    const normalized = assertVaultPath(explicit, 'save_to');
    if (!normalized.endsWith('/') && !saveToIsFolder) return normalized;
    return `${normalized.replace(/\/+$/, '')}/${inferFilename(filename, finalUrl, ext)}`;
  }
  const folder = typeof defaultFolder === 'string' && defaultFolder.trim()
    ? assertVaultPath(defaultFolder.trim(), 'webDefaultDownloadFolder').replace(/\/+$/, '')
    : DEFAULT_DOWNLOAD_DIR;
  return `${folder}/${inferFilename(filename, finalUrl, ext)}`;
}

async function inspectPdfDownload(buffer: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  try {
    const res = await extractPdfTextFromArrayBuffer(buffer, {
      task: 'inspect',
      maxPages: 1,
      maxChars: 8_000,
      signal,
    });
    const firstLines = res.text.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 12).join('\n');
    return [
      'PDF inspection:',
      formatPdfDiagnosticMarkdown(res),
      firstLines ? `\nFirst-page text:\n${firstLines}` : '',
    ].filter(Boolean).join('\n');
  } catch (e) {
    return `PDF inspection: failed (${e?.message ?? e})`;
  }
}

function inferFilename(filename: unknown, finalUrl: string, ext: string): string {
  const supplied = typeof filename === 'string' ? filename.trim() : '';
  if (supplied) return sanitizeFilename(withExtension(supplied, ext));
  let base = '';
  try {
    const pathname = decodeURIComponent(new URL(finalUrl).pathname);
    base = pathname.split('/').filter(Boolean).pop() ?? '';
  } catch { /* noop */ }
  return sanitizeFilename(withExtension(base || `download-${Date.now().toString(36)}`, ext));
}

function withExtension(name: string, ext: string): string {
  if (!ext || /\.[a-z0-9]{1,8}$/i.test(name)) return name;
  return `${name}.${ext}`;
}

function normalizeTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((x): x is string => typeof x === 'string')
    .map(x => x.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean))];
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nextInspectionHint(path: string, ext: string): string {
  if (ext === 'pdf') return `Next: call read_pdf with path="${path}" to inspect the downloaded PDF.`;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return `Next: call view_image with path="${path}" to inspect the downloaded image.`;
  if (['md', 'txt', 'html', 'json'].includes(ext)) return `Next: call read_note with path="${path}" if text inspection is needed.`;
  return '';
}

function parseResultFields(result: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of result.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
