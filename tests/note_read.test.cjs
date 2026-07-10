const path = require('path');

exports.run = async function(t, loadModule) {
  const noteRead = await loadModule(path.resolve(__dirname, '../src/utils/note_read.ts'));
  const source = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n');

  const full = noteRead.formatNoteRead('Notes/Test.md', source);
  t.ok(full.includes('Path: Notes/Test.md  (12 lines') && full.endsWith('line 12'), 'full read preserves the existing path header and complete source');

  const ranged = noteRead.formatNoteRead('Notes/Test.md', source, { startLine: 3, endLine: 5 });
  t.ok(ranged.includes('Range: lines 3-5 of 12; has_more_below=true; next_start_line=6'), 'range reports exact continuation metadata');
  t.ok(ranged.endsWith('line 3\nline 4\nline 5'), 'range returns exact source without synthetic line prefixes');
  t.ok(!ranged.includes('line 2\n') && !ranged.includes('line 6\n'), 'range excludes adjacent content');

  const maxLines = noteRead.formatNoteRead('Notes/Test.md', source, { startLine: 8, maxLines: 2 });
  t.ok(maxLines.includes('Range: lines 8-9 of 12') && maxLines.endsWith('line 8\nline 9'), 'max_lines provides bounded pagination when end_line is absent');

  t.throws(() => noteRead.formatNoteRead('Notes/Test.md', source, { startLine: 20 }), 'range rejects a start beyond the file');
  t.throws(() => noteRead.formatNoteRead('Notes/Test.md', source, { startLine: 5, endLine: 4 }), 'range rejects reversed bounds');

  const capped = noteRead.formatNoteRead('Notes/Test.md', 'abcdefghij\nsecond', { startLine: 1, endLine: 2 }, {
    maxChars: 5, maxLines: 10, defaultRangeLines: 2,
  });
  t.ok(capped.includes('range truncated at 5 chars within line 1') && capped.includes('next_start_line=2'), 'range character cap remains observable with explicit partial-line metadata');
};
