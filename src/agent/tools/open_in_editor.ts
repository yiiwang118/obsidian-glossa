/**
 * open_in_editor — open a vault file in the editor, optionally jumping to a
 * line / heading / block, and optionally selecting it.
 *
 * Lets the model do things like "open Foo.md in a right split and jump to the
 * Methods section" in a single tool call. Mirrors what the user would get from
 * Ctrl+Click on a wikilink + manual navigation.
 *
 * Leaf modes:
 *   active        — replace current tab (Obsidian default)
 *   new-tab       — new tab in the same leaf group
 *   split-right   — new vertical split to the right
 *   split-down    — new horizontal split below
 *
 * Jump targets (all optional, mutually exclusive — first set wins):
 *   to.line     — 1-based line number
 *   to.heading  — exact heading text (with or without `# ` prefix)
 *   to.block    — block ref id (with or without `^` prefix)
 */
import { MarkdownView, TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

type LeafMode = 'active' | 'new-tab' | 'split-right' | 'split-down';

interface JumpTarget {
  line?: number;
  heading?: string;
  block?: string;
}

/** Locate the 1-based line number of a heading in source-mode text. */
function lineOfHeading(text: string, heading: string): number | null {
  const wantedText = heading.replace(/^#+\s+/, '').trim();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s+(.*)$/);
    if (m && m[2].trim() === wantedText) return i + 1;
  }
  return null;
}

/** Locate the 1-based line number containing `^block-ref`. */
function lineOfBlock(text: string, blockRef: string): number | null {
  const ref = blockRef.replace(/^\^/, '');
  const re = new RegExp(`\\^${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return null;
}

export const openInEditor: ToolImpl = buildTool({
  // Modifies workspace state (open tab, cursor, selection) but does NOT mutate
  // the vault. Not dangerous in the destructive sense, but also not safe to
  // run in parallel (multiple opens race for the active leaf).
  isReadOnly: () => false,
  isDestructive: () => false,
  isConcurrencySafe: () => false,
  dangerous: false,                    // workspace nav, no approval needed
  searchHint: 'open file in editor jump heading block',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => {
    const tail = a.to?.line ? ` :${a.to.line}`
               : a.to?.heading ? ` # ${a.to.heading}`
               : a.to?.block ? ` ^${a.to.block}`
               : '';
    return `open ${a.path}${tail}${a.leaf && a.leaf !== 'active' ? ` [${a.leaf}]` : ''}`;
  },
  spec: {
    name: 'open_in_editor',
    description: [
      'Open a vault file in the editor. Optionally jump to a heading / block / line',
      'and optionally place the selection on the target line.',
      '',
      'Args:',
      '  path: vault-relative file path.',
      '  leaf: "active" (default) | "new-tab" | "split-right" | "split-down".',
      '  to.line / to.heading / to.block: optional jump target (first set wins).',
      '  select: when true, select the matched line.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        leaf: { type: 'string', enum: ['active', 'new-tab', 'split-right', 'split-down'] },
        to: {
          type: 'object',
          properties: {
            line:    { type: 'number', description: '1-based line number.' },
            heading: { type: 'string', description: 'Exact heading text (with or without `#`).' },
            block:   { type: 'string', description: 'Block ref id (with or without `^`).' },
          },
        },
        select: { type: 'boolean', description: 'When true, place selection on the jump target line.' },
      },
      required: ['path'],
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;

    const mode = (args.leaf ?? 'active') as LeafMode;
    let leaf;
    if (mode === 'split-right') leaf = app.workspace.getLeaf('split', 'vertical');
    else if (mode === 'split-down') leaf = app.workspace.getLeaf('split', 'horizontal');
    else if (mode === 'new-tab') leaf = app.workspace.getLeaf('tab');
    else leaf = app.workspace.getLeaf(false);

    await leaf.openFile(f, { active: true });

    // Resolve jump target to a 1-based line number, if any.
    let targetLine: number | null = null;
    const to = (args.to ?? {}) as JumpTarget;
    if (typeof to.line === 'number') {
      targetLine = Math.max(1, Math.floor(to.line));
    } else if (to.heading || to.block) {
      const text = await app.vault.cachedRead(f);
      if (to.heading) targetLine = lineOfHeading(text, to.heading);
      else if (to.block) targetLine = lineOfBlock(text, to.block);
    }
    if (targetLine !== null) {
      const view = leaf.view as MarkdownView | undefined;
      const editor = (view as any)?.editor;
      if (editor) {
        const lineIdx = targetLine - 1;
        const lineText: string = editor.getLine(lineIdx) ?? '';
        if (args.select) {
          editor.setSelection(
            { line: lineIdx, ch: 0 },
            { line: lineIdx, ch: lineText.length },
          );
        } else {
          editor.setCursor({ line: lineIdx, ch: 0 });
        }
        // Scroll the target line into view.
        try { editor.scrollIntoView({ from: { line: lineIdx, ch: 0 }, to: { line: lineIdx, ch: lineText.length } }, true); } catch {}
      }
    }

    const targetDesc = targetLine !== null ? ` @ L${targetLine}` : '';
    return `Opened ${path} (${mode})${targetDesc}.`;
  },
});
