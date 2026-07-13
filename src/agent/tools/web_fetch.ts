/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { buildTool, type ToolImpl } from './_shared';
import { fetchWithSafeRedirects, parseHttpUrl } from '../../utils/safe_web';
import { decodeUtf8, extractWebMarkdown, fetchBytesWithCap, summarizeMarkdown, type WebFetchBytesResult, type WebFetchOptions } from '../../utils/web_content';
import { clampNumber, httpFallbackUrl, webReadPermission } from './web_common';

interface WebFetchFallbackResult extends WebFetchBytesResult {
  fallbackFrom?: string;
  fallbackError?: string;
}

export const webFetch: ToolImpl = buildTool({
  // Network egress — destructive in the sense of having side effects (logs, billing)
  // even though it doesn't mutate the vault. Always require approval.
  dangerous: true,
  isReadOnly: () => true,
  isDestructive: () => false,
  isConcurrencySafe: () => true,    // pure fetch — multiple in parallel is fine
  checkPermissions: async (app) => webReadPermission(app, 'Network fetch requires approval.'),
  searchHint: 'fetch public web URL extract markdown',
  describe: a => `fetch ${a.url}`,
  preview: async (a) => {
    const url = typeof a.url === 'string' ? a.url.trim() : '';
    let domain = '';
    try { domain = new URL(url).hostname; } catch { /* noop */ }
    const mode = typeof a.mode === 'string' && a.mode.trim() ? a.mode.trim() : 'extract';
    return [
      'Fetch web page',
      domain ? `Domain: ${domain}` : '',
      `URL: ${url}`,
      `Mode: ${mode}`,
      a.prompt ? `Intent: ${String(a.prompt).slice(0, 180)}` : '',
      'Reads a public URL with private-network redirect blocking; no files will be written.',
    ].filter(Boolean).join('\n');
  },
  spec: {
    name: 'web_fetch',
    description: 'Fetch one known public HTTP(S) URL and return bounded Markdown/text, links, or metadata. Supply a focused prompt to extract only relevant content. It blocks private-network redirects and never writes files; use download_file for binary resources. Network access requires approval.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public HTTP(S) URL to fetch.' },
        prompt: { type: 'string', description: 'Optional extraction intent, e.g. "find the install steps" or "extract download links".' },
        mode: { type: 'string', enum: ['extract', 'summary', 'raw', 'links', 'metadata'], description: 'Returned representation. Default extract.' },
        max_chars: { type: 'integer', minimum: 1000, maximum: 100000, description: 'Maximum returned content characters. Default 30000.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  run: async (_app, { url, prompt, mode, max_chars }, ctx) => {
    try {
      parseHttpUrl(url);
      const cap = clampNumber(max_chars, 1_000, 100_000, 30_000);
      const fetched = await fetchBytesWithHttpFallback(fetchWithSafeRedirects, url, {
        signal: ctx?.signal,
        timeoutMs: 30_000,
        maxBytes: 8 * 1024 * 1024,
      });
      const raw = decodeUtf8(fetched.bytes);
      const contentType = fetched.contentType.toLowerCase();
      const parsed = contentType.includes('html')
        ? extractWebMarkdown(raw, fetched.finalUrl)
        : { title: '', description: '', markdown: raw.trim(), links: [] };
      const normalizedMode = typeof mode === 'string' ? mode.toLowerCase() : 'extract';
      const body = normalizedMode === 'metadata'
        ? ''
        : summarizeMarkdown(parsed.markdown, normalizedMode, prompt, cap);
      const meta = [
        `URL: ${fetched.finalUrl}`,
        fetched.finalUrl !== url ? `Original URL: ${url}` : '',
        fetched.fallbackFrom ? `Fallback from URL: ${fetched.fallbackFrom}` : '',
        fetched.fallbackError ? `Initial fetch error: ${fetched.fallbackError}` : '',
        `Status: ${fetched.status} ${fetched.statusText}`,
        `Content-Type: ${fetched.contentType || 'unknown'}`,
        `Bytes read: ${fetched.bytes.byteLength}${fetched.truncated ? ' (truncated)' : ''}`,
        parsed.title ? `Title: ${parsed.title}` : '',
        parsed.description ? `Description: ${parsed.description}` : '',
        `Links found: ${parsed.links.length}`,
      ].filter(Boolean).join('\n');

      const linkBlock = (normalizedMode === 'links' || normalizedMode === 'metadata')
        ? parsed.links.slice(0, 80).map(l => `- [${l.text}](${l.url})`).join('\n')
        : '';
      return [meta, body ? `\n---\n${body}` : '', linkBlock ? `\n---\nLinks:\n${linkBlock}` : ''].join('\n').trim();
    } catch (e) {
      if (e.name === 'AbortError') {
        // Distinguish "user pressed Stop" from "10s timeout" so the
        // surfaced message is honest.
        if (ctx?.signal?.aborted) return `Error: cancelled by user.`;
        return `Error: timeout after 30s`;
      }
      return `Error fetching ${url}: ${e.message}`;
    }
  },
});

export async function fetchBytesWithHttpFallback(
  fetcher: (url: string, signal: AbortSignal) => Promise<Response>,
  url: string,
  opts: WebFetchOptions = {},
): Promise<WebFetchFallbackResult> {
  try {
    return await fetchBytesWithCap(fetcher, url, opts);
  } catch (e) {
    const fallbackUrl = httpFallbackUrl(url, e, opts.signal);
    if (!fallbackUrl) throw e;
    try {
      const fetched = await fetchBytesWithCap(fetcher, fallbackUrl, opts);
      return {
        ...fetched,
        fallbackFrom: url,
        fallbackError: errorMessage(e),
      };
    } catch (fallbackError) {
      throw new Error(`initial fetch failed (${errorMessage(e)}); HTTP fallback also failed (${errorMessage(fallbackError)})`);
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') return String(error);
  return 'Unknown error';
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
