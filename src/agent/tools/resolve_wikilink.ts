/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * resolve_wikilink — figure out what `[[name]]` actually resolves to in this vault.
 *
 * Obsidian's wikilink resolution depends on basenames, folders, aliases, and
 * the editor's "shortest unique path" preference. This tool exposes that
 * resolver to the model so it can tell whether a link in a note is dangling.
 */
import { TFile } from 'obsidian';
import { buildTool, type ToolImpl } from './_shared';

export const resolveWikilink: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'find target path of wikilink reference',
  describe: a => `resolve [[${a.link}]]`,
  spec: {
    name: 'resolve_wikilink',
    description: 'Resolve a wikilink reference `[[name]]` (or `name#heading`, `name^block`, `name|alias`) to the actual vault file path. Returns the resolved path + a boolean indicating whether the file exists.',
    parameters: {
      type: 'object',
      properties: {
        link: { type: 'string', description: 'The text inside [[...]], e.g. "MyNote" or "MyNote#Section".' },
        from: { type: 'string', description: 'Optional vault path of the file CONTAINING the link — used by Obsidian when shortest-path resolution depends on the source location.' },
      },
      required: ['link'],
    },
  },
  run: async (app, args) => {
    const link = String(args.link ?? '').trim();
    if (!link) return 'Error: link is required.';
    // Strip alias / heading / block suffix for the resolver — we only need
    // the path part. Heading / block tails are informational and don't
    // affect file resolution.
    const cleaned = link.replace(/^\[\[/, '').replace(/\]\]$/, '');
    const head = cleaned.split('|')[0].split('#')[0].split('^')[0].trim();
    const from = typeof args.from === 'string' ? args.from : '';
    const dest = app.metadataCache.getFirstLinkpathDest(head, from);
    if (dest instanceof TFile) {
      return `Resolved: ${dest.path}\nExists: true\nLinkpath: ${head}`;
    }
    return `Resolved: (none)\nExists: false\nLinkpath: ${head}\n\n[[${link}]] is a dangling / unresolved wikilink in the current vault.`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
