/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * get_outgoing_links — list every wikilink the note emits.
 *
 * Includes BOTH resolved and unresolved links so the model can spot
 * dangling references. Each entry: { link, resolved_path? }.
 */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

export const getOutgoingLinks: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  shouldDefer: true,
  searchHint: 'enumerate outgoing wikilinks from note',
  searchTags: ['outbound links', 'dangling links', '出链', '未解析链接'],
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `outgoing links from ${a.path}`,
  spec: {
    name: 'get_outgoing_links',
    description: 'List wikilinks and embeds emitted by one note, with resolved paths and optional dangling targets. Use for link audits rather than reading prose.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path of the source note.' },
        include_unresolved: { type: 'boolean', description: 'Default true. Set false to filter to resolved links only.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    const includeUnresolved = args.include_unresolved !== false;
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    const cache = app.metadataCache.getFileCache(f);
    const links = (cache?.links ?? []).map(l => l.link);
    const embeds = (cache?.embeds ?? []).map(l => l.link);
    const all = [...new Set([...links, ...embeds])];
    const lines: string[] = [];
    for (const link of all) {
      const dest = app.metadataCache.getFirstLinkpathDest(link.split('#')[0].split('^')[0], path);
      if (dest instanceof TFile) {
        lines.push(`  → ${link}  (resolves to ${dest.path})`);
      } else if (includeUnresolved) {
        lines.push(`  ✗ ${link}  (unresolved / dangling)`);
      }
    }
    if (lines.length === 0) return `No outgoing links from ${path}.`;
    return `${lines.length} link${lines.length === 1 ? '' : 's'} from ${path}:\n${lines.join('\n')}`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
