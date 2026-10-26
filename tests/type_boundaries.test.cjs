const path = require('path');
const fs = require('fs');

exports.run = async (t, load) => {
  // Configuration is part of the regression: source warnings must never disappear behind file exceptions.
  const { ESLint } = require('eslint');
  const eslint = new ESLint();
  const rules = ['assignment', 'member-access', 'argument', 'call', 'return'].map(name => `@typescript-eslint/no-unsafe-${name}`);
  const violations = [];
  const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.ts') ? [path.join(dir, entry.name)] : []);
  for (const file of files(path.resolve(__dirname, '../src'))) {
    const config = await eslint.calculateConfigForFile(file);
    for (const rule of rules) if (config.rules[rule]?.[0] !== 2) violations.push(`${file}: ${rule}`);
  }
  t.eq(violations, [], 'all runtime files enforce every type-safety rule without local exemptions');

  class TFile { constructor() { this.path = 'sample.canvas'; } }
  const { patchCanvas } = await load(path.resolve(__dirname, '../src/agent/tools/patch_canvas.ts'), { TFile });
  const file = new TFile(), writes = [];
  let document = 'null';
  const app = { vault: { getAbstractFileByPath: () => file, read: async () => document, modify: async (_, text) => writes.push(text) } };
  const node = { id: 'new', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'Hello' };
  for (const invalid of ['null', '[]', '42', '"text"']) {
    document = invalid;
    const result = await patchCanvas.run(app, { path: file.path, op: 'add_node', payload: node });
    t.ok(result.startsWith('Error:'), 'invalid canvas root is rejected: ' + invalid);
  }
  t.eq(writes.length, 0, 'malformed canvas data is never replaced with an empty canvas');
  document = JSON.stringify({ nodes: [], edges: [], extension: { keep: true } });
  const badType = await patchCanvas.run(app, { path: file.path, op: 'add_node', payload: { ...node, type: ['text'] } });
  t.ok(badType.startsWith('Error:') && !writes.length, 'string coercion never accepts an invalid node type');
  await patchCanvas.run(app, { path: file.path, op: 'add_node', payload: node });
  const saved = JSON.parse(writes[0]);
  t.eq(saved.nodes, [node], 'valid Canvas operations retain their original contents');
  t.eq(saved.extension, { keep: true }, 'valid Canvas extensions survive typed parsing');
};
