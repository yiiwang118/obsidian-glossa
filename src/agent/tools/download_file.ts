/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, vaultFolderOf, type ToolImpl } from './_shared';
import { fetchWithSafeRedirects, parseHttpUrl } from '../../utils/safe_web';
import { fetchBytesWithCap, inferExtension, sanitizeFilename, sha256Hex } from '../../utils/web_content';
import { safeWriteJson } from '../../utils/safe_write';
import type { GlossaSettings } from '../../types';
import { setStyle } from '../../utils/dom';
import { extractPdfTextFromArrayBuffer, formatPdfDiagnosticMarkdown } from '../../utils/pdf';
import { clampNumber, readWebSettings } from './web_common';

const DEFAULT_DOWNLOAD_DIR = 'Downloads/Glossa';
const DEFAULT_MAX_BYTES = 80 * 1024 * 1024;
const HARD_MAX_BYTES = 250 * 1024 * 1024;

export const downloadFile: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'download public URL file to vault',
  backfillObservableInput: normalizePathFields(['save_to']),
  describe: a => `download ${a.url}`,
  preview: async (a) => {
    const target = typeof a.save_to === 'string' && a.save_to.trim()
      ? a.save_to.trim()
      : `${DEFAULT_DOWNLOAD_DIR}/<inferred filename>`;
    const url = typeof a.url === 'string' ? a.url.trim() : '';
    let domain = '';
    try { domain = new URL(url).hostname; } catch { /* noop */ }
    return [
      'Download file',
      domain ? `Domain: ${domain}` : '',
      `URL: ${url}`,
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
    description: [
      'Download a public HTTP(S) file into the Obsidian vault. Use after web_search/web_fetch discovers a real asset URL.',
      'Blocks private/local network targets at every redirect hop, checks size caps, sanitizes filenames, and writes a .source.json provenance file.',
      'For papers, PDFs, images, datasets, release assets, or other downloadable resources. REQUIRES USER APPROVAL.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public HTTP(S) URL to download.' },
        save_to: { type: 'string', description: 'Optional vault-relative file path. If omitted, saves under Downloads/Glossa/.' },
        filename: { type: 'string', description: 'Optional filename used when save_to is a folder or omitted.' },
        allowed_types: { type: 'array', items: { type: 'string' }, description: 'Optional extension/type allowlist, e.g. ["pdf", "png", "html"].' },
        max_bytes: { type: 'number', description: `Maximum bytes to read. Default ${DEFAULT_MAX_BYTES}.` },
        overwrite: { type: 'boolean', description: 'Whether to replace an existing file. Default false.' },
        inspect_after_download: { type: 'boolean', description: 'For PDFs, extract the first page and diagnostic after saving. Use when the user asks to inspect/summarize the downloaded PDF.' },
        confirm_intent: { type: 'boolean', description: 'Set true only when the user explicitly asked to download/save this resource.' },
      },
      required: ['url'],
    },
  },
  run: async (app, args, ctx) => {
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
    try { parseHttpUrl(rawUrl); }
    catch (e: any) { return `Error: ${e.message}`; }
    const settings = readWebSettings(app) as GlossaSettings;
    if (!settings.webAllowAutoDownload && args.confirm_intent !== true) {
      return 'Error: downloads require explicit user intent. Ask the user or call download_file with confirm_intent=true only when the user asked to download/save.';
    }
    const configuredMax = clampNumber(settings.webMaxDownloadBytes, 1_000, HARD_MAX_BYTES, DEFAULT_MAX_BYTES);
    const maxBytes = clampNumber(args.max_bytes, 1_000, configuredMax, configuredMax);
    const allowed = normalizeTypes(args.allowed_types);

    try {
      const fetched = await fetchBytesWithCap(fetchWithSafeRedirects, rawUrl, {
        signal: ctx?.signal,
        timeoutMs: 60_000,
        maxBytes,
      });
      if (fetched.truncated) {
        return `Error: download exceeded max_bytes (${maxBytes.toLocaleString()} bytes). Nothing was saved.`;
      }

      const ext = inferExtension(fetched.contentType, fetched.finalUrl);
      if (allowed.length && !allowed.includes(ext) && !allowed.some(t => fetched.contentType.toLowerCase().includes(t))) {
        return `Error: downloaded content type "${fetched.contentType || 'unknown'}" / extension ".${ext}" is not allowed (${allowed.join(', ')}).`;
      }

      const target = chooseTargetPath(args.save_to, args.filename, fetched.finalUrl, ext, settings.webDefaultDownloadFolder);
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
        }, { pretty: true });
      }

      const inspection = args.inspect_after_download === true && ext === 'pdf'
        ? await inspectPdfDownload(buffer, ctx?.signal)
        : '';
      return [
        `Downloaded: ${target}`,
        `Source: ${fetched.finalUrl}`,
        `Content-Type: ${fetched.contentType || 'unknown'}`,
        `Size: ${humanSize(fetched.bytes.byteLength)}`,
        `SHA256: ${sha256}`,
        settings.webSaveProvenance !== false ? `Provenance: ${sourcePath}` : '',
        inspection,
        nextInspectionHint(target, ext),
      ].filter(Boolean).join('\n');
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        if (ctx?.signal?.aborted) return 'Error: cancelled by user.';
        return 'Error: timeout after 60s';
      }
      return `Error downloading ${rawUrl}: ${e?.message ?? e}`;
    }
  },
});

function chooseTargetPath(saveTo: unknown, filename: unknown, finalUrl: string, ext: string, defaultFolder: unknown): string {
  const explicit = typeof saveTo === 'string' ? saveTo.trim() : '';
  if (explicit) {
    const normalized = assertVaultPath(explicit, 'save_to');
    if (!normalized.endsWith('/')) return normalized;
    return `${normalized}${inferFilename(filename, finalUrl, ext)}`;
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
  } catch (e: any) {
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
