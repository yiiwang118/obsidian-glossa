import { TFile } from 'obsidian';
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
  renderToolResultMessage(result, _args) {
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

    const wrap = document.createElement('div');
    wrap.style.padding = '6px 10px';
    wrap.style.fontSize = '12px';
    wrap.style.lineHeight = '1.5';

    const header = document.createElement('div');
    header.style.fontWeight = '600';
    header.style.marginBottom = '6px';
    header.textContent = `📄 ${path}  ·  ${totalLines} lines  ·  ${totalChars} chars`;
    wrap.appendChild(header);

    if (headings.length > 0) {
      const tree = document.createElement('div');
      tree.style.padding = '4px 0 6px 0';
      tree.style.opacity = '0.85';
      tree.style.fontSize = '11px';
      for (const h of headings) {
        const item = document.createElement('div');
        item.style.paddingLeft = `${(h.level - 1) * 12}px`;
        item.textContent = `${'  '.repeat(h.level - 1)}${'#'.repeat(h.level)} ${h.text}`;
        tree.appendChild(item);
      }
      wrap.appendChild(tree);
    }

    // Body in a collapsible details — keeps the card height bounded.
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = 'full body';
    sum.style.cursor = 'pointer';
    sum.style.fontSize = '11px';
    sum.style.opacity = '0.7';
    det.appendChild(sum);
    const pre = document.createElement('pre');
    pre.style.fontSize = '11px';
    pre.style.margin = '4px 0 0 0';
    pre.style.maxHeight = '400px';
    pre.style.overflow = 'auto';
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
