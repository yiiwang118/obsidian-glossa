/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
  shouldDefer: true,
  searchHint: 'find target path of wikilink reference',
  searchTags: ['resolve internal link', 'dangling link', '解析双链', '链接目标'],
  describe: a => `resolve [[${a.link}]]`,
  spec: {
    name: 'resolve_wikilink',
    description: 'Resolve the file portion of a wikilink against vault aliases and shortest-path rules. Use to verify a target or diagnose a dangling link; it does not validate the referenced heading or block.',
    parameters: {
      type: 'object',
      properties: {
        link: { type: 'string', description: 'The text inside [[...]], e.g. "MyNote" or "MyNote#Section".' },
        from: { type: 'string', description: 'Optional vault path of the file CONTAINING the link — used by Obsidian when shortest-path resolution depends on the source location.' },
      },
      required: ['link'],
      additionalProperties: false,
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
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
