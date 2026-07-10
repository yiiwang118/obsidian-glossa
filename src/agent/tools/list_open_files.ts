/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * list_open_files — enumerate every currently-open editor tab + its cursor.
 *
 * Lets the model see "what is the user actually looking at right now". Useful
 * for distinguishing "the user mentioned 'this note' which probably means the
 * file in the active tab" from "they referred to one of the 3 split panes".
 */
import { MarkdownView, type WorkspaceLeaf } from 'obsidian';
import { buildTool, type ToolImpl } from './_shared';

interface OpenFile {
  path: string;
  /** Leaf id Obsidian uses to address this tab. */
  leaf_id: string;
  /** When true, the tab is currently focused. */
  is_active: boolean;
  /** Markdown-only: 0-based cursor line / character. */
  cursor?: { line: number; ch: number };
  /** Markdown-only: optional 1-based selection range. */
  selection?: { from: { line: number; ch: number }; to: { line: number; ch: number } };
  /** Identifies the view type (markdown, canvas, pdf, …) so the model knows
   *  what tools apply. */
  view_type: string;
}

export const listOpenFiles: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  dangerous: false,
  shouldDefer: true,
  searchHint: 'list open editor tabs cursor positions',
  searchTags: ['workspace tabs', 'open panes', '打开标签页', '当前窗口'],
  describe: () => 'list open tabs',
  spec: {
    name: 'list_open_files',
    description: 'List open workspace tabs with paths, active state, view type, and Markdown cursor/selection. Use only when the request refers to multiple visible tabs or panes.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (app) => {
    const activeLeaf = app.workspace.getMostRecentLeaf();
    const out: OpenFile[] = [];
    // Iterate ALL leaves; filter to those with a file open. Includes splits + sidebar.
    app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      const view = leaf.view as AnyValue;
      const file = view?.file;
      if (!file?.path) return;
      const isMd = leaf.view instanceof MarkdownView;
      let cursor: OpenFile['cursor'] | undefined;
      let selection: OpenFile['selection'] | undefined;
      if (isMd) {
        const editor = (leaf.view as AnyValue).editor;
        if (editor) {
          try {
            const c = editor.getCursor();
            cursor = { line: c.line, ch: c.ch };
            const sel = editor.listSelections?.()?.[0];
            if (sel && (sel.anchor.line !== sel.head.line || sel.anchor.ch !== sel.head.ch)) {
              selection = {
                from: { line: Math.min(sel.anchor.line, sel.head.line), ch: Math.min(sel.anchor.ch, sel.head.ch) },
                to:   { line: Math.max(sel.anchor.line, sel.head.line), ch: Math.max(sel.anchor.ch, sel.head.ch) },
              };
            }
          } catch { /* editor probably not ready */ }
        }
      }
      out.push({
        path: file.path,
        leaf_id: (leaf as AnyValue).id ?? '(no-id)',
        is_active: leaf === activeLeaf,
        cursor,
        selection,
        view_type: (leaf.view as AnyValue).getViewType?.() ?? 'unknown',
      });
    });
    if (out.length === 0) return '(no files open)';
    const lines = out.map(f => {
      const star = f.is_active ? '★' : ' ';
      const tail = f.cursor ? ` @ L${f.cursor.line + 1}:${f.cursor.ch}` : '';
      const sel = f.selection ? ` [sel ${f.selection.from.line + 1}-${f.selection.to.line + 1}]` : '';
      return `${star} [${f.view_type}] ${f.path}${tail}${sel}`;
    });
    return [`${out.length} tab${out.length === 1 ? '' : 's'} open (★ = focused):`, ...lines].join('\n');
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
