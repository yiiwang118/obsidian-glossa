import { TFile, TFolder } from 'obsidian';
import { buildTool, globToRegExp as sharedGlobToRegExp, type ToolImpl } from './_shared';

/** Local wrapper so the rest of this file keeps the case-insensitive flag
 *  list_files has always used. The grammar lives in `_shared.globToRegExp` so
 *  grep_vault and list_files stay in lockstep. */
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
    description: [
      'List files inside a vault folder. Returns FULL vault-relative paths (one per line)',
      'so you can pass them directly to read_note / file_edit / apply_patch.',
      '',
      'Args:',
      '- folder (optional): vault-relative folder path. Empty or "/" means vault root.',
      '- glob (optional): glob pattern matched against the FULL path. Supports **, *, ?. Defaults to "**/*.md".',
      '- recursive (optional, default true): whether to descend into subfolders.',
      '- all_files (optional): when true, include non-markdown files. Ignored if `glob` is set.',
      '- include_folders (optional): when true, include folder entries (with trailing /). Default false.',
      '- limit (optional, default 500): cap the number of returned entries.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Vault folder path. Empty or "/" = root.' },
        glob: { type: 'string', description: 'Glob pattern over full path (e.g. "Daily/**/*.md", "**/foo*.md").' },
        recursive: { type: 'boolean', description: 'Default true.' },
        all_files: { type: 'boolean', description: 'When true, include non-markdown files. Ignored if glob is set.' },
        include_folders: { type: 'boolean', description: 'Default false.' },
        limit: { type: 'number', description: 'Cap on returned entries. Default 500.' },
      },
    },
  },
  run: async (app, args) => {
    const folder = (args.folder && args.folder !== '/') ? args.folder : '';
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
