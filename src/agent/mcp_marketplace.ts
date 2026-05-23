/**
 * Curated MCP server marketplace.
 * A small bundled catalog of well-known MCP servers so users can install with one click.
 * Source: official @modelcontextprotocol/servers (npm) + community servers tracked on
 * https://github.com/modelcontextprotocol/servers and https://github.com/punkpeye/awesome-mcp-servers
 *
 * No network fetch is involved at load time — the catalog is shipped with the plugin.
 * A user can also paste a JSON URL in the marketplace modal to import their own catalog.
 */

export interface McpEntry {
  id: string;                              // stable kebab-case id
  name: string;                            // human-readable
  category: 'official' | 'data' | 'web' | 'tooling' | 'fun';
  description: string;
  install: { command: string; args: string[] };  // e.g. npx -y @modelcontextprotocol/server-filesystem /path
  envHints?: { name: string; description: string }[];  // user-supplied secrets
  argHints?: { index: number; placeholder: string; description: string }[];  // user-supplied positional args
  homepage: string;
}

export const MCP_CATALOG: McpEntry[] = [
  {
    id: 'filesystem', name: 'Filesystem',
    category: 'official',
    description: 'Read/write files under a sandboxed root directory.',
    install: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '<ROOT_DIR>'] },
    argHints: [{ index: 3, placeholder: '/path/to/root', description: 'Sandboxed root folder the model may read/write within.' }],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'git', name: 'Git',
    category: 'official',
    description: 'git status / diff / log / show / blame for a repo.',
    install: { command: 'uvx', args: ['mcp-server-git', '--repository', '<REPO_PATH>'] },
    argHints: [{ index: 3, placeholder: '/path/to/repo', description: 'Local git repo path.' }],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'github', name: 'GitHub',
    category: 'data',
    description: 'Read/write issues, PRs, files via the official GitHub API.',
    install: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    envHints: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', description: 'Personal access token with repo scope.' }],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'fetch', name: 'Fetch',
    category: 'web',
    description: 'Fetch any URL and convert HTML → readable markdown.',
    install: { command: 'uvx', args: ['mcp-server-fetch'] },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'brave-search', name: 'Brave Search',
    category: 'web',
    description: 'Web + local search via Brave Search API (2k free queries / month).',
    install: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'] },
    envHints: [{ name: 'BRAVE_API_KEY', description: 'Brave Search API key.' }],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'sqlite', name: 'SQLite',
    category: 'data',
    description: 'Query / mutate / inspect schema of a local SQLite database.',
    install: { command: 'uvx', args: ['mcp-server-sqlite', '--db-path', '<DB_PATH>'] },
    argHints: [{ index: 3, placeholder: '/path/to/db.sqlite', description: 'SQLite database file path.' }],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'postgres', name: 'Postgres',
    category: 'data',
    description: 'Read-only Postgres queries via a connection string.',
    install: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', '<CONN_STR>'] },
    argHints: [{ index: 3, placeholder: 'postgresql://user:pass@host/db', description: 'Postgres connection string.' }],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'memory', name: 'Memory',
    category: 'official',
    description: 'Persistent knowledge graph the model can query and grow.',
    install: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'puppeteer', name: 'Puppeteer (browser)',
    category: 'web',
    description: 'Headless Chrome — navigate, screenshot, evaluate JS, scrape.',
    install: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    id: 'time', name: 'Time',
    category: 'tooling',
    description: 'Timezone conversions + current time in any locale.',
    install: { command: 'uvx', args: ['mcp-server-time'] },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
  },
  {
    id: 'everart', name: 'EverArt',
    category: 'fun',
    description: 'Generate images via EverArt — multiple models, async.',
    install: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everart'] },
    envHints: [{ name: 'EVERART_API_KEY', description: 'EverArt API key.' }],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everart',
  },
  {
    id: 'slack', name: 'Slack',
    category: 'data',
    description: 'Read channels + post messages via the Slack Bot token.',
    install: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] },
    envHints: [
      { name: 'SLACK_BOT_TOKEN', description: 'Slack bot token (xoxb-...).' },
      { name: 'SLACK_TEAM_ID',  description: 'Your Slack team ID.' },
    ],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
];

export const MCP_CATEGORIES: { id: McpEntry['category']; label: string }[] = [
  { id: 'official', label: 'Official' },
  { id: 'data',     label: 'Data' },
  { id: 'web',      label: 'Web' },
  { id: 'tooling',  label: 'Tooling' },
  { id: 'fun',      label: 'Fun' },
];

/** Validate an arbitrary JSON value as an McpEntry[]. Filters out malformed rows.
 *  Defensive — community catalogs may have field drift. */
export function parseCatalogJson(raw: unknown): McpEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: McpEntry[] = [];
  const validCats = new Set(MCP_CATEGORIES.map(c => c.id));
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, any>;
    if (typeof e.id !== 'string' || typeof e.name !== 'string') continue;
    if (typeof e.description !== 'string') continue;
    if (!e.install || typeof e.install.command !== 'string' || !Array.isArray(e.install.args)) continue;
    const args = e.install.args.filter((a: any) => typeof a === 'string');
    out.push({
      id: e.id,
      name: e.name,
      category: validCats.has(e.category) ? e.category : 'tooling',
      description: e.description,
      install: { command: e.install.command, args },
      envHints: Array.isArray(e.envHints) ? e.envHints.filter((h: any) => h && typeof h.name === 'string') : undefined,
      argHints: Array.isArray(e.argHints) ? e.argHints.filter((h: any) => h && typeof h.index === 'number') : undefined,
      homepage: typeof e.homepage === 'string' ? e.homepage : '',
    });
  }
  return out;
}

/** Fetch a catalog URL with a hard 8s timeout. Uses Obsidian's requestUrl when available
 *  (proxy-aware, CORS-free) and falls back to fetch otherwise. */
export async function fetchCatalog(url: string): Promise<McpEntry[]> {
  // HTTPS-only: catalog payload drives shell command suggestions, so we don't
  // want an attacker on the local network MITMing plain-HTTP catalogs.
  let catalogUrl: URL;
  try { catalogUrl = new URL(url); }
  catch { throw new Error('Catalog URL is malformed.'); }
  if (catalogUrl.protocol !== 'https:') {
    throw new Error('Catalog URLs must be https:// (refusing ' + catalogUrl.protocol + ').');
  }
  // Lazy import obsidian's requestUrl to avoid hard dep in this module
  let text: string;
  // obsidian.requestUrl does NOT honor AbortController — `signal` is silently
  // ignored. We get timeout behavior via Promise.race instead.
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
  try {
    const obs = await import('obsidian');
    const r = await withTimeout(obs.requestUrl({ url, method: 'GET', throw: false }), 8000);
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    text = r.text;
  } catch (eRequest) {
    // Fallback: plain fetch (likely fails on CORS for cross-origin, but works
    // for raw.githubusercontent.com / gist.github.com). fetch DOES honor
    // AbortController so the timer pattern actually works here.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      text = await r.text();
    } finally { clearTimeout(t); }
  }
  let json: unknown;
  try { json = JSON.parse(text); }
  catch (e: any) { throw new Error(`Invalid JSON: ${e.message}`); }
  const parsed = parseCatalogJson(json);
  if (parsed.length === 0) throw new Error('Catalog has no valid entries (expected array of McpEntry).');
  return parsed;
}
