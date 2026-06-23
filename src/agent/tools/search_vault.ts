import { prepareSimpleSearch } from 'obsidian';
import { buildTool, type ToolImpl } from './_shared';

export const searchVault: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'fuzzy full-text search across notes',
  describe: a => `search "${a.query}"`,
  spec: {
    name: 'search_vault',
    description: 'Full-text search across markdown notes. Returns top matches with surrounding context. On large vaults the scan is bounded by `max_files` (default 1500, sorted by mtime — recent first) so it stays fast.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'number', description: 'Default 10.' },
        max_files: { type: 'number', description: 'Cap files scanned. Default 1500 (most recently modified first).' },
      },
      required: ['query'],
    },
  },
  run: async (app, { query, max_results = 10, max_files = 1500 }) => {
    const scorer = prepareSimpleSearch(String(query));
    type Hit = { path: string; score: number; snippet: string };
    const scored: Hit[] = [];
    const WINDOW = 8192;
    const STEP   = 6000;
    // Sort by mtime desc and cap. Most queries care about recent / active notes.
    const allFiles = app.vault.getMarkdownFiles().slice().sort((a, b) => b.stat.mtime - a.stat.mtime);
    const files = allFiles.slice(0, Math.max(1, Math.min(max_files, 10_000)));
    let scanned = 0;
    let yieldCounter = 0;
    for (const f of files) {
      scanned++;
      // Cheap basename match first — if it scores AND we already have plenty of
      // hits, skip the expensive cachedRead.
      const nameMatch = scorer(f.basename);
      let bestScore = nameMatch ? nameMatch.score : -Infinity;
      let bestSnippet = `${f.basename}`;
      const text = await app.vault.cachedRead(f);
      for (let off = 0; off < text.length; off += STEP) {
        const sample = text.slice(off, off + WINDOW);
        const m = scorer(sample);
        if (m && m.score > bestScore) {
          bestScore = m.score;
          const firstHit = m.matches?.[0]?.[0] ?? 0;
          const absStart = off + Math.max(0, firstHit - 60);
          const absEnd = off + firstHit + 160;
          bestSnippet = `…${text.slice(absStart, absEnd).replace(/\s+/g, ' ')}…`;
        }
        if (off + WINDOW >= text.length) break;
      }
      if (bestScore > -Infinity) scored.push({ path: f.path, score: bestScore, snippet: bestSnippet });
      // Yield to the event loop every 32 files so the UI doesn't freeze on big vaults.
      if (++yieldCounter % 32 === 0) await new Promise(r => window.setTimeout(r, 0));
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, max_results);
    const tail = allFiles.length > files.length ? ` (capped to ${files.length}/${allFiles.length} most-recent)` : '';
    if (top.length === 0) return `No matches for "${query}" across ${scanned} notes${tail}.`;
    return top.map(h => `[${h.path}]  ${h.snippet}`).join('\n\n') + `\n\n(scanned ${scanned} notes${tail})`;
  },
});
