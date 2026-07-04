/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import { buildTool, type ToolImpl } from './_shared';

export const semanticSearch: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'embedding RAG retrieval over vault chunks',
  describe: a => `semantic search "${a.query}"`,
  spec: {
    name: 'semantic_search',
    description: 'Embedding-based semantic search over the entire vault. Returns top-k chunks with cosine-similarity scores. Use this when keyword search would miss relevant phrasing. Requires the embedding index to be built (Settings → Rebuild index).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        top_k: { type: 'number', description: 'Default 8' },
      },
      required: ['query'],
    },
  },
  run: async (app, { query, top_k = 8 }, ctx) => {
    if (ctx?.signal?.aborted) return 'Error: cancelled before start.';
    // Look up by current id first, fall back to legacy id so the tool still
     // works during the rename transition (or if the user has both installed).
    const plugin = (app as any).plugins?.plugins?.['glossa']
               ?? (app as any).plugins?.plugins?.['note-codex']
               ?? (app as any).plugins?.getPlugin?.('glossa')
               ?? (app as any).plugins?.getPlugin?.('note-codex');
    if (!plugin?.embeddingIndex) return 'Error: embedding index not initialized.';
    if (plugin.embeddingIndex.size() === 0) return 'Error: embedding index empty. Run "Rebuild embedding index" from settings first.';
    try {
      const hits = await plugin.embeddingIndex.search(query, top_k);
      if (hits.length === 0) return 'No relevant chunks found.';
      return hits.map((h: any) => `[score=${h.score.toFixed(3)}] ${h.path}#chunk${h.chunk}\n${h.text.slice(0, 400)}`).join('\n\n---\n\n');
    } catch (e: any) { return `Error: ${e.message}`; }
  },
});
