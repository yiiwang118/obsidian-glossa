/**
 * patch_canvas — surgical node/edge edits to a .canvas file.
 *
 * Operations:
 *   - add_node     payload: full node object
 *   - remove_node  payload: { id }   (also removes any edges touching that node)
 *   - update_node  payload: { id, ...patches }  (shallow merge)
 *   - add_edge     payload: full edge object
 *   - remove_edge  payload: { id }
 *
 * Mutates the JSON deterministically (no .canvas plugin dependency) and writes
 * back via vault.modify. REQUIRES USER APPROVAL.
 */
import { TFile } from 'obsidian';
import { assertVaultPath, buildTool, normalizePathFields, type ToolImpl } from './_shared';

type Op = 'add_node' | 'remove_node' | 'update_node' | 'add_edge' | 'remove_edge';

interface CanvasDoc {
  nodes?: any[];
  edges?: any[];
}

export const patchCanvas: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  searchHint: 'edit canvas json file nodes edges',
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `${a.op ?? '?'} on canvas ${a.path}`,
  spec: {
    name: 'patch_canvas',
    description: 'Mutate a .canvas file by adding / removing / updating a single node or edge. REQUIRES USER APPROVAL.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative .canvas file path.' },
        op: { type: 'string', enum: ['add_node', 'remove_node', 'update_node', 'add_edge', 'remove_edge'] },
        payload: { type: 'object', description: 'Op-specific data. add_*: full object. remove_*: {id}. update_node: {id, ...patches} (shallow merged).' },
      },
      required: ['path', 'op', 'payload'],
    },
  },
  preview: async (a) => `${a.op} on ${a.path}\n\n${JSON.stringify(a.payload, null, 2).slice(0, 400)}`,
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e: any) { return `Error: ${e.message}`; }
    if (!path.endsWith('.canvas')) return `Error: ${path} is not a .canvas file.`;
    const op = args.op as Op;
    const payload = args.payload ?? {};
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    let doc: CanvasDoc;
    try { doc = JSON.parse(await app.vault.read(f)); }
    catch (e: any) { return `Error: invalid JSON in ${path}: ${e.message}`; }
    if (!Array.isArray(doc.nodes)) doc.nodes = [];
    if (!Array.isArray(doc.edges)) doc.edges = [];

    let summary = '';
    if (op === 'add_node') {
      if (!payload.id || !payload.type) return 'Error: add_node payload requires id + type.';
      if (doc.nodes.some(n => n.id === payload.id)) return `Error: node ${payload.id} already exists.`;
      doc.nodes.push(payload);
      summary = `Added node ${payload.id} (${payload.type}).`;
    } else if (op === 'remove_node') {
      const id = payload.id;
      if (!id) return 'Error: remove_node payload requires id.';
      const beforeN = doc.nodes.length;
      doc.nodes = doc.nodes.filter(n => n.id !== id);
      if (doc.nodes.length === beforeN) return `Error: node ${id} not found.`;
      const beforeE = doc.edges.length;
      doc.edges = doc.edges.filter(e => e.fromNode !== id && e.toNode !== id);
      summary = `Removed node ${id} and ${beforeE - doc.edges.length} touching edge(s).`;
    } else if (op === 'update_node') {
      const id = payload.id;
      if (!id) return 'Error: update_node payload requires id.';
      const node = doc.nodes.find(n => n.id === id);
      if (!node) return `Error: node ${id} not found.`;
      // Shallow merge — preserves id.
      const { id: _, ...patches } = payload;
      Object.assign(node, patches);
      summary = `Updated node ${id} (${Object.keys(patches).length} field(s)).`;
    } else if (op === 'add_edge') {
      if (!payload.id || !payload.fromNode || !payload.toNode) {
        return 'Error: add_edge payload requires id + fromNode + toNode.';
      }
      if (doc.edges.some(e => e.id === payload.id)) return `Error: edge ${payload.id} already exists.`;
      doc.edges.push(payload);
      summary = `Added edge ${payload.id}: ${payload.fromNode} → ${payload.toNode}.`;
    } else if (op === 'remove_edge') {
      const id = payload.id;
      if (!id) return 'Error: remove_edge payload requires id.';
      const before = doc.edges.length;
      doc.edges = doc.edges.filter(e => e.id !== id);
      if (doc.edges.length === before) return `Error: edge ${id} not found.`;
      summary = `Removed edge ${id}.`;
    } else {
      return `Error: unknown op "${op}"`;
    }

    await app.vault.modify(f, JSON.stringify(doc, null, '\t') + '\n');
    return `${summary}\n\nCanvas now: ${doc.nodes.length} nodes, ${doc.edges.length} edges.`;
  },
});
