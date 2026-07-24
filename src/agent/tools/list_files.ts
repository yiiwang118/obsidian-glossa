/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile, TFolder } from 'obsidian';
import { assertVaultPath, buildTool, globToRegExp as sharedGlobToRegExp, type ToolImpl } from './_shared';

/** Local wrapper so the rest of this file keeps the case-insensitive flag
 *  list_files has always used. */
function globToRegExp(glob: string): RegExp {
  return new RegExp(sharedGlobToRegExp(glob).source, 'i');
}

export const listFiles: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'enumerate vault folder contents',
  describe: a => {
    const parts: string[] = [a.folder || '/'];
    if (a.glob) parts.push(a.glob);
    if (a.limit) parts.push(`limit ${a.limit}`);
    return `list ${parts.join(' · ')}`;
  },
  spec: {
    name: 'list_files',
    description: 'List full vault-relative paths in one folder for later read/edit calls. Defaults to recursive Markdown files; supports glob, all-file, folder, and limit options.',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Vault folder path. Empty or "/" = root.' },
        glob: { type: 'string', description: 'Glob pattern over full path (e.g. "Daily/**/*.md", "**/foo*.md").' },
        recursive: { type: 'boolean', description: 'Default true.' },
        all_files: { type: 'boolean', description: 'When true, include non-markdown files. Ignored if glob is set.' },
        include_folders: { type: 'boolean', description: 'Default false.' },
        limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'Cap on returned entries. Default 500.' },
      },
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    let folder = '';
    if (args.folder && args.folder !== '/') {
      try { folder = assertVaultPath(args.folder, 'folder'); }
      catch (error) { return `Error: ${error.message}`; }
    }
    const recursive = args.recursive ?? true;
    const allFiles = !!args.all_files;
    const includeFolders = !!args.include_folders;
    const limit = Math.max(1, Math.min(5000, args.limit ?? 500));
    const globStr: string | undefined = args.glob || (allFiles ? '**/*' : undefined);
    const matcher = globStr ? globToRegExp(globStr) : null;

    const root = folder ? app.vault.getAbstractFileByPath(folder) : app.vault.getRoot();
    if (!(root instanceof TFolder)) return `Error: not a folder: ${folder || '/'}`;

    const entries: string[] = [];
    let totalScanned = 0;
    const visit = (f: TFolder) => {
      for (const c of f.children) {
        totalScanned++;
        if (c instanceof TFolder) {
          if (includeFolders) {
            const p = c.path + '/';
            if (!matcher || matcher.test(p) || matcher.test(c.path)) entries.push(p);
          }
          if (recursive) visit(c);
        } else if (c instanceof TFile) {
          // Default file filter when no explicit glob: .md only (unless all_files)
          if (!globStr && !allFiles && c.extension !== 'md') continue;
          if (matcher && !matcher.test(c.path)) continue;
          entries.push(c.path);
        }
        if (entries.length >= limit + 1) return; // +1 so we can show truncation marker
      }
    };
    visit(root);

    const header = `Folder: ${folder || '/'}${globStr ? `   Glob: ${globStr}` : ''}   (${totalScanned} scanned, ${entries.length} matched)`;
    if (entries.length === 0) return `${header}\n\n(no matches)`;
    const truncated = entries.length > limit;
    const shown = entries.slice(0, limit);
    const out = shown.join('\n');
    return truncated
      ? `${header}\n\n${out}\n[+${entries.length - limit} more, truncated — narrow the glob or raise limit]`
      : `${header}\n\n${out}`;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
