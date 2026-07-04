/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
  searchHint: 'enumerate outgoing wikilinks from note',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `outgoing links from ${a.path}`,
  spec: {
    name: 'get_outgoing_links',
    description: 'List wikilinks emitted from a note, including unresolved ones (those would be "dangling" red links in the UI).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        include_unresolved: { type: 'boolean', description: 'Default true. Set false to filter to resolved links only.' },
      },
      required: ['path'],
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
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
