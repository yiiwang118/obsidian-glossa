/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
      tags: getAllTags(c ?? {} as AnyValue) ?? [],
      links: (c?.links ?? []).map(l => l.link),
    }, null, 2);
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
