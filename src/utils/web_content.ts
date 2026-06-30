import { createHash } from 'crypto';

export interface WebFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface WebFetchBytesResult {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string;
  bytes: Uint8Array;
  truncated: boolean;
}

export interface WebMarkdownResult {
  title: string;
  description: string;
  markdown: string;
  links: Array<{ text: string; url: string }>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export async function fetchBytesWithCap(
  fetcher: (url: string, signal: AbortSignal) => Promise<Response>,
  url: string,
  opts: WebFetchOptions = {},
): Promise<WebFetchBytesResult> {
  const ctl = new AbortController();
  const timeout = window.setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => { try { ctl.abort(); } catch { /* noop */ } };
  if (opts.signal) {
    if (opts.signal.aborted) ctl.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const response = await fetcher(url, ctl.signal);
    const maxBytes = Math.max(1, opts.maxBytes ?? DEFAULT_MAX_BYTES);
    const contentType = response.headers.get('content-type') ?? '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const remaining = maxBytes - total;
          if (remaining <= 0) {
            truncated = true;
            try { await reader.cancel(); } catch { /* noop */ }
            break;
          }
          const slice = value.byteLength > remaining ? value.slice(0, remaining) : value;
          chunks.push(slice);
          total += slice.byteLength;
          if (slice.byteLength < value.byteLength) {
            truncated = true;
            try { await reader.cancel(); } catch { /* noop */ }
            break;
          }
        }
      } finally {
        try { reader.releaseLock(); } catch { /* noop */ }
      }
    } else {
      const buf = new Uint8Array(await response.arrayBuffer());
      truncated = buf.byteLength > maxBytes;
      chunks.push(truncated ? buf.slice(0, maxBytes) : buf);
      total = chunks[0]?.byteLength ?? 0;
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      url,
      finalUrl: response.url || url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      bytes,
      truncated,
    };
  } finally {
    window.clearTimeout(timeout);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function extractWebMarkdown(raw: string, baseUrl: string): WebMarkdownResult {
  const withoutNoise = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');

  const title = compactWhitespace(decodeHtml(firstMatch(withoutNoise, /<title\b[^>]*>([\s\S]*?)<\/title>/i)));
  const description = compactWhitespace(decodeHtml(
    firstMatch(withoutNoise, /<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    firstMatch(withoutNoise, /<meta\b[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/i),
  ));
  const links = extractLinks(withoutNoise, baseUrl).slice(0, 80);

  const markdown = decodeHtml(withoutNoise
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, text) => `\n\n${'#'.repeat(Number(level))} ${stripTags(text).trim()}\n\n`)
    .replace(/<p\b[^>]*>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:li|ul|ol|div|section|article|main|header|footer)>/gi, '\n')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const label = stripTags(text).replace(/\s+/g, ' ').trim();
      if (!label) return '';
      const u = safeResolveUrl(href, baseUrl);
      return u ? `[${label}](${u})` : label;
    })
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim());

  return { title, description, markdown, links };
}

export function summarizeMarkdown(markdown: string, mode: unknown, prompt: unknown, maxChars: number): string {
  const text = markdown.trim();
  const normalizedMode = typeof mode === 'string' ? mode.toLowerCase() : 'extract';
  const query = typeof prompt === 'string' ? prompt.trim() : '';
  let result = text;
  if (normalizedMode === 'links') {
    result = text.match(/\[[^\]]+\]\([^)]+\)/g)?.slice(0, 120).join('\n') ?? '';
  } else if (query) {
    const terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(t => t.length >= 2);
    const blocks = text.split(/\n{2,}/).filter(Boolean);
    const scored = blocks.map((block, index) => ({
      block,
      index,
      score: terms.reduce((n, term) => n + countTerm(block.toLowerCase(), term), 0),
    }));
    const hits = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 12);
    result = hits.length ? hits.sort((a, b) => a.index - b.index).map(x => x.block).join('\n\n') : text;
  }
  return result.length > maxChars ? result.slice(0, maxChars) + '\n[truncated]' : result;
}

function countTerm(text: string, term: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const idx = text.indexOf(term, from);
    if (idx < 0) break;
    count++;
    from = idx + term.length;
  }
  return count;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function inferExtension(contentType: string, url: string): string {
  const pathExt = new URL(url).pathname.match(/\.([a-z0-9]{1,8})(?:$|[?#])/i)?.[1]?.toLowerCase();
  if (pathExt) return pathExt;
  const type = contentType.toLowerCase();
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('html')) return 'html';
  if (type.includes('markdown')) return 'md';
  if (type.includes('json')) return 'json';
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('zip')) return 'zip';
  if (type.startsWith('text/')) return 'txt';
  return 'bin';
}

export function sanitizeFilename(name: string, fallback = 'download'): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function firstMatch(text: string, re: RegExp): string {
  return re.exec(text)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, ' ');
}

function extractLinks(html: string, baseUrl: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const url = safeResolveUrl(match[1], baseUrl);
    if (!url) continue;
    const text = compactWhitespace(decodeHtml(stripTags(match[2]))).slice(0, 160);
    if (!text) continue;
    links.push({ text, url });
  }
  return links;
}

function safeResolveUrl(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function decodeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .trim();
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
