/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
    description: 'Return cached frontmatter, headings, tags, and outgoing link targets for one note without reading its full body. Use read_note when prose content is needed.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative path of the note to inspect.' } },
      required: ['path'],
      additionalProperties: false,
    },
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
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
