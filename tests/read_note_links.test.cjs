const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/agent/tools/read_note.ts'));
  const output = mod.formatCompactOutgoingLinks([
    { link: 'B', displayText: 'Paper B' },
    { link: 'B', displayText: 'Paper B' },
    { link: 'Missing' },
  ], link => link === 'B' ? 'Papers/B.md' : null, 10);
  t.ok(output.includes('[[B]] (Paper B) -> Papers/B.md'), 'resolved outgoing links include display text and destination');
  t.ok(output.includes('[[Missing]] -> Missing'), 'unresolved links remain visible without a second lookup');
  t.eq((output.match(/\[\[B\]\]/g) ?? []).length, 1, 'duplicate link metadata is compacted');
  const limited = mod.formatCompactOutgoingLinks([{ link: 'A' }, { link: 'B' }], () => null, 1);
  t.ok(limited.includes('[[A]]') && !limited.includes('[[B]]'), 'outgoing link summaries obey their cap');
};
