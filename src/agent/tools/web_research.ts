/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import { buildTool, type ToolImpl } from './_shared';
import { fetchWithSafeRedirects } from '../../utils/safe_web';
import { decodeUtf8, extractWebMarkdown, fetchBytesWithCap, summarizeMarkdown } from '../../utils/web_content';
import { rankSearchResults, runWebSearchProvider, type SearchResult } from './web_search';
import { clampNumber, normalizeDomains, normalizeSearchProvider, readWebSettings, webReadPermission } from './web_common';

export const webResearch: ToolImpl = buildTool({
  dangerous: true,
  isReadOnly: () => true,
  isDestructive: () => false,
  isConcurrencySafe: () => false,
  checkPermissions: async (app) => webReadPermission(app, 'Web research requires network approval.'),
  searchHint: 'search fetch synthesize web sources',
  describe: a => `research web "${String(a.goal ?? a.query ?? '').slice(0, 80)}"`,
  preview: async (a) => {
    const mode = typeof a.mode === 'string' && a.mode.trim() ? a.mode.trim() : 'answer';
    return [
      `Research goal: ${String(a.goal ?? '').trim()}`,
      `Query: ${String(a.query ?? a.goal ?? '').trim()}`,
      `Mode: ${mode}`,
      `Fetch top: ${String(a.fetch_top ?? 3)}`,
      'Searches and fetches public web pages; does not write files.',
    ].join('\n');
  },
  spec: {
    name: 'web_research',
    description: [
      'High-level web research pipeline: search the web, fetch the best source pages, extract relevant content, and return grounded source candidates.',
      'Use this when the user wants current information or wants to find a downloadable resource but has not provided a direct URL.',
      'This tool does not write files. If a file should be saved, call download_file separately with the chosen direct URL.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'User goal or research question.' },
        query: { type: 'string', description: 'Optional explicit search query. Defaults to goal.' },
        mode: { type: 'string', description: 'answer, find_sources, or find_downloads. Default answer.' },
        allowed_domains: { type: 'array', items: { type: 'string' } },
        blocked_domains: { type: 'array', items: { type: 'string' } },
        max_results: { type: 'number', description: 'Search results to keep. Default 6.' },
        fetch_top: { type: 'number', description: 'Top results to fetch. Default 3.' },
      },
      required: ['goal'],
    },
  },
  run: async (app, args, ctx) => {
    const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
    if (!goal) return 'Error: goal is required.';
    const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : goal;
    const settings = readWebSettings(app);
    const provider = normalizeSearchProvider(settings.webSearchProvider);
    const apiKey = settings.webSearchApiKey ?? '';
    const maxResults = clampNumber(args.max_results, 1, 12, 6);
    const fetchTop = clampNumber(args.fetch_top, 0, 6, 3);
    const allowed = normalizeDomains(args.allowed_domains);
    const blocked = normalizeDomains(args.blocked_domains);
    const mode = typeof args.mode === 'string' ? args.mode.trim().toLowerCase() : 'answer';

    try {
      const results = rankSearchResults(query, await runWebSearchProvider(provider, query, maxResults * 2, apiKey, ctx?.signal), {
        allowed,
        blocked,
        preferDownloads: mode === 'find_downloads',
      })
        .slice(0, maxResults);
      const fetched = await Promise.all(results.slice(0, fetchTop).map(result => fetchSourceExcerpt(result, goal, ctx?.signal)));

      const downloadHints = mode === 'find_downloads'
        ? inferDownloadHints(results, fetched)
        : [];
      return [
        `Web research goal: ${goal}`,
        `Query: ${query}`,
        `Provider: ${provider}`,
        `Results: ${results.length}`,
        '',
        '## Sources',
        results.map((r, i) => `${i + 1}. [${r.title || r.domain}](${r.url}) — ${r.domain}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n'),
        fetched.length ? '\n## Extracted source notes\n' + fetched.join('\n\n') : '',
        downloadHints.length ? '\n## Download candidates\n' + downloadHints.join('\n') + '\n\nUse download_file with the selected direct URL if the user wants it saved.' : '',
      ].filter(Boolean).join('\n');
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        if (ctx?.signal?.aborted) return 'Error: cancelled by user.';
        return 'Error: timeout during web research.';
      }
      return `Error researching web: ${e?.message ?? e}`;
    }
  },
});

async function fetchSourceExcerpt(result: SearchResult, goal: string, signal?: AbortSignal): Promise<string> {
  try {
    const fetched = await fetchBytesWithCap(fetchWithSafeRedirects, result.url, {
      signal,
      timeoutMs: 20_000,
      maxBytes: 2 * 1024 * 1024,
    });
    const raw = decodeUtf8(fetched.bytes);
    const parsed = fetched.contentType.toLowerCase().includes('html')
      ? extractWebMarkdown(raw, fetched.finalUrl)
      : { title: result.title, description: '', markdown: raw, links: [] };
    const excerpt = summarizeMarkdown(parsed.markdown, 'extract', goal, 4_000);
    return [
      `### ${parsed.title || result.title || result.domain}`,
      `URL: ${fetched.finalUrl}`,
      parsed.description ? `Description: ${parsed.description}` : '',
      excerpt,
    ].filter(Boolean).join('\n');
  } catch (e: any) {
    return `### ${result.title || result.domain}\nURL: ${result.url}\nFetch failed: ${e?.message ?? e}`;
  }
}

function inferDownloadHints(results: SearchResult[], fetched: string[]): string[] {
  const urls = new Set<string>();
  for (const result of results) {
    if (/\.(pdf|zip|tar\.gz|tgz|dmg|pkg|exe|csv|json)(?:$|[?#])/i.test(result.url)) urls.add(result.url);
    const arxivPdf = inferArxivPdfUrl(result.url);
    if (arxivPdf) urls.add(arxivPdf);
  }
  for (const text of fetched) {
    for (const m of text.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)) {
      if (/\.(pdf|zip|tar\.gz|tgz|dmg|pkg|exe|csv|json)(?:$|[?#])/i.test(m[1])) urls.add(m[1]);
      const arxivPdf = inferArxivPdfUrl(m[1]);
      if (arxivPdf) urls.add(arxivPdf);
    }
  }
  return [...urls].slice(0, 10).map((url, i) => `${i + 1}. ${url}`);
}

function inferArxivPdfUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.hostname.replace(/^www\./, '') !== 'arxiv.org') return null;
    const m = u.pathname.match(/^\/abs\/([^/?#]+)/);
    if (!m) return null;
    return `https://arxiv.org/pdf/${m[1]}`;
  } catch {
    return null;
  }
}
