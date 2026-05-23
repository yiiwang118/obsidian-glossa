/**
 * get_backlinks — list every note that links INTO the given path.
 *
 * Uses Obsidian's `metadataCache.resolvedLinks` reverse index. Each entry
 * looks like { sourcePath: { linkedPath: count } } — so backlinks are found
 * by scanning all sources whose linkedPath includes our path.
 *
 * Optionally returns a snippet of context around each backlink so the model
 * can tell why the source note is linking.
 */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

/** Minimal HTML escape for safe injection of model-derived text into innerHTML.
 *  Keeps the renderToolResultMessage path tight without pulling in DOMPurify. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const getBacklinks: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'list notes linking to this note',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `backlinks of ${a.path}`,
  // Render: a sources-table (with-context: source/line/snippet rows) when the
  // model used with_context, otherwise a tighter "X × N" list.
  renderToolResultMessage(result, args) {
    if (result.startsWith('No backlinks') || result.startsWith('Error')) return null;
    const wrap = document.createElement('div');
    wrap.style.padding = '6px 10px';
    wrap.style.fontSize = '12px';
    wrap.style.lineHeight = '1.5';
    const header = document.createElement('div');
    header.style.fontWeight = '600';
    header.style.marginBottom = '6px';
    header.textContent = `↩  Backlinks of ${args?.path ?? ''}`;
    wrap.appendChild(header);

    if (args?.with_context) {
      // Result contains H3 blocks per source + indented L<N>: snippet lines.
      // We render each source as a card.
      const sections: { source: string; rows: { line: string; text: string }[] }[] = [];
      let cur: typeof sections[number] | null = null;
      for (const line of result.split('\n')) {
        const h = line.match(/^###\s+(.+?)(?:\s+\(×(\d+)\))?$/);
        if (h) {
          if (cur) sections.push(cur);
          cur = { source: h[1], rows: [] };
          continue;
        }
        const r = line.match(/^\s+L(\d+):\s*(.*)$/);
        if (r && cur) cur.rows.push({ line: r[1], text: r[2] });
      }
      if (cur) sections.push(cur);
      for (const sec of sections) {
        const card = document.createElement('div');
        card.style.padding = '4px 0';
        card.style.marginBottom = '6px';
        card.style.borderLeft = '2px solid #5b9bff';
        card.style.paddingLeft = '8px';
        const srcEl = document.createElement('div');
        srcEl.style.fontFamily = 'var(--font-monospace, monospace)';
        srcEl.style.fontSize = '11px';
        srcEl.style.opacity = '0.85';
        srcEl.textContent = sec.source;
        card.appendChild(srcEl);
        for (const r of sec.rows) {
          const row = document.createElement('div');
          row.style.fontSize = '11px';
          row.style.opacity = '0.7';
          row.style.marginTop = '2px';
          row.innerHTML = `<span style="color:#888">L${r.line}</span>  ${escapeHtml(r.text.slice(0, 200))}`;
          card.appendChild(row);
        }
        wrap.appendChild(card);
      }
    } else {
      // Compact list: "- foo.md  (×3)" per line.
      for (const line of result.split('\n')) {
        const m = line.match(/^-\s+(.+?)\s+\(×(\d+)\)\s*$/);
        if (!m) continue;
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.padding = '2px 0';
        const src = document.createElement('span');
        src.style.fontFamily = 'var(--font-monospace, monospace)';
        src.style.fontSize = '11px';
        src.textContent = m[1];
        const badge = document.createElement('span');
        badge.textContent = `×${m[2]}`;
        badge.style.fontSize = '10px';
        badge.style.padding = '1px 6px';
        badge.style.borderRadius = '8px';
        badge.style.background = 'rgba(91, 155, 255, 0.15)';
        badge.style.color = '#5b9bff';
        row.appendChild(src);
        row.appendChild(badge);
        wrap.appendChild(row);
      }
    }
    return wrap;
  },
  spec: {
    name: 'get_backlinks',
    description: 'List notes containing wikilinks that resolve to the given path. Optionally include a context snippet around each link.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative target path.' },
        with_context: { type: 'boolean', description: 'When true, also fetch a 1-line snippet around each backlink. Default false (faster).' },
        max_results: { type: 'number', description: 'Cap on returned backlinks. Default 50.' },
      },
      required: ['path'],
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    const max = Math.max(1, Math.min(500, args.max_results ?? 50));
    const withContext = !!args.with_context;
    const resolved = app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
    const sources: { source: string; count: number }[] = [];
    for (const src of Object.keys(resolved)) {
      const counts = resolved[src];
      if (counts && counts[path]) sources.push({ source: src, count: counts[path] });
    }
    sources.sort((a, b) => b.count - a.count);
    const top = sources.slice(0, max);
    if (top.length === 0) return `No backlinks to ${path}.`;
    if (!withContext) {
      return [`${top.length}${sources.length > top.length ? `+ (showing first ${max})` : ''} backlinks to ${path}:`, ...top.map(s => `- ${s.source}  (×${s.count})`)].join('\n');
    }
    // Fetch context snippets — one line containing the link, per source.
    const targetBasename = path.split('/').pop()!.replace(/\.md$/, '');
    const linkPattern = new RegExp(`\\[\\[[^\\]]*${targetBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\]]*\\]\\]`);
    const lines: string[] = [`${top.length} backlinks to ${path} (with context):`, ''];
    for (const s of top) {
      lines.push(`### ${s.source}  (×${s.count})`);
      const f = app.vault.getAbstractFileByPath(s.source);
      if (!(f instanceof TFile)) { lines.push('  (source unavailable)'); continue; }
      const text = await app.vault.cachedRead(f);
      const fileLines = text.split('\n');
      let shown = 0;
      for (let i = 0; i < fileLines.length && shown < 3; i++) {
        if (linkPattern.test(fileLines[i])) {
          lines.push(`  L${i + 1}: ${fileLines[i].trim().slice(0, 200)}`);
          shown++;
        }
      }
      if (shown === 0) lines.push('  (link found in cache but no text-line match — likely a heading-only link)');
      lines.push('');
    }
    return lines.join('\n');
  },
});
