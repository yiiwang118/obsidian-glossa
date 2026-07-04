/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { TFile } from 'obsidian';
import { setStyle } from '../../utils/dom';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

const READ_BYTE_CAP = 50_000;
const READ_LINE_CAP = 5_000;

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

    const wrap = activeDocument.createElement('div');
    setStyle(wrap, { padding: '6px 10px' });
    setStyle(wrap, { fontSize: '12px' });
    setStyle(wrap, { lineHeight: '1.5' });

    const header = activeDocument.createElement('div');
    setStyle(header, { fontWeight: '600' });
    setStyle(header, { marginBottom: '6px' });
    header.textContent = `📄 ${path}  ·  ${totalLines} lines  ·  ${totalChars} chars`;
    wrap.appendChild(header);

    if (headings.length > 0) {
      const tree = activeDocument.createElement('div');
      setStyle(tree, { padding: '4px 0 6px 0' });
      setStyle(tree, { opacity: '0.85' });
      setStyle(tree, { fontSize: '11px' });
      for (const h of headings) {
        const item = activeDocument.createElement('div');
        setStyle(item, { paddingLeft: `${(h.level - 1) * 12}px` });
        item.textContent = `${'  '.repeat(h.level - 1)}${'#'.repeat(h.level)} ${h.text}`;
        tree.appendChild(item);
      }
      wrap.appendChild(tree);
    }

    // Body in a collapsible details — keeps the card height bounded.
    const det = activeDocument.createElement('details');
    const sum = activeDocument.createElement('summary');
    sum.textContent = 'Full body';
    setStyle(sum, { cursor: 'pointer' });
    setStyle(sum, { fontSize: '11px' });
    setStyle(sum, { opacity: '0.7' });
    det.appendChild(sum);
    const pre = activeDocument.createElement('pre');
    setStyle(pre, { fontSize: '11px' });
    setStyle(pre, { margin: '4px 0 0 0' });
    setStyle(pre, { maxHeight: '400px' });
    setStyle(pre, { overflow: 'auto' });
    pre.textContent = body.slice(0, 20_000);
    det.appendChild(pre);
    wrap.appendChild(det);
    return wrap;
  },
  describe: a => `read ${a.path}`,
  spec: {
    name: 'read_note',
    description: 'Read the full content of a markdown note in the vault. Returns the file content as a string. Use this when the user asks about a specific file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative path, e.g. "Notes/Foo.md"' } },
      required: ['path'],
    },
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: file not found: ${path}`;
    const text = await app.vault.read(f);
    // Cap by chars AND lines so an attacker-controlled file with millions of
    // short lines can't blow up the context window or the transcript renderer.
    let body = text;
    let truncatedNote = '';
    if (body.length > READ_BYTE_CAP) {
      body = body.slice(0, READ_BYTE_CAP);
      truncatedNote = `\n\n[truncated at ${READ_BYTE_CAP.toLocaleString()} chars — file is ${text.length.toLocaleString()} chars total]`;
    }
    const lines = body.split('\n');
    if (lines.length > READ_LINE_CAP) {
      body = lines.slice(0, READ_LINE_CAP).join('\n');
      truncatedNote = `\n\n[truncated at ${READ_LINE_CAP.toLocaleString()} lines — original had ${text.split('\n').length.toLocaleString()} lines]`;
    }
    const totalLines = text.split('\n').length;
    const header = `Path: ${path}  (${totalLines} lines, ${text.length} chars)\n\n---\n`;
    return header + body + truncatedNote;
  },
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
