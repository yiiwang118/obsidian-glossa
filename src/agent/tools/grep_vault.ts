/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { buildTool, globToRegExp, type ToolImpl } from './_shared';

/** Lightweight ripgrep-style search using Obsidian's vault + the in-memory FileIndex.
 *  Unlike search_vault (fuzzy scoring across whole-file windows), grep_vault is exact
 *  regex matching and yields control to the event loop every batch so the UI stays
 *  responsive even on 10k-note vaults. */
export const grepVault: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'exact regex search across vault files',
  describe: a => `grep "${a.pattern}"${a.path_glob ? ' in ' + a.path_glob : ''}`,
  spec: {
    name: 'grep_vault',
    description: [
      'Regex-based grep across vault markdown files. Returns matching lines with',
      'their file path + 1-based line number, similar to `rg "pattern"`.',
      '',
      'Args:',
      '- pattern: JavaScript regex string (anchored line-by-line).',
      '- flags (optional): regex flags, e.g. "i" for case-insensitive. Default "i".',
      '- path_glob (optional): only files whose path matches this glob (** / * / ?). e.g. "Daily/**/*.md".',
      '- max_results (optional, default 80): cap matched lines.',
      '- context (optional, default 0): lines of context above/below each match.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        flags: { type: 'string', description: 'JS regex flags. Default "i".' },
        path_glob: { type: 'string', description: 'Glob over full path.' },
        max_results: { type: 'number', description: 'Default 80.' },
        context: { type: 'number', description: 'Lines of context above/below. Default 0.' },
      },
      required: ['pattern'],
    },
  },
  run: async (app, args) => {
    const pattern: string = String(args.pattern ?? '').trim();
    if (!pattern) return 'Error: pattern is required.';
    let re: RegExp;
    try { re = new RegExp(pattern, args.flags ?? 'i'); }
    catch (e: any) { return `Error: invalid regex: ${e.message}`; }

    const max = Math.max(1, Math.min(500, args.max_results ?? 80));
    const ctxLines = Math.max(0, Math.min(5, args.context ?? 0));

    // Glob → RegExp. Shared with list_files via `globToRegExp` in _shared so
    // both tools handle `**`, `*`, `?` identically — drift between them
    // previously made `grep_vault path_glob:"Notes/**"` match what
    // `list_files path:"Notes/**"` did not.
    let pathMatcher: RegExp | null = null;
    if (typeof args.path_glob === 'string' && args.path_glob.length) {
      pathMatcher = new RegExp(globToRegExp(args.path_glob).source, 'i');
    }

    // Look up by current id first, fall back to legacy id so the tool still
     // works during the rename transition (or if the user has both installed).
    const plugin = (app as any).plugins?.plugins?.['glossa']
               ?? (app as any).plugins?.plugins?.['note-codex']
               ?? (app as any).plugins?.getPlugin?.('glossa')
               ?? (app as any).plugins?.getPlugin?.('note-codex');
    const useIndex = !!plugin?.fileIndex && plugin.fileIndex.size() > 0;

    const matches: { path: string; line: number; text: string; context?: { line: number; text: string }[] }[] = [];
    let scanned = 0;
    const YIELD_EVERY = 32;

    const files = useIndex
      ? plugin.fileIndex.list().map((e: any) => app.vault.getAbstractFileByPath(e.path))
      : app.vault.getMarkdownFiles();

    outer: for (const f of files) {
      if (!f) continue;
      scanned++;
      if (pathMatcher && !pathMatcher.test((f).path)) continue;
      const text = await app.vault.cachedRead(f);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          let context: { line: number; text: string }[] | undefined;
          if (ctxLines > 0) {
            context = [];
            for (let k = Math.max(0, i - ctxLines); k < Math.min(lines.length, i + ctxLines + 1); k++) {
              if (k === i) continue;
              context.push({ line: k + 1, text: lines[k] });
            }
          }
          matches.push({ path: (f).path, line: i + 1, text: lines[i], context });
          if (matches.length >= max) break outer;
        }
      }
      if (scanned % YIELD_EVERY === 0) await new Promise(r => window.setTimeout(r, 0));
    }

    if (matches.length === 0) return `No matches for /${pattern}/${args.flags ?? 'i'} across ${scanned} files.`;

    const out: string[] = [`${matches.length}${matches.length >= max ? '+' : ''} matches across ${scanned} files (${useIndex ? 'indexed' : 'fresh scan'}):`];
    for (const m of matches) {
      out.push('');
      out.push(`${m.path}:${m.line}: ${m.text.trim()}`);
      if (m.context && m.context.length) {
        for (const c of m.context) out.push(`  ${m.path}:${c.line}- ${c.text.trim()}`);
      }
    }
    return out.join('\n');
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
