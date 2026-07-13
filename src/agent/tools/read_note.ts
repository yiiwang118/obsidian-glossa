/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import { setStyle } from '../../utils/dom';
import { formatNoteRead } from '../../utils/note_read';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export const readNote: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'read full content of vault note',
  backfillObservableInput: normalizePathFields(['path']),
  // read_note manages its own caps (50k chars / 5k lines) — disable the agent
  // loop's generic persistence path; the file would be a redundant copy on disk.
  maxResultSizeChars: Infinity,
  // Show a compact "X lines · Y chars" header + a heading tree pulled from
  // the markdown body (h1–h3 only) before the raw <pre>. Keeps the card
  // scannable when the file is large.
  renderToolResultMessage(result) {
    if (result.startsWith('Error')) return null;
    // Result format: "Path: foo.md  (123 lines, 4567 chars)\n\n---\n<body>"
    const m = result.match(/^Path:\s+(.+?)\s+\((\d+)\s+lines,\s+(\d+)\s+chars\)/);
    if (!m) return null;       // fall back to default <pre> on parse failure
    const path = m[1], totalLines = m[2], totalChars = m[3];
    const bodyStart = result.indexOf('---\n');
    const body = bodyStart >= 0 ? result.slice(bodyStart + 4) : result;

    // Extract h1–h3 lines for the tree.
    const headings: { level: number; text: string }[] = [];
    for (const line of body.split('\n')) {
      const h = line.match(/^(#{1,3})\s+(.+)$/);
      if (h) headings.push({ level: h[1].length, text: h[2].trim() });
      if (headings.length >= 20) break;
    }

    const wrap = activeWindow.createDiv();
    setStyle(wrap, { padding: '6px 10px' });
    setStyle(wrap, { fontSize: '12px' });
    setStyle(wrap, { lineHeight: '1.5' });

    const header = activeWindow.createDiv();
    setStyle(header, { fontWeight: '600' });
    setStyle(header, { marginBottom: '6px' });
    header.textContent = `📄 ${path}  ·  ${totalLines} lines  ·  ${totalChars} chars`;
    wrap.appendChild(header);

    if (headings.length > 0) {
      const tree = activeWindow.createDiv();
      setStyle(tree, { padding: '4px 0 6px 0' });
      setStyle(tree, { opacity: '0.85' });
      setStyle(tree, { fontSize: '11px' });
      for (const h of headings) {
        const item = activeWindow.createDiv();
        setStyle(item, { paddingLeft: `${(h.level - 1) * 12}px` });
        item.textContent = `${'  '.repeat(h.level - 1)}${'#'.repeat(h.level)} ${h.text}`;
        tree.appendChild(item);
      }
      wrap.appendChild(tree);
    }

    // Body in a collapsible details — keeps the card height bounded.
    const det = activeWindow.createEl('details');
    const sum = activeWindow.createEl('summary');
    sum.textContent = 'Full body';
    setStyle(sum, { cursor: 'pointer' });
    setStyle(sum, { fontSize: '11px' });
    setStyle(sum, { opacity: '0.7' });
    det.appendChild(sum);
    const pre = activeWindow.createEl('pre');
    setStyle(pre, { fontSize: '11px' });
    setStyle(pre, { margin: '4px 0 0 0' });
    setStyle(pre, { maxHeight: '400px' });
    setStyle(pre, { overflow: 'auto' });
    pre.textContent = body.slice(0, 20_000);
    det.appendChild(pre);
    wrap.appendChild(det);
    return wrap;
  },
  describe: a => `read ${a.path}${a.start_line ? ` lines ${a.start_line}-${a.end_line ?? '...'}` : ''}`,
  spec: {
    name: 'read_note',
    description: 'Read one explicitly targeted vault file before editing or answering about its body. Optional 1-based line ranges avoid loading irrelevant content. Full reads are capped at 50,000 characters or 5,000 lines. Do not call when the same current-file content is already attached in context.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path, e.g. "Notes/Foo.md"' },
        start_line: { type: 'integer', minimum: 1, description: 'Optional 1-based first line. Defaults to 1 when another range field is set.' },
        end_line: { type: 'integer', minimum: 1, description: 'Optional inclusive last line. Takes precedence over max_lines.' },
        max_lines: { type: 'integer', minimum: 1, maximum: 5_000, description: 'Lines to return when end_line is omitted. Default 200.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: file not found: ${path}`;
    const text = await app.vault.read(f);
    try {
      const input = inputRecord(args);
      return formatNoteRead(path, text, {
        startLine: optionalNumber(input.start_line),
        endLine: optionalNumber(input.end_line),
        maxLines: optionalNumber(input.max_lines),
      });
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-member-access -- Re-enable review lint rules after dynamic boundary module. */
