import { getAllTags } from 'obsidian';
import { buildTool, type ToolImpl } from './_shared';

export const searchByTag: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'find notes tagged with a label',
  describe: a => `tag ${a.tag}`,
  spec: {
    name: 'search_by_tag',
    description: 'List notes that have the given tag (e.g. "#research").',
    parameters: {
      type: 'object',
      properties: { tag: { type: 'string' } }, required: ['tag'],
    },
  },
  run: async (app, { tag }) => {
    const t = String(tag).startsWith('#') ? tag : '#' + tag;
    const hits: string[] = [];
    for (const f of app.vault.getMarkdownFiles()) {
      const c = app.metadataCache.getFileCache(f);
      if (!c) continue;
      if ((getAllTags(c) ?? []).includes(t)) hits.push(f.path);
      if (hits.length >= 100) break;
    }
    return hits.join('\n') || `No files with tag ${t}.`;
  },
});
