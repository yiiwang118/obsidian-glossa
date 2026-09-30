const path = require('node:path');
exports.run = async (t, load) => {
  const { summarizeFileChange } = await load(path.resolve(__dirname, '../src/utils/edit_summary.ts'));
  t.eq(summarizeFileChange('same\n', 'same\n'), null, 'unchanged files have no summary');
  t.eq(summarizeFileChange(null, 'one\ntwo\n'), { kind: 'created', adds: 2, dels: 0 }, 'creation does not count terminal newline as a line');
  t.eq(summarizeFileChange('one\n', null), { kind: 'deleted', adds: 0, dels: 1 }, 'deletion counts actual lines');
  t.eq(summarizeFileChange('one\ntwo\n', 'one\nthree\n'), { kind: 'modified', adds: 1, dels: 1 }, 'replacement shows exact changed lines');
  t.eq(summarizeFileChange('', 'text\n'), { kind: 'modified', adds: 1, dels: 0 }, 'empty file replacement does not invent a deletion');
  t.eq(summarizeFileChange('one\r\n', 'one\n'), { kind: 'modified', adds: 0, dels: 0 }, 'line-ending-only changes preserve format-change identity');
  t.eq(summarizeFileChange(null, ''), { kind: 'created', adds: 0, dels: 0 }, 'empty created file is still a change');
  t.eq(summarizeFileChange('a\n'.repeat(2100), 'b\n'.repeat(2100)), { kind: 'modified', adds: null, dels: null }, 'large preview never masquerades as complete counts');
};
