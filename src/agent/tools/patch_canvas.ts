/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
  nodes?: AnyValue[];
  edges?: AnyValue[];
}

export const patchCanvas: ToolImpl = buildTool({
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => false,
  shouldDefer: true,
  searchHint: 'edit canvas json file nodes edges',
  searchTags: ['canvas modify', 'mind map graph', '编辑画布', '添加节点', '连接边'],
  backfillObservableInput: normalizePathFields(['path']),
  describe: a => `${a.op ?? '?'} on canvas ${a.path}`,
  spec: {
    name: 'patch_canvas',
    description: 'Apply one validated node or edge operation to an existing JSON Canvas file. Read the canvas first, preserve existing IDs, and use separate calls only for genuinely separate operations. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative .canvas file path.' },
        op: { type: 'string', enum: ['add_node', 'remove_node', 'update_node', 'add_edge', 'remove_edge'], description: 'Single Canvas mutation to perform.' },
        payload: { type: 'object', description: 'Op-specific data. add_*: full object. remove_*: {id}. update_node: {id, ...patches} (shallow merged).' },
      },
      required: ['path', 'op', 'payload'],
      additionalProperties: false,
    },
  },
  preview: async (a) => `${a.op} on ${a.path}\n\n${JSON.stringify(a.payload, null, 2).slice(0, 400)}`,
  run: async (app, args) => {
    let path: string;
    try { path = assertVaultPath(args.path); }
    catch (e) { return `Error: ${e.message}`; }
    if (!path.endsWith('.canvas')) return `Error: ${path} is not a .canvas file.`;
    const op = args.op as Op;
    const payload = args.payload ?? {};
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return `Error: not found: ${path}`;
    let doc: CanvasDoc;
    try { doc = JSON.parse(await app.vault.read(f)); }
    catch (e) { return `Error: invalid JSON in ${path}: ${e.message}`; }
    if (!Array.isArray(doc.nodes)) doc.nodes = [];
    if (!Array.isArray(doc.edges)) doc.edges = [];

    let summary = '';
    if (op === 'add_node') {
      if (!payload.id || !payload.type) return 'Error: add_node payload requires id + type.';
      if (doc.nodes.some(n => n.id === payload.id)) return `Error: node ${payload.id} already exists.`;
      const nodeError = validateNewNode(payload);
      if (nodeError) return `Error: ${nodeError}`;
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
      const patches = { ...payload };
      delete patches.id;
      for (const field of ['x', 'y', 'width', 'height']) {
        if (field in patches && !Number.isInteger(patches[field])) return `Error: update_node ${field} must be an integer.`;
      }
      if ('width' in patches && patches.width <= 0) return 'Error: update_node width must be positive.';
      if ('height' in patches && patches.height <= 0) return 'Error: update_node height must be positive.';
      Object.assign(node, patches);
      summary = `Updated node ${id} (${Object.keys(patches).length} field(s)).`;
    } else if (op === 'add_edge') {
      if (!payload.id || !payload.fromNode || !payload.toNode) {
        return 'Error: add_edge payload requires id + fromNode + toNode.';
      }
      if (doc.edges.some(e => e.id === payload.id)) return `Error: edge ${payload.id} already exists.`;
      const nodeIds = new Set(doc.nodes.map(node => String(node.id)));
      if (!nodeIds.has(payload.fromNode) || !nodeIds.has(payload.toNode)) {
        return 'Error: add_edge endpoints must reference existing node IDs.';
      }
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

function validateNewNode(node: AnyValue): string | null {
  if (!['text', 'file', 'link', 'group'].includes(node.type)) return `unsupported node type "${node.type}"`;
  for (const field of ['x', 'y', 'width', 'height']) {
    if (!Number.isInteger(node[field])) return `add_node ${field} must be an integer`;
  }
  if (node.width <= 0 || node.height <= 0) return 'add_node width and height must be positive';
  if (node.type === 'text' && typeof node.text !== 'string') return 'text node requires a text string';
  if (node.type === 'file' && typeof node.file !== 'string') return 'file node requires a vault-relative file path';
  if (node.type === 'link' && typeof node.url !== 'string') return 'link node requires a URL';
  return null;
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Re-enable review lint rules after dynamic boundary module. */
