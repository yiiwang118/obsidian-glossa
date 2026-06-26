/**
 * read_canvas — parse a .canvas file and return its structured contents.
 *
 * Also implements `renderToolResultMessage` to show a compact node/edge
 * summary card in the UI instead of dumping raw JSON.
 */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, type ToolImpl } from './_shared';
import { setStyle } from '../../utils/dom';

interface CanvasNode {
  id: string;
  type: string;
  x?: number; y?: number; width?: number; height?: number;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  label?: string;
}

interface CanvasDoc {
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
}

export const readCanvas: ToolImpl = buildTool({
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  searchHint: 'parse json canvas file nodes edges',
  backfillObservableInput(input) {
    if (typeof (input as any).path === 'string') {
      (input as any).path = ((input as any).path as string).replace(/^\.\//, '').trim();
    }
  },
  describe: a => `read canvas ${a.path}`,
  spec: {
    name: 'read_canvas',
    description: 'Read and parse a .canvas (JSON Canvas 1.0) file. Returns a structured summary: node count by type, edge count, and a JSON dump.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Vault-relative path to a .canvas file.' } },
      required: ['path'],
    },
  },
  // Demo of the per-tool render hook: instead of a 4000-char <pre> dump, show
  // a compact summary line with key counts. The full JSON stays in the args
  // detail; click-to-expand the row to inspect. This is what U3's render-hook
  // demonstration sub-item asks for.
  renderToolResultMessage(result, _args) {
    try {
      // The result string starts with our summary line; pull just that for a
      // tighter UI presentation.
      const firstLine = result.split('\n').slice(0, 4).join('\n');
      const el = activeDocument.createElement('div');
      el.className = 'nc-canvas-summary';
      setStyle(el, { whiteSpace: 'pre-wrap' });
      setStyle(el, { padding: '6px 10px' });
      setStyle(el, { fontSize: '12px' });
      setStyle(el, { lineHeight: '1.5' });
      setStyle(el, { background: 'var(--glossa-surface-2, rgba(255,255,255,0.03))' });
      setStyle(el, { borderRadius: '4px' });
      el.textContent = firstLine;
      // Append a "show full" details below.
      const det = activeDocument.createElement('details');
      setStyle(det, { marginTop: '6px' });
      const sum = activeDocument.createElement('summary');
      sum.textContent = 'Full JSON';
      setStyle(sum, { cursor: 'pointer' });
      setStyle(sum, { fontSize: '11px' });
      setStyle(sum, { opacity: '0.7' });
      det.appendChild(sum);
      const pre = activeDocument.createElement('pre');
      setStyle(pre, { fontSize: '11px' });
      setStyle(pre, { margin: '4px 0 0 0' });
      pre.textContent = result.slice(0, 8000);
      det.appendChild(pre);
      el.appendChild(det);
      return el;
    } catch {
      return null; // fall back to default <pre>
    }
  },
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    if (!path.endsWith('.canvas')) return `Error: ${path} is not a .canvas file.`;
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    const raw = await app.vault.read(f);
    let doc: CanvasDoc;
    try { doc = JSON.parse(raw); }
    catch (e: any) { return `Error: invalid JSON in ${path}: ${e.message}`; }
    const nodes = doc.nodes ?? [];
    const edges = doc.edges ?? [];
    const byType = new Map<string, number>();
    for (const n of nodes) byType.set(n.type ?? 'unknown', (byType.get(n.type ?? 'unknown') ?? 0) + 1);
    const typeBreakdown = [...byType.entries()].map(([t, c]) => `${t}:${c}`).join(', ');
    const summary = [
      `Canvas: ${path}`,
      `${nodes.length} nodes (${typeBreakdown || 'empty'})`,
      `${edges.length} edges`,
      '',
      '```json',
      JSON.stringify(doc, null, 2),
      '```',
    ].join('\n');
    return summary;
  },
});
