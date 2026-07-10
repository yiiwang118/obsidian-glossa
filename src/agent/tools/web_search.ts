/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { requestUrl } from 'obsidian';
import { buildTool, type ToolImpl } from './_shared';
import { fetchWithSafeRedirects } from '../../utils/safe_web';
import type { WebSearchProvider } from '../../types';
import { clampNumber, normalizeDomains, normalizeSearchProvider, readWebSettings, webReadPermission } from './web_common';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  source: string;
  score?: number;
  rank_reason?: string;
  identity_score?: number;
}

export const webSearch: ToolImpl = buildTool({
  dangerous: true,
  isReadOnly: () => true,
  isDestructive: () => false,
  isConcurrencySafe: () => true,
  shouldDefer: true,
  checkPermissions: async (app) => webReadPermission(app, 'Web search requires approval.'),
  searchHint: 'search public web current sources',
  searchTags: ['raw search results', 'source candidates', '网页搜索', '查找来源'],
  describe: a => `search web "${String(a.query ?? '').slice(0, 80)}"`,
  preview: async (a) => {
    const provider = typeof a.provider === 'string' && a.provider.trim() ? a.provider.trim() : 'settings default';
    const allowed = Array.isArray(a.allowed_domains) ? a.allowed_domains.join(', ') : '';
    const blocked = Array.isArray(a.blocked_domains) ? a.blocked_domains.join(', ') : '';
    return [
      `Search web: ${String(a.query ?? '').trim()}`,
      `Provider: ${provider}`,
      allowed ? `Allowed domains: ${allowed}` : '',
      blocked ? `Blocked domains: ${blocked}` : '',
      'No files will be written.',
    ].filter(Boolean).join('\n');
  },
  spec: {
    name: 'web_search',
    description: 'Return a raw ranked list of public web source candidates without fetching page content. Prefer web_research for normal research; use this only when you need to inspect or choose search results yourself. Network access requires approval.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, description: 'Focused public web search query.' },
        allowed_domains: { type: 'array', items: { type: 'string' }, description: 'Optional domains to include, e.g. ["github.com"].' },
        blocked_domains: { type: 'array', items: { type: 'string' }, description: 'Optional domains to exclude.' },
        max_results: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum results to return. Default 8.' },
        provider: { type: 'string', enum: ['auto', 'duckduckgo', 'brave', 'tavily', 'exa', 'serpapi'], description: 'Optional provider override. Defaults to plugin settings.' },
        api_key: { type: 'string', description: 'Optional provider API key override for this call. Prefer settings.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  run: async (_app, args, ctx) => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (query.length < 2) return 'Error: query must be at least 2 characters.';
    const maxResults = clampNumber(args.max_results, 1, 20, 8);
    const allowed = normalizeDomains(args.allowed_domains);
    const blocked = normalizeDomains(args.blocked_domains);
    if (allowed.length && blocked.length) return 'Error: use allowed_domains or blocked_domains, not both.';

    try {
      const settings = readWebSettings(_app);
      const provider = normalizeSearchProvider(args.provider ?? settings.webSearchProvider);
      const apiKey = typeof args.api_key === 'string' && args.api_key.trim()
        ? args.api_key.trim()
        : settings.webSearchApiKey;
      const results = rankSearchResults(query, await runWebSearchProvider(provider, query, maxResults * 2, apiKey, ctx?.signal), { allowed, blocked })
        .slice(0, maxResults);
      const header = [
        `Web search: "${query}"`,
        `Provider: ${provider}`,
        `Results: ${results.length}`,
        allowed.length ? `Allowed domains: ${allowed.join(', ')}` : '',
        blocked.length ? `Blocked domains: ${blocked.join(', ')}` : '',
      ].filter(Boolean).join('\n');
      if (!results.length) {
        return `${header}\n\nNo structured results returned. Try a more specific query or change the search provider.`;
      }
      return `${header}\n\n${results.map((r, i) => [
        `## ${i + 1}. ${r.title || r.domain}`,
        `URL: ${r.url}`,
        `Domain: ${r.domain}`,
        `Source: ${r.source}`,
        typeof r.score === 'number' ? `Score: ${r.score}${r.rank_reason ? ` (${r.rank_reason})` : ''}` : '',
        r.snippet ? `Snippet: ${r.snippet}` : '',
      ].filter(Boolean).join('\n')).join('\n\n')}`;
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (ctx?.signal?.aborted) return 'Error: cancelled by user.';
        return 'Error: timeout after 20s';
      }
      return `Error searching web: ${e?.message ?? e}`;
    }
  },
});

export async function runWebSearchProvider(provider: WebSearchProvider, query: string, maxResults: number, apiKey: string, signal?: AbortSignal): Promise<SearchResult[]> {
  if (provider !== 'auto' && provider !== 'duckduckgo' && !apiKey) {
    throw new Error(`${provider} search requires an API key in Settings → Advanced → Web research.`);
  }
  if (provider === 'auto') return autoSearch(query, maxResults, signal);
  if (provider === 'brave') return braveSearch(query, maxResults, apiKey, signal);
  if (provider === 'tavily') return tavilySearch(query, maxResults, apiKey, signal);
  if (provider === 'exa') return exaSearch(query, maxResults, apiKey, signal);
  if (provider === 'serpapi') return serpApiSearch(query, maxResults, apiKey, signal);
  try {
    const results = await duckDuckGoSearch(query, signal);
    if (results.length || !looksAcademicQuery(query)) return results;
    return academicFallbackSearch(query, maxResults, signal);
  } catch (e) {
    const fallback = looksAcademicQuery(query) ? await academicFallbackSearch(query, maxResults, signal) : [];
    if (fallback.length) return fallback;
    throw e;
  }
}

async function autoSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const tasks: Array<Promise<SearchResult[]>> = [];
  const academic = looksAcademicQuery(query);
  if (academic) tasks.push(academicFallbackSearch(query, maxResults, signal));
  if (looksGithubQuery(query)) tasks.push(githubFallbackSearch(query, maxResults, signal));
  const docs = docsFallbackSearch(query);
  if (docs.length) tasks.push(Promise.resolve(docs));
  // A vertical index can miss author-hosted PDFs and niche project pages.
  // Academic fallback already includes one exact-title SERP pass; avoid issuing
  // duplicate DuckDuckGo requests that can trigger throttling.
  if (!academic) tasks.push(duckDuckGoSearch(query, signal).catch(() => []));

  const settled = await Promise.allSettled(tasks);
  const merged = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  return rankSearchResults(query, merged, { preferDownloads: looksDownloadQuery(query) }).slice(0, maxResults);
}

export function rankSearchResults(
  query: string,
  results: SearchResult[],
  opts: { allowed?: string[]; blocked?: string[]; preferDownloads?: boolean } = {},
): SearchResult[] {
  const allowed = opts.allowed ?? [];
  const blocked = opts.blocked ?? [];
  const terms = tokenize(query);
  const seen = new Set<string>();
  const ranked: SearchResult[] = [];
  for (const result of results) {
    if (!domainAllowed(result.domain, allowed, blocked)) continue;
    const key = normalizedUrlKey(result.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const { score, reason } = scoreResult(result, terms, opts.preferDownloads === true);
    ranked.push({ ...result, score, rank_reason: reason });
  }
  return ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.domain.localeCompare(b.domain));
}

async function duckDuckGoSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const htmlResults = await duckDuckGoHtmlSearch(query, signal).catch(() => []);
  if (htmlResults.length) return htmlResults;
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const json = await fetchJson(url, { method: 'GET' }, signal, true, 8_000);
  return parseDuckDuckGoResults(json);
}

async function academicFallbackSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const academicQuery = cleanAcademicQuery(query);
  const [openAlex, arxiv, duckDuckGo, yahoo] = await Promise.all([
    openAlexSearch(academicQuery, maxResults, signal).catch(() => []),
    arxivSearch(academicQuery, maxResults, signal).catch(() => []),
    duckDuckGoHtmlSearch(`"${academicQuery}" filetype:pdf`, signal).catch(() => []),
    yahooHtmlSearch(`"${academicQuery}" filetype:pdf`, signal).catch(() => []),
  ]);
  return rankSearchResults(academicQuery, [...openAlex, ...arxiv, ...duckDuckGo, ...yahoo], { preferDownloads: true }).slice(0, maxResults);
}

async function openAlexSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${Math.min(maxResults, 10)}`;
  const json = await fetchJson(url, { method: 'GET' }, signal, false, 10_000);
  const rows = Array.isArray(json?.results) ? json.results : [];
  const out: SearchResult[] = [];
  for (const row of rows) {
    const title = cleanText(String(row?.title ?? ''));
    if (!title) continue;
    const candidates = openAlexLocationCandidates(row);
    const snippet = [
      row?.publication_year ? String(row.publication_year) : '',
      row?.doi ? `DOI ${String(row.doi).replace(/^https?:\/\/doi\.org\//, '')}` : '',
      row?.open_access?.is_oa ? 'open access' : '',
    ].filter(Boolean).join(' · ');
    for (const candidate of candidates.slice(0, 5)) {
      const result = makeResult(title, candidate.url, [snippet, candidate.label].filter(Boolean).join(' · '), candidate.source);
      if (result) out.push(result);
    }
  }
  return out;
}

export async function findDownloadCandidates(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const cleaned = cleanAcademicQuery(query);
  const merged = looksAcademicQuery(query)
    ? await academicFallbackSearch(query, maxResults * 2, signal).catch(() => [])
    : await autoSearch(query, maxResults * 2, signal).catch(() => []);
  const ranked = rankSearchResults(cleaned, merged, { preferDownloads: true });
  const titleTerms = normalizedTitleTerms(cleaned);
  if (looksAcademicQuery(query) && titleTerms.length >= 4 && !/10\.\d{4,9}\//.test(query)) {
    return ranked
      .map(result => ({ ...result, identity_score: titleIdentityScore(cleaned, result.title) }))
      .filter(result => (result.identity_score ?? 0) >= 0.72)
      .sort((a, b) => (b.identity_score ?? 0) - (a.identity_score ?? 0) || (b.score ?? 0) - (a.score ?? 0))
      .slice(0, maxResults);
  }
  return ranked.slice(0, maxResults);
}

export function titleIdentityScore(query: string, title: string): number {
  const queryTerms = normalizedTitleTerms(query);
  const titleTerms = normalizedTitleTerms(title);
  if (!queryTerms.length || !titleTerms.length) return 0;
  const titleSet = new Set(titleTerms);
  const overlap = queryTerms.filter(term => titleSet.has(term)).length;
  const coverage = overlap / queryTerms.length;
  const precision = overlap / titleTerms.length;
  return Math.round((coverage * 0.8 + precision * 0.2) * 1000) / 1000;
}

export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const blocks = html.match(/<div\b[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>[\s\S]*?<div\b[^>]*class="clear"[^>]*><\/div>[\s\S]*?<\/div>/gi) ?? [];
  const out: SearchResult[] = [];
  for (const block of blocks) {
    const anchor = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = unwrapDuckDuckGoUrl(decodeHtmlAttribute(anchor[1]));
    const title = cleanText(decodeXml(stripHtml(anchor[2])));
    const snippetMatch = /<a\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const snippet = snippetMatch ? cleanText(decodeXml(stripHtml(snippetMatch[1]))) : '';
    const result = makeResult(title, url, snippet, 'duckduckgo-html');
    if (result) out.push(result);
  }
  return out;
}

async function duckDuckGoHtmlSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, {
    method: 'GET',
    headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' },
  }, signal, 12_000);
  return parseDuckDuckGoHtml(html);
}

export function parseYahooHtml(html: string): SearchResult[] {
  const anchors = html.matchAll(/<a\b[^>]*href="([^"]*r\.search\.yahoo\.com\/[^"]*\/RU=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
  const out: SearchResult[] = [];
  for (const anchor of anchors) {
    const heading = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(anchor[2]);
    if (!heading) continue;
    const url = unwrapYahooUrl(decodeHtmlAttribute(anchor[1]));
    const title = cleanText(decodeXml(stripHtml(heading[1])));
    const result = makeResult(title, url, '', 'yahoo-html');
    if (result) out.push(result);
  }
  return out;
}

async function yahooHtmlSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
  const html = await fetchText(url, {
    method: 'GET',
    headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' },
  }, signal, 12_000);
  return parseYahooHtml(html);
}

async function arxivSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const cleaned = query.replace(/[^\p{L}\p{N}\s:.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(cleaned)}&start=0&max_results=${Math.min(maxResults, 10)}`;
  const xml = await fetchText(url, { method: 'GET' }, signal, 10_000);
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  const out: SearchResult[] = [];
  for (const entry of entries) {
    const title = cleanText(decodeXml(firstXml(entry, 'title')));
    const summary = cleanText(decodeXml(firstXml(entry, 'summary'))).slice(0, 240);
    const pdf = entry.match(/<link\b[^>]*href="([^"]+)"[^>]*type="application\/pdf"[^>]*\/>/i)?.[1] ?? '';
    const id = firstXml(entry, 'id').replace(/^http:/, 'https:');
    const result = makeResult(title, pdf || id, summary, 'arxiv');
    if (result) out.push(result);
  }
  return out;
}

async function githubFallbackSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const q = cleanGithubQuery(query);
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${Math.min(maxResults, 10)}`;
  const json = await fetchJson(url, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
  }, signal, false, 10_000);
  const rows = Array.isArray(json?.items) ? json.items : [];
  const out: SearchResult[] = [];
  for (const repo of rows) {
    const full = cleanText(String(repo?.full_name ?? ''));
    const html = stringOrEmpty(repo?.html_url);
    if (!full || !html) continue;
    const releaseUrl = `${html}/releases/latest`;
    const title = looksReleaseQuery(query) ? `${full} latest release` : full;
    const url = looksReleaseQuery(query) ? releaseUrl : html;
    const result = makeResult(
      title,
      url,
      [
        repo?.description ? cleanText(String(repo.description)).slice(0, 180) : '',
        typeof repo?.stargazers_count === 'number' ? `${repo.stargazers_count.toLocaleString()} stars` : '',
        repo?.language ? String(repo.language) : '',
      ].filter(Boolean).join(' · '),
      'github',
    );
    if (result) out.push(result);
  }
  return out;
}

async function braveSearch(query: string, maxResults: number, apiKey: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const json = await fetchJson(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
  }, signal);
  return (json?.web?.results ?? []).map((r: AnyValue) => makeResult(r?.title, r?.url, r?.description, 'brave')).filter(Boolean);
}

async function tavilySearch(query: string, maxResults: number, apiKey: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const json = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: 'basic', include_answer: false }),
  }, signal);
  return (json?.results ?? []).map((r: AnyValue) => makeResult(r?.title, r?.url, r?.content, 'tavily')).filter(Boolean);
}

async function exaSearch(query: string, maxResults: number, apiKey: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const json = await fetchJson('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query, numResults: maxResults, type: 'auto' }),
  }, signal);
  return (json?.results ?? []).map((r: AnyValue) => makeResult(r?.title, r?.url, r?.text ?? r?.snippet, 'exa')).filter(Boolean);
}

async function serpApiSearch(query: string, maxResults: number, apiKey: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}&num=${maxResults}`;
  const json = await fetchJson(url, { method: 'GET' }, signal);
  return (json?.organic_results ?? []).map((r: AnyValue) => makeResult(r?.title, r?.link, r?.snippet, 'serpapi')).filter(Boolean);
}

async function fetchJson(url: string, init: RequestInit, parentSignal?: AbortSignal, safeGet = false, timeoutMs = 20_000): Promise<AnyValue> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => { try { ctl.abort(); } catch { /* noop */ } };
  if (parentSignal) {
    if (parentSignal.aborted) ctl.abort();
    else parentSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    if (safeGet) {
      const response = await fetchWithSafeRedirects(url, ctl.signal);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.json();
    }
    const response = await requestUrlWithTimeout(url, init, ctl.signal, timeoutMs);
    if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
    return response.json ?? JSON.parse(response.text || 'null');
  } finally {
    window.clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', onAbort);
  }
}

async function fetchText(url: string, init: RequestInit, parentSignal?: AbortSignal, timeoutMs = 20_000): Promise<string> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => { try { ctl.abort(); } catch { /* noop */ } };
  if (parentSignal) {
    if (parentSignal.aborted) ctl.abort();
    else parentSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const response = await requestUrlWithTimeout(url, init, ctl.signal, timeoutMs);
    if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
    return response.text;
  } finally {
    window.clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', onAbort);
  }
}

async function requestUrlWithTimeout(url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number) {
  if (signal.aborted) throw new Error('Request aborted.');
  let timer: number | null = null;
  try {
    return await Promise.race([
      requestUrl({
        url,
        method: init.method ?? 'GET',
        headers: headersToRecord(init.headers),
        body: requestBodyToString(init.body),
        throw: false,
      }),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms.`)), timeoutMs);
        signal.addEventListener('abort', () => reject(new Error('Request aborted.')), { once: true });
      }),
    ]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => { out[key] = value; });
    return out;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}

function requestBodyToString(body: BodyInit | null | undefined): string | ArrayBuffer | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string' || body instanceof ArrayBuffer) return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error('Unsupported request body type.');
}

function parseDuckDuckGoResults(json: AnyValue): SearchResult[] {
  const out: SearchResult[] = [];
  const add = (title: unknown, url: unknown, snippet: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    let domain = '';
    try { domain = new URL(url).hostname.replace(/^www\./, ''); }
    catch { return; }
    const result = {
      title: cleanText(typeof title === 'string' ? title : domain),
      url,
      snippet: cleanText(typeof snippet === 'string' ? snippet : ''),
      domain,
      source: 'duckduckgo',
    };
    if (!out.some(x => x.url === result.url)) out.push(result);
  };

  add(json?.Heading, json?.AbstractURL, json?.AbstractText);
  const related = Array.isArray(json?.RelatedTopics) ? json.RelatedTopics : [];
  for (const item of related) {
    if (Array.isArray(item?.Topics)) {
      for (const nested of item.Topics) add(nested?.Text, nested?.FirstURL, nested?.Text);
    } else {
      add(item?.Text, item?.FirstURL, item?.Text);
    }
  }
  const results = Array.isArray(json?.Results) ? json.Results : [];
  for (const item of results) add(item?.Text, item?.FirstURL, item?.Text);
  return out;
}

function makeResult(title: unknown, url: unknown, snippet: unknown, source: string): SearchResult | null {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    return {
      title: cleanText(typeof title === 'string' ? title : domain),
      url,
      snippet: cleanText(typeof snippet === 'string' ? snippet : ''),
      domain,
      source,
    };
  } catch {
    return null;
  }
}

function domainAllowed(domain: string, allowed: string[], blocked: string[]): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (allowed.length && !allowed.some(a => d === a || d.endsWith(`.${a}`))) return false;
  if (blocked.some(b => d === b || d.endsWith(`.${b}`))) return false;
  return true;
}

function scoreResult(result: SearchResult, terms: string[], preferDownloads: boolean): { score: number; reason: string } {
  const haystack = `${result.title} ${result.snippet} ${result.url} ${result.domain}`.toLowerCase();
  const titleText = result.title.toLowerCase();
  let score = 50;
  let exactHits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 8;
      exactHits++;
    }
  }
  const titleHits = terms.reduce((n, term) => n + (titleText.includes(term) ? 1 : 0), 0);
  if (terms.length >= 4 && titleHits >= Math.ceil(terms.length * 0.75)) score += 35;
  const path = safePath(result.url);
  const domain = result.domain.toLowerCase();
  const isDownload = /\.(pdf|zip|tar\.gz|tgz|dmg|pkg|exe|csv|json)(?:$|[?#])/i.test(result.url);
  if (isDownload) score += preferDownloads ? 28 : 10;
  if (/\b(download|release|asset|paper|pdf|github)\b/i.test(result.title + ' ' + result.snippet)) score += preferDownloads ? 12 : 4;
  if (domain.endsWith('.edu') || domain.endsWith('.gov')) score += 10;
  if (domain === 'github.com' || domain.endsWith('.github.io')) score += 9;
  if (domain === 'arxiv.org' || domain === 'openreview.net' || domain === 'doi.org') score += 9;
  if (domain === 'docs.github.com' || path.includes('/docs') || path.includes('/documentation')) score += 6;
  if (/(^|\.)medium\.com$|reddit\.com$|quora\.com$|pinterest\.com$/i.test(domain)) score -= 8;
  if (/[?&](utm_|fbclid|gclid)/i.test(result.url)) score -= 3;
  const reason = [
    exactHits ? `${exactHits} query hit${exactHits === 1 ? '' : 's'}` : '',
    isDownload ? 'direct asset' : '',
    domain.endsWith('.edu') || domain.endsWith('.gov') ? 'institutional' : '',
    domain === 'github.com' ? 'github' : '',
  ].filter(Boolean).join(', ');
  return { score, reason };
}

function tokenize(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(t => t.length >= 2))].slice(0, 12);
}

function normalizedTitleTerms(value: string): string[] {
  const stop = new Set(['a', 'an', 'and', 'for', 'from', 'in', 'into', 'of', 'on', 'the', 'to', 'with', 'pdf', 'paper', 'download']);
  return [...new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .map(term => term.trim())
    .filter(term => term.length >= 2 && !stop.has(term)))];
}

function normalizedUrlKey(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)$/i.test(key)) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    if (u.hostname === 'arxiv.org') {
      u.pathname = u.pathname.replace(/^(\/(?:abs|pdf)\/\d{4}\.\d{4,5})v\d+$/i, '$1');
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function safePath(raw: string): string {
  try { return new URL(raw).pathname.toLowerCase(); }
  catch { return ''; }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function openAlexLocationCandidates(row: AnyValue): Array<{ url: string; label: string; source: string }> {
  const out: Array<{ url: string; label: string; source: string }> = [];
  const seen = new Set<string>();
  const add = (value: unknown, label: string, source: string) => {
    const url = stringOrEmpty(value);
    if (!url) return;
    const key = normalizedUrlKey(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ url, label, source });
  };
  add(row?.best_oa_location?.pdf_url, 'best open-access PDF', 'openalex-pdf');
  add(row?.primary_location?.pdf_url, 'primary PDF', 'openalex-pdf');
  add(row?.open_access?.oa_url, 'open-access location', 'openalex-oa');
  const locations = Array.isArray(row?.locations) ? row.locations : [];
  for (const location of locations) {
    add(location?.pdf_url, `${String(location?.source?.display_name ?? 'repository')} PDF`, 'openalex-location');
  }
  for (const location of locations) {
    add(location?.landing_page_url, `${String(location?.source?.display_name ?? 'repository')} landing page`, 'openalex-location');
  }
  add(row?.primary_location?.landing_page_url, 'primary landing page', 'openalex');
  add(row?.doi, 'DOI landing page', 'openalex');
  return out;
}

function stringOrEmpty(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().replace(/>+$/, '');
  return /^https?:\/\//i.test(cleaned) ? cleaned : '';
}

function unwrapDuckDuckGoUrl(raw: string): string {
  try {
    const absolute = raw.startsWith('//') ? `https:${raw}` : raw;
    const parsed = new URL(absolute, 'https://html.duckduckgo.com/');
    if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname === '/l/') {
      return parsed.searchParams.get('uddg') ?? absolute;
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function unwrapYahooUrl(raw: string): string {
  const match = /\/RU=([^/]+)\/RK=/i.exec(raw);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function looksAcademicQuery(query: string): boolean {
  const q = query.toLowerCase();
  return /\b(arxiv|doi|paper|pdf|proceedings|conference|journal|abstract|research|learning|transformer|model|neural|memorize)\b/.test(q) ||
    /^[A-Z][A-Za-z0-9: -]{16,}$/.test(query.trim());
}

function looksGithubQuery(query: string): boolean {
  return /\b(github|repo|repository|release|releases|tag|asset|source code|npm package|obsidian plugin)\b/i.test(query);
}

function looksReleaseQuery(query: string): boolean {
  return /\b(release|releases|tag|asset|download|latest version)\b/i.test(query);
}

function looksDownloadQuery(query: string): boolean {
  return /\b(download|pdf|release|asset|installer|dataset|zip|tar\.gz|dmg|pkg|csv|json)\b/i.test(query);
}

function cleanAcademicQuery(query: string): string {
  return query
    .replace(/\b(find|locate|get|download|fetch|save|official|paper|pdf|url|link|source|for|the)\b/gi, ' ')
    .replace(/\barxiv\b/gi, ' ')
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || query.trim();
}

function cleanGithubQuery(query: string): string {
  return query
    .replace(/\b(find|locate|get|download|fetch|save|official|github|repo|repository|release|releases|latest|asset|url|link|source|for|the)\b/gi, ' ')
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || query.trim();
}

function docsFallbackSearch(query: string): SearchResult[] {
  const q = query.toLowerCase();
  const docs: Array<{ key: RegExp; title: string; url: string; snippet: string }> = [
    { key: /\b(openai|chatgpt|codex|gpt)\b/, title: 'OpenAI Developers documentation', url: 'https://developers.openai.com/', snippet: 'Official OpenAI API, Codex, and platform documentation.' },
    { key: /\b(anthropic|claude|claude code)\b/, title: 'Anthropic documentation', url: 'https://docs.anthropic.com/', snippet: 'Official Anthropic and Claude documentation.' },
    { key: /\b(obsidian|obsidian plugin)\b/, title: 'Obsidian developer documentation', url: 'https://docs.obsidian.md/', snippet: 'Official Obsidian plugin and app documentation.' },
    { key: /\b(github|github actions)\b/, title: 'GitHub Docs', url: 'https://docs.github.com/', snippet: 'Official GitHub documentation.' },
    { key: /\b(node|nodejs|npm)\b/, title: 'Node.js documentation', url: 'https://nodejs.org/api/', snippet: 'Official Node.js API documentation.' },
    { key: /\b(react|jsx)\b/, title: 'React documentation', url: 'https://react.dev/', snippet: 'Official React documentation.' },
    { key: /\b(vite)\b/, title: 'Vite documentation', url: 'https://vite.dev/guide/', snippet: 'Official Vite documentation.' },
    { key: /\b(typescript|tsc)\b/, title: 'TypeScript documentation', url: 'https://www.typescriptlang.org/docs/', snippet: 'Official TypeScript documentation.' },
    { key: /\b(arxiv)\b/, title: 'arXiv search', url: 'https://arxiv.org/search/', snippet: 'Official arXiv search and paper pages.' },
  ];
  return docs
    .filter(d => d.key.test(q))
    .map(d => makeResult(d.title, d.url, d.snippet, 'official-docs'))
    .filter((x): x is SearchResult => x != null);
}

function firstXml(entry: string, tag: string): string {
  return new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(entry)?.[1]?.trim() ?? '';
}

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- Re-enable review lint rules after dynamic boundary module. */
