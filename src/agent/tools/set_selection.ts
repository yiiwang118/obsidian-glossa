/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
/**
 * set_selection — set the cursor / selection in the currently-active editor.
 *
 * Three target shapes (mutually exclusive; first set wins):
 *   {from: {line, ch}, to: {line, ch}}  — explicit range
 *   {heading: "..."}                    — select the heading line
 *   {block: "abc123"}                   — select the line containing ^abc123
 *
 * Useful for "I'm pointing at this — please rewrite it" workflows where the
 * model wants to put the user's cursor on a specific spot after an edit.
 */
import { MarkdownView } from 'obsidian';
import { buildTool, type ToolImpl } from './_shared';

export const setSelection: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => false,
  isConcurrencySafe: () => false,
  dangerous: false,
  searchHint: 'select text in editor cursor placement',
  describe: a => {
    if (a.from && a.to) return `select ${a.from.line}:${a.from.ch}-${a.to.line}:${a.to.ch}`;
    if (a.heading) return `select heading "${a.heading}"`;
    if (a.block) return `select block ^${a.block}`;
    return 'set selection';
  },
  spec: {
    name: 'set_selection',
    description: 'Set the selection (or just the cursor) in the active editor. Pass either an explicit {from,to} range, or a heading text, or a block ref.',
    parameters: {
      type: 'object',
      properties: {
        from:    { type: 'object', properties: { line: { type: 'number' }, ch: { type: 'number' } } },
        to:      { type: 'object', properties: { line: { type: 'number' }, ch: { type: 'number' } } },
        heading: { type: 'string', description: 'Exact heading text — selects that line.' },
        block:   { type: 'string', description: 'Block ref id — selects the line containing ^id.' },
      },
    },
  },
  run: async (app, args) => {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return 'Error: no active markdown editor.';
    const editor = (view as any).editor;
    if (!editor) return 'Error: active view has no editor (PDF / canvas?).';

    if (args.from && args.to && typeof args.from.line === 'number') {
      editor.setSelection(
        { line: Math.max(0, args.from.line | 0), ch: Math.max(0, args.from.ch | 0) },
        { line: Math.max(0, args.to.line | 0),   ch: Math.max(0, args.to.ch | 0)   },
      );
      return `Selected ${args.from.line}:${args.from.ch} → ${args.to.line}:${args.to.ch}.`;
    }

    // Heading / block lookup needs the file text.
    if (args.heading || args.block) {
      const text: string = editor.getValue();
      const lines = text.split('\n');
      let lineIdx = -1;
      if (args.heading) {
        const wantedText = String(args.heading).replace(/^#+\s+/, '').trim();
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/^#+\s+(.*)$/);
          if (m && m[1].trim() === wantedText) { lineIdx = i; break; }
        }
      } else if (args.block) {
        const ref = String(args.block).replace(/^\^/, '');
        const re = new RegExp(`\\^${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) { lineIdx = i; break; }
        }
      }
      if (lineIdx < 0) return `Error: target not found in active editor.`;
      editor.setSelection(
        { line: lineIdx, ch: 0 },
        { line: lineIdx, ch: lines[lineIdx].length },
      );
      return `Selected line ${lineIdx + 1}.`;
    }

    return 'Error: provide either {from,to} OR heading OR block.';
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
