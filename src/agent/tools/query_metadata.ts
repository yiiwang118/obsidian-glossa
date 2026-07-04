/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
import { TFile, getAllTags } from 'obsidian';
import { buildTool, normalizePathFields, type ToolImpl } from './_shared';

export const queryMetadata: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'note frontmatter headings tags',
  describe: a => `metadata ${a.path}`,
  backfillObservableInput: normalizePathFields(['path']),
  spec: {
    name: 'query_metadata',
    description: 'Return frontmatter + headings + tags for a note.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  run: async (app, { path }) => {
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    const c = app.metadataCache.getFileCache(f);
    return JSON.stringify({
      frontmatter: c?.frontmatter ?? null,
      headings: (c?.headings ?? []).map(h => ({ text: h.heading, level: h.level })),
      tags: getAllTags(c ?? {} as any) ?? [],
      links: (c?.links ?? []).map(l => l.link),
    }, null, 2);
  },
});
