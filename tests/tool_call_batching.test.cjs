const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/agent/tool_call_batching.ts'));
  const calls = [
    { id: 'a', name: 'file_edit', args: { file_path: './Notes/A.md', old_string: 'one', new_string: '1' } },
    { id: 'read', name: 'read_note', args: { path: 'Notes/B.md' } },
    { id: 'b', name: 'file_edit', args: { file_path: 'Notes/A.md', old_string: 'two', new_string: '2', replace_all: true } },
    { id: 'create', name: 'file_edit', args: { file_path: 'Notes/A.md', old_string: '', new_string: 'new' } },
  ];
  const grouped = mod.batchSameFileEdits(calls);
  t.eq(grouped.leaderArgs.get('a').edits.length, 2, 'same-turn edits for one normalized path are grouped');
  t.eq(grouped.leaderArgs.get('a').edits[1].replace_all, true, 'grouping preserves replace_all intent');
  t.eq(grouped.followerToLeader.get('b'), 'a', 'followers point to the one approved write');
  t.ok(!grouped.followerToLeader.has('create'), 'create operations are never merged into edits');
};
