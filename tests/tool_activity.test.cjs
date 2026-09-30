const path = require('node:path');
exports.run = async (t, load) => {
  const { summarizeToolActivity } = await load(path.resolve(__dirname, '../src/utils/tool_activity.ts'));
  const ev = (id, name, args, status = 'success') => ({ id, name, args, status, startedAt: 1 });
  const summary = summarizeToolActivity([
    ev('a', 'read_note', { path: 'A.md' }), ev('b', 'read_note', { path: 'A.md' }),
    ev('c', 'read_files', { requests: [{ path: 'A.md' }, { path: 'B.md' }] }),
    ev('d', 'web_search', {}), ev('e', 'write_note', { path: 'A.md' }),
    ev('f', 'write_note', { path: 'C.md' }, 'error'),
  ]);
  t.ok(/Read 2 files|读取 2 个文件/.test(summary), 'repeated reads count distinct known files');
  t.ok(/Changed 1 files|变更 1 个文件/.test(summary), 'failed write does not count as completed change');
  t.ok(/1 failed|1 项失败/.test(summary), 'failure remains explicit');
  t.ok(/1 web actions|联网 1 次/.test(summary), 'web work is separated');
  const pending = summarizeToolActivity([ev('x', 'read_note', {}, 'pending'), ev('y', 'write_note', {}, 'denied')]);
  t.ok(/unfinished|待完成/.test(pending) && /not executed|未执行/.test(pending), 'pending and denied work do not look complete');
  const unknown = summarizeToolActivity([ev('u', 'external_read_everything', {})]);
  t.ok(/other actions|其他操作/.test(unknown), 'unknown tool names are not guessed into read category');
  const updated = summarizeToolActivity([ev('z', 'read_note', { path: 'A.md' }, 'running'), ev('z', 'read_note', { path: 'A.md' })]);
  t.ok(!/unfinished|待完成/.test(updated), 'latest event state wins for repeated IDs');
};
