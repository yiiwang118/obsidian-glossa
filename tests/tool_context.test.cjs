const path = require('path');

exports.run = async function(t, loadModule) {
  const mod = await loadModule(path.resolve(__dirname, '../src/utils/tool_context.ts'));

  const longResult = [
    'Fetched a large page.',
    'ordinary line '.repeat(120),
    'Downloaded: paper/RL/Target Paper.pdf',
    'Source: https://example.com/target.pdf',
    'SHA256: abcdef0123456789',
    'Next: call read_pdf.',
  ].join('\n');
  const compacted = mod.compactHistoricalToolResult({
    toolName: 'download_file',
    result: longResult,
    status: 'success',
    isRecent: false,
    maxChars: 900,
  });
  t.ok(compacted.length < longResult.length, 'older large tool result is compacted');
  t.ok(compacted.includes('paper/RL/Target Paper.pdf'), 'compacted result keeps saved path');
  t.ok(compacted.includes('https://example.com/target.pdf'), 'compacted result keeps source URL');
  t.eq(
    mod.compactHistoricalToolResult({ toolName: 'read_note', result: longResult, status: 'success', isRecent: true }),
    longResult,
    'recent tool result remains verbatim',
  );

  const args = mod.compactHistoricalToolArgs({
    file_path: 'Notes/Target.md',
    content: 'z'.repeat(3000),
    mode: 'replace',
  }, false);
  t.eq(args.file_path, 'Notes/Target.md', 'historical argument compaction preserves target path');
  t.ok(args.content.includes('argument chars elided'), 'historical argument compaction elides large payload');
};
