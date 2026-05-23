/**
 * list_tags — enumerate every tag in the vault with usage counts.
 *
 * Helpful for the model when the user asks "what tags do I already use?"
 * before adding a new one — keeps the tag vocabulary from fragmenting.
 */
import { getAllTags } from 'obsidian';
import { buildTool, type ToolImpl } from './_shared';

export const listTags: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'enumerate all vault tags with counts',
  describe: () => 'list vault tags',
  spec: {
    name: 'list_tags',
    description: 'List every tag in the vault with its usage count (frontmatter + inline combined).',
    parameters: {
      type: 'object',
      properties: {
        min_count: { type: 'number', description: 'Hide tags with count below this. Default 1.' },
        max_results: { type: 'number', description: 'Default 500.' },
      },
    },
  },
  run: async (app, args) => {
    const minCount = Math.max(1, Number(args.min_count) || 1);
    const max = Math.max(1, Math.min(5000, Number(args.max_results) || 500));
    const counts = new Map<string, number>();
    for (const f of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(f);
      const tags = getAllTags(cache ?? ({} as any)) ?? [];
      for (const t of tags) {
        const norm = t.replace(/^#+/, '');
        counts.set(norm, (counts.get(norm) ?? 0) + 1);
      }
    }
    const sorted = [...counts.entries()]
      .filter(([, c]) => c >= minCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max);
    if (sorted.length === 0) return '(no tags found)';
    return sorted.map(([t, c]) => `#${t}  ×${c}`).join('\n');
  },
});
